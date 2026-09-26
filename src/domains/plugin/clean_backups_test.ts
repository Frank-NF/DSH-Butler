/**
 * plugin.cleanBackups 的判据测试。【P0-1 · 2026-09-25】
 *
 * 只测「认出哪些是历史备份」这个纯函数 —— 它是这个动作的唯一判据来源，
 * 判错就会误伤用户数据，判漏就等于体检报了修不掉。
 */
import { assertEquals } from "@std/assert";
import { scanBackupTargets } from "./clean_backups.ts";

Deno.test("清理历史备份：只认备份形态，正常文件与插件目录一律不碰", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-backups-" });
  try {
    const backups = [
      "package.json.bak",
      "package.json.bak.2",
      ".updater_backups",
      ".dual_lock_backup",
      ".abandoned_tgz_backup",
      ".removed-plugins-2026-09-01",
      ".cleanup_backup_20260925120000",
      "active.json.stale-4242",
    ];
    const normal = ["package.json", "node_modules", "active.json", "my-notes.txt", ".npmrc", "skills"];
    for (const n of [...backups, ...normal]) {
      await Deno.writeTextFile(`${dir}/${n}`, "x");
    }

    const hits = scanBackupTargets(dir).map((t) => t.name).sort();
    assertEquals(hits, backups.slice().sort(), "命中集合必须与备份清单完全一致");
    const kinds = new Set(scanBackupTargets(dir).map((t) => t.kind));
    assertEquals(kinds.size >= 5, true, "每类备份都该带上人话名称（界面证据里要显示）");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
