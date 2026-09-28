/**
 * 「上游新版本改了什么」的测试。
 *
 * 三件事钉死：
 *   1) 版本 → 标签的换算（仓库约定 dsh-v<version>）+ 提交分类；
 *   2) 区间语义：只算"新标签里有、本机 HEAD 没有"的提交，合并提交不算（同步噪音）；
 *   3) 远端尝试顺序（本机自己的 mirror 优先）。
 * 区间那段用临时 git 仓库真跑一遍（git 不可用时跳过）。
 */

import { assertEquals } from "@std/assert";
import {
  classifyCommit,
  compareCommits,
  parseCommitLines,
  remoteTryOrder,
  summarizeCommits,
  versionTagCandidates,
} from "./upstream_changelog.ts";

Deno.test("上游标签候选：仓库约定优先，另留两种兜底", () => {
  assertEquals(versionTagCandidates("0.2.0-rc.1"), ["dsh-v0.2.0-rc.1", "v0.2.0-rc.1", "0.2.0-rc.1"]);
  assertEquals(versionTagCandidates("  "), []);
});

Deno.test("提交分类：conventional commit 前缀，认不出算 other", () => {
  assertEquals(classifyCommit("feat(web): add x"), "feat");
  assertEquals(classifyCommit("fix: y"), "fix");
  assertEquals(classifyCommit("docs(ci)!: z"), "docs");
  assertEquals(classifyCommit("release(dsh): 0.2.0-rc.1 (#5387)"), "release");
  assertEquals(classifyCommit("Merge pull request #1 from x/y"), "other");
  assertEquals(classifyCommit("Revert \"feat(x): y\""), "other");
  assertEquals(classifyCommit("随便写的中文提交"), "other");
});

Deno.test("提交行解析与汇总", () => {
  const rows = parseCommitLines("abc123|2026-09-28|feat(a): b\ndef456|2026-09-27|fix: c\n\nxyz|2026-09-26|docs: d");
  assertEquals(rows.length, 3, "空行要跳过");
  assertEquals(rows[0], { sha: "abc123", date: "2026-09-28", subject: "feat(a): b", type: "feat" });
  const c = summarizeCommits(rows);
  assertEquals(c, { total: 3, feat: 1, fix: 1, docs: 1, test: 0, other: 0 });
  assertEquals(summarizeCommits([]).total, 0);
});

Deno.test("远端尝试顺序：自己的 mirror 优先，其余保持原顺序", () => {
  assertEquals(remoteTryOrder(["origin", "mirror"]), ["mirror", "origin"]);
  assertEquals(remoteTryOrder(["origin", "upstream", "mirror", "other"]), ["mirror", "upstream", "origin", "other"]);
  assertEquals(remoteTryOrder([]), []);
});

const gitOk = (() => {
  try {
    return new Deno.Command("git", { args: ["--version"], stdout: "null", stderr: "null" }).outputSync().code === 0;
  } catch {
    return false;
  }
})();

Deno.test({
  name: "区间对比（真跑 git）：只算新标签里有、本机 HEAD 没有的提交",
  ignore: !gitOk,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "upstream-changelog-" });
    const g = (...args: string[]) =>
      new Deno.Command("git", {
        args: ["-C", dir, "-c", "commit.gpgsign=false", ...args],
        stdout: "piped",
        stderr: "piped",
      }).outputSync();
    const commit = (file: string, text: string, subject: string) => {
      Deno.writeTextFileSync(dir + "\\" + file, text);
      g("add", "-A");
      const r = g("commit", "-q", "-m", subject);
      if (r.code !== 0) throw new Error("git commit 失败：" + new TextDecoder().decode(r.stderr));
    };
    try {
      g("init", "-q");
      g("config", "user.email", "t@example.com");
      g("config", "user.name", "tester");
      commit("a.txt", "1", "feat: first");
      g("tag", "dsh-v0.1.0");

      commit("b.txt", "2", "fix(core): second");
      commit("c.txt", "3", "docs: third");
      g("tag", "dsh-v0.2.0");

      // 把本机切回 0.1.0（模拟"本机装的是旧版"）→ 新标签相对本机有 2 条
      g("checkout", "-q", "dsh-v0.1.0");
      const delta = await compareCommits(dir, "dsh-v0.2.0");
      assertEquals(delta.map((x) => x.subject), ["docs: third", "fix(core): second"], "新的在前");
      assertEquals(delta.map((x) => x.type), ["docs", "fix"]);

      // 把 HEAD 挪到新标签上 → 没有"本机缺的"了
      g("checkout", "-q", "dsh-v0.2.0");
      assertEquals(await compareCommits(dir, "dsh-v0.2.0"), []);
    } finally {
      try {
        await Deno.remove(dir, { recursive: true });
      } catch { /* 清不掉就算了 */ }
    }
  },
});
