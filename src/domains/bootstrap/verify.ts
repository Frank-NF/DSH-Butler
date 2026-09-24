/**
 * bootstrap.verify —— 部署后的三连验证（AC-B4）。
 *
 * 三项全绿才叫"部署成功"：
 *   ① 构建记录 ↔ 源码提交一致（产物确实是这份源码编出来的）
 *   ② 插件双名单没有异常（装了没生效 / 名单里装不上都是红的）
 *   ③ 服务健康检查通过（进程活着 + HTTP 真的能响应）
 *
 * 只读：跑一百次也不改一个字节。人为破坏任意一项，这里必须报红。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { collectCoreStatus } from "../core/status.ts";
import { collectRuntimeStatus } from "../runtime/status.ts";

export interface BootstrapCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  evidence?: string[];
}

export interface BootstrapVerifyReport {
  checkedAt: string;
  ok: boolean;
  checks: BootstrapCheck[];
  findings: Finding[];
}

export async function collectBootstrapVerify(): Promise<BootstrapVerifyReport> {
  const [core, runtime] = await Promise.all([
    collectCoreStatus().catch(() => null),
    collectRuntimeStatus().catch(() => null),
  ]);
  const checks: BootstrapCheck[] = [];
  const findings: Finding[] = [];

  // ── ① 构建记录 ↔ 源码提交 ─────────────────────────────────────────
  if (!core || !core.sourceRoot) {
    checks.push({
      id: "build-record",
      label: "构建记录一致性",
      ok: false,
      detail: "没找到 DSH 本体",
    });
    findings.push(
      finding("bootstrap.verify.no-root", "error", "没找到 DSH 本体，无法验证", {
        cause: "本机没有检测到含 apps/cli 的 DSH 源码树",
        impact: "三项验证都做不了",
        action: "先执行「一键部署」把本体装上",
        fixAction: "bootstrap.plan",
      }),
    );
  } else {
    const head = core.git?.head ?? null;
    const recCommit = core.build?.commit ?? null;
    const ok = Boolean(head && recCommit && !core.needsFinishUpdate);
    checks.push({
      id: "build-record",
      label: "构建记录一致性",
      ok,
      detail: ok
        ? `产物与源码一致（提交 ${String(head).slice(0, 12)}）`
        : core.build
        ? `构建记录停在 ${String(recCommit ?? "(空)").slice(0, 12)}，源码在 ${
          String(head ?? "(未知)").slice(0, 12)
        }`
        : "没有构建记录文件（这台机器还没构建过）",
      evidence: [core.sourceRoot, `HEAD ${head ?? "?"}`, `记录 ${recCommit ?? "?"}`],
    });
    if (!ok) {
      findings.push(
        finding("bootstrap.verify.build-stale", "error", "产物与源码不一致", {
          cause: core.finishReason ?? "构建记录里的提交与当前 HEAD 对不上",
          impact: "DSH 界面还是旧版本，功能与源码不符",
          action: "执行「完成更新」重建界面产物，或重新跑一次一键部署",
          fixAction: "core.finishUpdate",
          evidence: [`HEAD ${head ?? "?"}`, `构建记录 ${recCommit ?? "?"}`],
        }),
      );
    }
  }

  // ── ② 插件双名单 ─────────────────────────────────────────────────
  const plugins = core?.plugins ?? null;
  if (!plugins) {
    checks.push({
      id: "plugin-lists",
      label: "插件名单一致性",
      ok: false,
      detail: "读不到 profile 的双名单（插件体系可能还没初始化）",
    });
  } else {
    const bad = plugins.declaredButInactive.length + plugins.bundledButUndeclared.length;
    const ok = bad === 0;
    checks.push({
      id: "plugin-lists",
      label: "插件名单一致性",
      ok,
      detail: ok
        ? `依赖 ${plugins.dependencies.length} · 名单 ${plugins.bundles.length} · 生效 ${plugins.active.length}，无异常`
        : `装了没生效 ${plugins.declaredButInactive.length} 个、名单里装不上 ${plugins.bundledButUndeclared.length} 个`,
      evidence: [
        ...plugins.declaredButInactive.slice(0, 10).map((n) => `装了没生效：${n}`),
        ...plugins.bundledButUndeclared.slice(0, 10).map((n) => `名单里装不上：${n}`),
      ],
    });
    if (!ok) {
      findings.push(
        finding("bootstrap.verify.plugin-lists", "error", "插件双名单不一致", {
          cause: `activePlugins = dependencies ∩ dsh.profile.bundles 对不上：` +
            `装了没生效 ${plugins.declaredButInactive.length} 个、名单里装不上 ${plugins.bundledButUndeclared.length} 个`,
          impact: "插件装了不生效，或 DSH 启动时直接终止",
          action: "去「插件」页跑一次插件诊断，再按结论修复",
          fixAction: "plugin.diagnose",
          evidence: [
            ...plugins.declaredButInactive.slice(0, 10),
            ...plugins.bundledButUndeclared.slice(0, 10),
          ],
        }),
      );
    }
  }

  // ── ③ 健康检查 ───────────────────────────────────────────────────
  if (!runtime) {
    checks.push({ id: "health", label: "服务健康检查", ok: false, detail: "读不到运行状态" });
  } else {
    const reachable = Boolean(runtime.health?.reachable);
    const ok = runtime.running && reachable;
    checks.push({
      id: "health",
      label: "服务健康检查",
      ok,
      detail: !runtime.running
        ? "服务没有在运行"
        : reachable
        ? `进程 ${runtime.pid ?? "?"} · 端口 ${
          runtime.port ?? "?"
        } · HTTP ${runtime.health?.status} · ${runtime.health?.latencyMs ?? "?"} ms`
        : `进程在跑（PID ${runtime.pid ?? "?"}）但 HTTP 访问不通：${
          runtime.health?.error ?? "无响应"
        }`,
      evidence: [`PID ${runtime.pid ?? "-"}`, `端口 ${runtime.port ?? "-"}`],
    });
    if (!ok) {
      findings.push(
        finding("bootstrap.verify.health", "error", "服务健康检查未通过", {
          cause: !runtime.running
            ? "没有检测到 DSH 服务进程"
            : `端口 ${runtime.port ?? "?"} 上的服务没有正常响应 HTTP`,
          impact: "打不开 DSH 界面，等于部署没完成",
          action: "先看「运行状态」页的诊断结论，再决定重启或修复",
          fixAction: "runtime.diagnose",
        }),
      );
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    ok: checks.every((c) => c.ok),
    checks,
    findings,
  };
}

export const bootstrapVerifyAction: ActionDef<Record<string, never>, BootstrapVerifyReport> = {
  name: "bootstrap.verify",
  domain: "bootstrap",
  title: "部署后三连验证",
  description: "只读校验三件事：构建记录与源码一致、插件双名单无异常、服务健康检查通过。",
  readonly: true,
  steps: ["核对构建记录", "核对插件双名单", "服务健康检查"],
  run: async (ctx): Promise<BootstrapVerifyReport> => {
    ctx.step("s1", "核对构建记录");
    ctx.progress(0.2);
    const report = await collectBootstrapVerify();
    const failed = report.checks.filter((c) => !c.ok);
    ctx.step("s2", "核对插件双名单");
    ctx.progress(0.7);
    ctx.detail(failed.length === 0 ? "三项全部通过" : `${failed.length} 项未通过`);
    ctx.step("s3", "服务健康检查");
    ctx.progress(1);
    return report;
  },
};
