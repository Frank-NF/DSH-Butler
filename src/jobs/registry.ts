/**
 * 动作注册表。
 *
 * S1/S2 注册的动作全部 readonly: true；S3 起写操作动作在此追加，必须满足：
 *   readonly: false + preflight（写前检查）+ 声明 steps，
 *   并在 run 里通过 ctx.onUndo 注册补偿（失败/取消时引擎逆序执行）。
 * 注册完成后由 assertStageSafety() 统一把关。
 */

import { engine } from "./engine.ts";
import type { AnyActionDef } from "./types.ts";
import { envProbeAction } from "../domains/env/probe.ts";
import { coreStatusAction } from "../domains/core/status.ts";
import { coreVerifyAction } from "../domains/core/verify.ts";
import { runtimeStatusAction } from "../domains/runtime/status.ts";
import { runtimeLogsAction } from "../domains/runtime/logs.ts";
import { runtimeDiagnoseAction } from "../domains/runtime/diagnose.ts";
import { diagHealthAction } from "../domains/diag/health.ts";
import { pluginDiagnoseAction } from "../domains/plugin/diagnose.ts";
import {
  pluginInstallAction,
  pluginRepairAction,
  pluginScanAction,
  pluginUninstallAction,
} from "../domains/plugin/mutate.ts";
import { pluginCleanResidueAction } from "../domains/plugin/clean_residue.ts";
import { pluginCleanBackupsAction } from "../domains/plugin/clean_backups.ts";
import { pluginDepsAction, pluginSyncLockAction } from "../domains/plugin/deps_actions.ts";
import { pluginBatchUpdateAction } from "../domains/plugin/batch_update.ts";
import { pluginInstallOfflineAction } from "../domains/plugin/offline_install.ts";
import { networkSetRegistryAction, networkTestSourcesAction } from "../domains/net/sources.ts";
import { profileListAction, profileSwitchAction } from "../domains/profile/manage.ts";
import {
  dataBackupAction,
  dataBackupsAction,
  dataExportAction,
  dataInspectAction,
  dataRestoreAction,
} from "../domains/data/actions.ts";
import { runtimeRepairAction } from "../domains/runtime/repair.ts";
import { runtimeRestartAction } from "../domains/runtime/restart.ts";
import { runtimeStartAction, runtimeStopAction } from "../domains/runtime/start_stop.ts";
import { coreFinishUpdateAction } from "../domains/core/finish_update.ts";
import { coreUpdateAction } from "../domains/core/update.ts";
import { coreRollbackAction } from "../domains/core/rollback.ts";
import {
  backupApplyAction,
  backupCreateAction,
  backupDeleteAction,
  backupListAction,
  backupPreviewAction,
  backupVerifyAction,
} from "../domains/backup/actions.ts";
import { bootstrapPlanAction } from "../domains/bootstrap/plan.ts";
import { bootstrapApplyAction, bootstrapDiscardAction } from "../domains/bootstrap/apply.ts";
import { bootstrapVerifyAction } from "../domains/bootstrap/verify.ts";
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
    pluginScanAction,
    pluginInstallAction,
    pluginUninstallAction,
    pluginRepairAction,
    pluginCleanResidueAction,
    pluginCleanBackupsAction,
    pluginDepsAction,
    pluginSyncLockAction,
    pluginBatchUpdateAction,
    pluginInstallOfflineAction,
    networkTestSourcesAction,
    networkSetRegistryAction,
    profileListAction,
    profileSwitchAction,
    dataExportAction,
    dataInspectAction,
    dataRestoreAction,
    dataBackupAction,
    dataBackupsAction,
    runtimeRepairAction,
    runtimeRestartAction,
    runtimeStartAction,
    runtimeStopAction,
    backupListAction,
    backupPreviewAction,
    backupVerifyAction,
    backupCreateAction,
    backupApplyAction,
    backupDeleteAction,
    coreFinishUpdateAction,
    coreUpdateAction,
    coreRollbackAction,
    bootstrapPlanAction,
    bootstrapApplyAction,
    bootstrapDiscardAction,
    bootstrapVerifyAction,
  ];
  for (const def of defs) engine.register(def);
  log.info("registry", `已注册 ${defs.length} 个动作`);
}

/**
 * 阶段安全防呆（S3 起的新断言）。
 *
 * S1 时代的旧断言是「一个写动作都不许注册」—— S3 接管写操作后它反而会拦住正事，
 * 但直接删掉等于裸奔。新断言把「写动作必须带的安全装备」钉死：
 *   1) 必须有 preflight（写前检查）—— plan → confirm → apply 三段式里 plan 的来源，
 *      也是引擎第 0 步拦截 error 级前置问题的钩子（没有它，坏前置直接动手）；
 *   2) 必须声明 steps —— 用户点下去之前，界面与 CLI 就能展示"它打算分几步做什么"。
 *
 * 纯函数 stageSafetyProblems() 便于单测；assert 版供入口调用。
 */
export function stageSafetyProblems(defs: AnyActionDef[]): string[] {
  const out: string[] = [];
  for (const d of defs) {
    if (d.readonly) continue;
    if (!d.preflight) out.push(`写动作 ${d.name} 缺少 preflight（写前检查是强制的）`);
    if ((d.steps?.length ?? 0) === 0) out.push(`写动作 ${d.name} 未声明执行步骤`);
  }
  return out;
}

export function assertStageSafety(): void {
  const problems = stageSafetyProblems(engine.definitions());
  if (problems.length > 0) {
    throw new Error(`写操作安全防呆未通过：${problems.join("；")}`);
  }
}
