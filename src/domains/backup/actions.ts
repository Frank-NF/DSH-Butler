/**
 * backup.* —— 回滚点的五个动作（方案 §4 backup.*：list / create / apply / delete / verify）。
 *
 * 分工：
 *   rollback.ts 是生命周期原语（存储、校验、逆操作、淘汰）；
 *   本文件只把它接到任务引擎上 —— 写动作全部带 preflight + steps（Task #11 的防呆门），
 *   CLI 侧统一走 runWrite 的 plan → confirm → apply（无 --yes 只出计划预览）。
 *
 * create 的参数刻意只收「文件列表 + 类型」：git-reset / npm-reinstall 这类复合逆操作
 * 由 #13/#14 在自己任务里用库函数直接构造（它们才知道 commit、隔离区、清单三件套在哪），
 * 不硬塞进通用 CLI 入参里。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { isFile } from "../../host/fs.ts";
import {
  applyRollbackPoint,
  checkIntegrity,
  createRollbackPoint,
  deleteRollbackPoint,
  getRollbackPoint,
  type IntegrityReport,
  listRollbackPoints,
  ROLLBACK_KINDS,
  type RollbackKind,
  type RollbackPoint,
  rollbackRoot,
} from "./rollback.ts";

export interface BackupListReport {
  root: string;
  points: RollbackPoint[];
}

/** 允许的 kind 字符串 → 类型收窄（CLI 进来的都是字符串）。 */
function asKind(v: unknown): RollbackKind | null {
  return typeof v === "string" && (ROLLBACK_KINDS as string[]).includes(v)
    ? v as RollbackKind
    : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ── backup.list（只读） ───────────────────────────────────────────

export const backupListAction: ActionDef<Record<string, never>, BackupListReport> = {
  name: "backup.list",
  domain: "backup",
  title: "列出回滚点",
  description: "查看全部回滚点及其验证状态。只读。",
  readonly: true,
  steps: ["读取回滚点索引"],
  run: async (ctx): Promise<BackupListReport> => {
    ctx.step("s1", "读取回滚点索引");
    const points = listRollbackPoints();
    ctx.detail(`共 ${points.length} 个回滚点`);
    ctx.progress(1);
    return { root: rollbackRoot(), points };
  },
};

// ── backup.verify（只读） ────────────────────────────────────────

export interface BackupVerifyReport {
  checkedAt: string;
  allOk: boolean;
  results: Array<{ id: string; ok: boolean; problems: string[] }>;
}

export const backupVerifyAction: ActionDef<{ id?: string }, BackupVerifyReport> = {
  name: "backup.verify",
  domain: "backup",
  title: "校验回滚点完整性",
  description: "回读备份副本比对哈希 / 检查 git 对象是否还在。只读，不改任何状态。",
  readonly: true,
  steps: ["定位回滚点", "逐条校验备份内容"],
  run: async (ctx, params): Promise<BackupVerifyReport> => {
    ctx.step("s1", "定位回滚点");
    const wanted = typeof params.id === "string" && params.id ? params.id : null;
    let targets: RollbackPoint[];
    if (wanted) {
      const hit = getRollbackPoint(wanted);
      if (!hit) throw new Error(`回滚点不存在：${wanted}`);
      targets = [hit];
    } else {
      targets = listRollbackPoints();
    }
    ctx.progress(0.3);

    ctx.step("s2", "逐条校验备份内容");
    const results: BackupVerifyReport["results"] = [];
    for (const pt of targets) {
      ctx.throwIfCancelled();
      const rep: IntegrityReport = await checkIntegrity(pt);
      results.push({ id: pt.id, ok: rep.ok, problems: rep.problems });
    }
    ctx.progress(1);
    return {
      checkedAt: new Date().toISOString(),
      allOk: results.every((r) => r.ok),
      results,
    };
  },
};

// ── backup.create（写） ──────────────────────────────────────────

export interface BackupCreateParams {
  kind?: string;
  /** 要备份的文件列表（copy 模式）。 */
  paths?: string[];
  trigger?: string;
  jobId?: string;
}

function createPreflight(params: BackupCreateParams): Finding[] {
  const out: Finding[] = [];

  if (!asKind(params.kind)) {
    out.push(
      finding("backup.bad-kind", "error", `回滚点类型无效：${params.kind ?? "(空)"}`, {
        cause: "kind 必须是 core-build / plugin-set / config / snapshot / env 之一",
        impact: "无法创建回滚点，写操作将没有后悔药",
        action: `改用合法类型，例如：backup create config <文件...>`,
        evidence: ROLLBACK_KINDS,
      }),
    );
  }

  const paths = asStringArray(params.paths);
  if (paths.length === 0) {
    out.push(
      finding("backup.no-paths", "error", "没有指定要备份的文件", {
        cause: "paths 为空",
        impact: "空回滚点没有可还原的内容，等于没备份",
        action: "至少给一个文件路径，例如：backup create config C:\\path\\to\\file.json",
      }),
    );
  } else {
    const missing = paths.filter((x) => !isFile(x));
    if (missing.length > 0) {
      out.push(
        finding("backup.source-missing", "error", `${missing.length} 个备份源不存在`, {
          cause: "下列路径不是已存在的文件",
          impact: "写前落盘会失败，回滚点创建不了",
          action: "确认路径无误后重试",
          evidence: missing,
        }),
      );
    }
  }

  return out;
}

export const backupCreateAction: ActionDef<BackupCreateParams, RollbackPoint> = {
  name: "backup.create",
  domain: "backup",
  title: "创建回滚点",
  description:
    "把指定文件备份下来（写前落盘：内容先复制校验，索引后写）。任何写操作动手前都该先有它。",
  readonly: false,
  steps: ["写前检查（类型与备份源）", "复制备份内容并回读校验", "写入回滚点索引"],
  preflight: async (params) => createPreflight(params),
  run: async (ctx, params): Promise<RollbackPoint> => {
    ctx.step("s1", "写前检查（类型与备份源）");
    const problems = createPreflight(params);
    if (problems.some((f) => f.severity === "error")) {
      throw new Error(
        `写前检查未通过：${
          problems.filter((f) => f.severity === "error").map((f) => f.title).join("；")
        }`,
      );
    }
    const kind = asKind(params.kind);
    if (!kind) throw new Error("回滚点类型无效"); // preflight 已拦，防御性收窄
    const paths = asStringArray(params.paths);
    ctx.progress(0.2);

    ctx.step("s2", "复制备份内容并回读校验");
    const point = await createRollbackPoint({
      kind,
      trigger: params.trigger && params.trigger ? params.trigger : "手动创建",
      jobId: params.jobId,
      artifacts: paths.map((path) => ({ path, mode: "copy" as const })),
      reverse: { op: "restore-files" },
    });
    ctx.detail(`已落盘：${point.id}（${point.artifacts.length} 个条目，${point.sizeBytes} 字节）`);
    ctx.progress(0.9);

    // 任务后续步骤若失败/取消 → 撤掉这个刚建的点，保持「取消前后状态等价」
    ctx.onUndo(async () => {
      deleteRollbackPoint(point.id);
    });

    ctx.step("s3", "写入回滚点索引");
    ctx.progress(1);
    return point;
  },
};

// ── backup.apply（写） ───────────────────────────────────────────

export interface BackupApplyParams {
  id?: string;
}

function applyPreflight(params: BackupApplyParams): Finding[] {
  const out: Finding[] = [];
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) {
    out.push(
      finding("backup.no-id", "error", "未指定要回滚到哪个回滚点", {
        cause: "id 为空",
        impact: "无法执行回滚",
        action: "先 backup list 查看可用回滚点，再 backup apply <id>",
      }),
    );
    return out;
  }
  const pt = getRollbackPoint(id);
  if (!pt) {
    out.push(
      finding("backup.not-found", "error", `回滚点不存在：${id}`, {
        cause: "索引里没有这个 id",
        impact: "无法执行回滚",
        action: "backup list 查看现有回滚点",
        evidence: [id],
      }),
    );
    return out;
  }
  return out; // 完整性校验在 apply 内部是硬闸；preflight 只负责把「不存在」提前拦掉
}

