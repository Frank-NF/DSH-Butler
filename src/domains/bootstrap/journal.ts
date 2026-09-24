/**
 * 一键部署的进度台账（AC-B3：中途拔网线 / 杀进程后能认出"没跑完的部署"）。
 *
 * 为什么不用任务引擎自己的记录：任务记录在"下次启动能不能继续"这件事上不够用 ——
 * 这里要多记一条"部署停在哪一步、装到哪个目录"，才能在界面上给出「继续 / 回滚」两个选项。
 *
 * 只在真正动手的写操作里读写；plan 只读它（读不算副作用）。
 */

import { butlerRoot, p } from "../../util/paths.ts";
import { readJson, removeRecursive, writeJsonAtomic } from "../../host/fs.ts";

export interface BootstrapJournal {
  startedAt: string;
  updatedAt: string;
  jobId: string;
  /** 安装目录（也是 clone 落点）。 */
  root: string;
  url: string;
  /** 当前停在的步骤 id / 标题。 */
  stepId: string;
  stepTitle: string;
  /** 半成品是否已经落在盘上（决定"回滚"要不要清理目录）。 */
  cloned: boolean;
}

export function bootstrapJournalPath(): string {
  return p(butlerRoot(), "bootstrap", "journal.json");
}

/** 读台账；没有或读不动都返回 null（读不动时宁可当作没有，也不阻塞启动）。 */
export function readBootstrapJournal(): BootstrapJournal | null {
  const j = readJson<BootstrapJournal>(bootstrapJournalPath());
  if (!j || typeof j.root !== "string") return null;
  return j;
}

export function writeBootstrapJournal(j: BootstrapJournal): void {
  try {
    writeJsonAtomic(bootstrapJournalPath(), j);
  } catch {
    // 台账写不进去不该让部署停下来 —— 它的作用是"下次启动能认出来"，属尽力而为
  }
}

export function clearBootstrapJournal(): void {
  try {
    removeRecursive(bootstrapJournalPath());
  } catch { /* 本来就没有 */ }
}
