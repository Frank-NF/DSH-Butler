/**
 * 技能快照的纯逻辑测试（P2-1）。
 *
 * git 本身的正确性不用我测；我测的是「我们把 git 用对了吗」——
 * 仓库位置对不对、提交信息能不能认出来、log 解析会不会把脏行当成快照。
 */
import { assertEquals } from "@std/assert";
import { configTargets, parseLogLine, snapshotMessage, snapshotRoot } from "./git_snapshot.ts";

Deno.test("快照：仓库就在技能目录本身（不复制数据）", () => {
  const root = snapshotRoot();
  assertEquals(root.endsWith("skills") || root.endsWith("skills\\") || root.endsWith("skills/"), true, "仓库根应是技能目录");
  assertEquals(root.includes(".dsh"), true);
});

Deno.test("快照：提交信息带时间与改动规模，翻日志时认得出来", () => {
  const at = new Date("2026-09-26T12:00:00Z");
  assertEquals(snapshotMessage(at, 3).startsWith("管家快照"), true);
  assertEquals(snapshotMessage(at, 3).includes("3 处改动"), true);
  assertEquals(snapshotMessage(at, 0).includes("处改动"), false, "没改动就别写数量");
});

Deno.test("快照：git log 解析只认三段式，脏行丢弃", () => {
  const ok = parseLogLine("abc123\u001f2026-09-26 12:00:00 +0800\u001f管家快照（3 处改动）");
  assertEquals(ok, { hash: "abc123", at: "2026-09-26 12:00:00 +0800", subject: "管家快照（3 处改动）" });
  assertEquals(parseLogLine(""), null);
  assertEquals(parseLogLine("乱码没有分隔符"), null);
});

Deno.test("快照：配置清单只列存在的、且都在 DSH 数据目录里", () => {
  const list = configTargets();
  assertEquals(list.length >= 3, true, "至少要有主配置、插件清单、源配置这几项");
  for (const c of list) {
    assertEquals(c.path.includes(".dsh"), true, `${c.label} 的路径看起来不像 DSH 数据目录：${c.path}`);
    assertEquals(typeof c.label === "string" && c.label.length > 0, true);
  }
});
