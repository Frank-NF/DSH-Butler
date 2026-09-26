/**
 * 回滚影响预览：在执行回滚**之前**，先告诉你它会改什么。
 *
 * 【为什么单独做】回滚是唯一能一键把系统拉回过去的动作，也是最该让人看清楚再点的动作。
 * 以前确认弹窗只有一句「回滚到指定回滚点」，用户根本不知道会覆盖哪些文件、会不会把当前
 * 改动弄丢。这里的判据很直接：备份里存了什么（副本还在不在）＋ 磁盘上现在有什么。
 *
 * 纯逻辑（读写都通过已有工具函数），便于用临时目录做测试。
 */

import { pathExists } from "../../host/fs.ts";
import {
  getRollbackPoint,
  type ReverseOp,
  type RollbackArtifact,
  type RollbackKind,
  storedArtifactPath,
} from "./rollback.ts";

/** 单个文件在回滚后会变成什么样。 */
export type ArtifactState = "to-overwrite" | "to-restore" | "backup-missing";

export interface ArtifactPreview {
  path: string;
  mode: RollbackArtifact["mode"];
  state: ArtifactState;
  sizeBytes: number;
  /** 人话说明（直接显示在确认弹窗里）。 */
  text: string;
}

export interface RollbackPreview {
  id: string;
  kind: RollbackKind;
  trigger: string;
  createdAt: string;
  verified: boolean;
  /** 逆操作配方的人话解释。 */
  effect: string;
  artifacts: ArtifactPreview[];
  summary: {
    total: number;
    toOverwrite: number;
    toRestore: number;
    backupMissing: number;
    bytes: number;
  };
  /** 一句话结论。 */
  headline: string;
}

/**
 * 逆操作配方 → 人话。
 * 纯函数：四种配方各一句，便于测试与界面复用。
 */
export function describeReverse(op: ReverseOp): string {
  switch (op.op) {
    case "restore-files":
      return "把备份里的文件按原路径写回";
    case "git-reset":
      return `把源码仓库重置到提交 ${op.commit.slice(0, 10)}（当前未跟踪的改动会先移入隔离区）`;
    case "npm-reinstall":
      return "按备份的清单与锁文件把依赖重装一遍";
    case "rewrite-manifest":
      return "把插件清单改写回备份版本";
  }
}

/**
 * 单个文件的处置结论（纯函数）。
 * manifest-only 这类条目本身不存内容副本，回滚时按记录重写，所以不算「备份缺失」。
 */
export function classifyArtifact(
  stored: boolean,
  onDisk: boolean,
  mode: RollbackArtifact["mode"],
): ArtifactState {
  if (!stored && mode !== "manifest-only") return "backup-missing";
  if (onDisk) return "to-overwrite";
  return "to-restore";
}

/** 状态 → 人话（纯函数）。 */
export function stateText(state: ArtifactState): string {
  switch (state) {
    case "to-overwrite":
      return "当前已存在，回滚会覆盖它";
    case "to-restore":
      return "当前不在原位，回滚会把它补回来";
    case "backup-missing":
      return "备份副本缺失，回滚会跳过它";
  }
}

/** 汇总（纯函数）。 */
export function summarize(artifacts: ArtifactPreview[]): RollbackPreview["summary"] {
  return {
    total: artifacts.length,
    toOverwrite: artifacts.filter((a) => a.state === "to-overwrite").length,
    toRestore: artifacts.filter((a) => a.state === "to-restore").length,
    backupMissing: artifacts.filter((a) => a.state === "backup-missing").length,
    bytes: artifacts.reduce((s, a) => s + (a.sizeBytes || 0), 0),
  };
}

/** 一句话结论（纯函数）。 */
export function headlineOf(s: RollbackPreview["summary"]): string {
  if (s.total === 0) return "这个回滚点没有记录任何文件，回滚不会改动磁盘";
  const parts: string[] = [];
  if (s.toOverwrite > 0) parts.push(`覆盖 ${s.toOverwrite} 个当前存在的文件`);
  if (s.toRestore > 0) parts.push(`补回 ${s.toRestore} 个已不在原位的文件`);
  if (s.backupMissing > 0) parts.push(`${s.backupMissing} 个备份副本缺失（会被跳过）`);
  const tail = parts.length ? `：${parts.join("、")}` : "（内容与当前一致）";
  return `将处理 ${s.total} 个文件${tail}`;
}

/** 生成预览；回滚点不存在返回 null。 */
export function previewRollbackPoint(id: string): RollbackPreview | null {
  const pt = getRollbackPoint(id);
  if (!pt) return null;
  const artifacts: ArtifactPreview[] = pt.artifacts.map((a, i) => {
    const stored = a.mode === "manifest-only" ? true : pathExists(storedArtifactPath(pt.id, i, a.path));
    const onDisk = pathExists(a.path);
    const state = classifyArtifact(stored, onDisk, a.mode);
    return {
      path: a.path,
      mode: a.mode,
      state,
      sizeBytes: a.size,
      text: stateText(state),
    };
  });
  const summary = summarize(artifacts);
  return {
    id: pt.id,
    kind: pt.kind,
    trigger: pt.trigger,
    createdAt: pt.createdAt,
    verified: pt.verified,
    effect: describeReverse(pt.reverse),
    artifacts,
    summary,
    headline: headlineOf(summary),
  };
}