export const backupApplyAction: ActionDef<BackupApplyParams, { id: string; result: unknown }> = {
  name: "backup.apply",
  domain: "backup",
  title: "回滚到指定回滚点",
  description:
    "校验备份完整性 → 执行逆操作还原 → 应用后验证。验证不通过会保留回滚点并告警，绝不静默成功。",
  readonly: false,
  steps: ["确认回滚点存在", "校验备份完整性", "执行逆操作还原", "应用后验证"],
  preflight: async (params) => applyPreflight(params),
  run: async (ctx, params) => {
    ctx.step("s1", "确认回滚点存在");
    const problems = applyPreflight(params);
    if (problems.some((f) => f.severity === "error")) {
      throw new Error(
        `写前检查未通过：${
          problems.filter((f) => f.severity === "error").map((f) => f.title).join("；")
        }`,
      );
    }
    const id = params.id as string;
    ctx.progress(0.1);

    ctx.step("s2", "校验备份完整性");
    ctx.detail("库内先做完整性硬闸：备份本身坏了不会碰系统");
    ctx.progress(0.3);

    ctx.step("s3", "执行逆操作还原");
    ctx.progress(0.5);
    // 库内顺序固定：完整性 → 逆操作 → 应用后验证（内置）→ 领域验证（可选）。
    // 此处不传领域 verify：backup.apply 是通用回滚入口，领域级验证由 #13/#14 的
    // 专项动作（core.rollback 等）按 kind 附加。失败一律 throw → 任务标失败、
    // 回滚点保留 —— 与「不静默成功」一致。
    // 不注册 onUndo：逆操作的逆操作 = 再建一个回滚点，属 #14 编排范围，这里不假装能撤销。
    const res = await applyRollbackPoint(id);

    ctx.step("s4", "应用后验证");
    ctx.progress(1);
    if (!res.ok) {
      const detail = res.error ?? "回滚失败";
      const extra = res.problems && res.problems.length > 0 ? `：${res.problems.join("；")}` : "";
      throw new Error(`${detail}${extra}`);
    }
    if (res.warnings && res.warnings.length > 0) ctx.detail(`警告：${res.warnings.join("；")}`);
    return { id, result: res };
  },
};

