/**
 * 动作注册表。
 *
 * S1（只读阶段）注册的动作全部 readonly: true —— 它们绝不会修改用户任何文件。
 * 后续阶段的写操作动作在此追加，并必须实现 onUndo 补偿。
 */

import { engine } from "./engine.ts";
import { envProbeAction } from "../domains/env/probe.ts";
import { coreStatusAction } from "../domains/core/status.ts";
import { coreVerifyAction } from "../domains/core/verify.ts";
import { runtimeStatusAction } from "../domains/runtime/status.ts";
import { runtimeLogsAction } from "../domains/runtime/logs.ts";
import { runtimeDiagnoseAction } from "../domains/runtime/diagnose.ts";
import { diagHealthAction } from "../domains/diag/health.ts";
import { pluginDiagnoseAction } from "../domains/plugin/diagnose.ts";
import { log } from "../util/log.ts";

export function registerAllActions(): void {
const defs = [
  envProbeAction,
  coreStatusAction,
  coreVerifyAction,
  runtimeStatusAction,
    runtimeLogsAction,
    runtimeDiagnoseAction,
    diagHealthAction,
    pluginDiagnoseAction,
  ];
  for (const def of defs) engine.register(def);
  log.info("registry", `已注册 ${defs.length} 个只读动作`);
}

/**
 * 断言：S1 阶段不允许注册任何写操作。
 * 这是一道防呆——避免在只读版本里误引入副作用。
 */
export function assertReadOnlyStage(): void {
  const writers = engine.definitions().filter((d) => !d.readonly);
  if (writers.length > 0) {
    throw new Error(`S1 只读阶段不允许注册写操作，发现：${writers.map((w) => w.name).join(", ")}`);
  }
}