// ── backup.delete（写） ──────────────────────────────────────────

export interface BackupDeleteParams {
  id?: string;
}

export const backupDeleteAction: ActionDef<BackupDeleteParams, { deleted: string }> = {
  name: "backup.delete",
  domain: "backup",
  title: "删除回滚点",
  description: "删除一个回滚点及其备份内容（显式人工动作，不受「未验证永不删」约束）。",
  readonly: false,
  steps: ["确认回滚点存在", "删除备份内容与索引记录"],
  preflight: async (params) => {
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) {
      return [
        finding("backup.no-id", "error", "未指定要删除的回滚点", {
          cause: "id 为空",
          impact: "无法删除",
          action: "backup list 查看可用回滚点",
        }),
      ];
    }
    if (!getRollbackPoint(id)) {
      return [
        finding("backup.not-found", "error", `回滚点不存在：${id}`, {
          cause: "索引里没有这个 id",
          impact: "无事可做",
          action: "backup list 查看现有回滚点",
          evidence: [id],
        }),
      ];
    }
    return [];
  },
  run: async (ctx, params): Promise<{ deleted: string }> => {
    ctx.step("s1", "确认回滚点存在");
    const id = typeof params.id === "string" ? params.id : "";
    if (!id || !getRollbackPoint(id)) throw new Error(`回滚点不存在：${id || "(空)"}`);
    ctx.progress(0.4);

    ctx.step("s2", "删除备份内容与索引记录");
    // 不注册 onUndo：显式删除是用户拍板的终态，删完再「补偿回来」才是惊喜惊吓
    const done = deleteRollbackPoint(id);
    if (!done) throw new Error(`删除失败：回滚点已不存在（${id}）`);
    ctx.progress(1);
    return { deleted: id };
  },
};
