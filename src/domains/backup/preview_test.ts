/**
 * 回滚影响预览的测试。【P0-4 · 2026-09-25】
 *
 * 分两层：判据纯函数（表格化）+ 真实回滚点的端到端预览（用 BUTLER_ROLLBACK_DIR 指到临时目录，
 * 绝不碰真实存储）。
 */
import { assertEquals } from "@std/assert";
import { applyPreflight } from "./actions.ts";
import { classifyArtifact, describeReverse, headlineOf, previewRollbackPoint, stateText, summarize } from "./preview.ts";
import { createRollbackPoint } from "./rollback.ts";

Deno.test("影响预览：单个文件的处置判据", () => {
  assertEquals(classifyArtifact(true, true, "copy"), "to-overwrite");
  assertEquals(classifyArtifact(true, false, "copy"), "to-restore");
  assertEquals(classifyArtifact(false, false, "copy"), "backup-missing");
  assertEquals(classifyArtifact(false, true, "copy"), "backup-missing");
  // manifest-only 不存内容副本，按记录重写，不算「备份缺失」
  assertEquals(classifyArtifact(false, true, "manifest-only"), "to-overwrite");
  assertEquals(stateText("to-overwrite").includes("覆盖"), true);
  assertEquals(stateText("to-restore").includes("补回"), true);
  assertEquals(stateText("backup-missing").includes("缺失"), true);
});

Deno.test("影响预览：逆操作配方都有人话解释", () => {
  assertEquals(describeReverse({ op: "restore-files" }).includes("写回"), true);
  assertEquals(describeReverse({ op: "git-reset", commit: "abcdef1234567890", quarantine: "q" }).includes("abcdef1234"), true);
  assertEquals(describeReverse({ op: "npm-reinstall", pkgJson: "a", lockfile: "b" }).includes("重装"), true);
  assertEquals(describeReverse({ op: "rewrite-manifest", file: "f" }).includes("清单"), true);
});

Deno.test("影响预览：汇总与一句话结论", () => {
  const arts = [
    { path: "a", mode: "copy" as const, state: "to-overwrite" as const, sizeBytes: 100, text: "" },
    { path: "b", mode: "copy" as const, state: "to-restore" as const, sizeBytes: 200, text: "" },
    { path: "c", mode: "copy" as const, state: "backup-missing" as const, sizeBytes: 0, text: "" },
  ];
  const s = summarize(arts);
  assertEquals(s, { total: 3, toOverwrite: 1, toRestore: 1, backupMissing: 1, bytes: 300 });
  const h = headlineOf(s);
  assertEquals(h.includes("覆盖 1"), true);
  assertEquals(h.includes("补回 1"), true);
  assertEquals(h.includes("1 个备份副本缺失"), true);
  assertEquals(headlineOf({ total: 0, toOverwrite: 0, toRestore: 0, backupMissing: 0, bytes: 0 }).includes("不会改动磁盘"), true);
});

Deno.test("影响预览：真实回滚点的端到端（含写前检查里的预览）", async () => {
  const prev = Deno.env.get("BUTLER_ROLLBACK_DIR");
  const dir = await Deno.makeTempDir({ prefix: "butler-preview-" });
  Deno.env.set("BUTLER_ROLLBACK_DIR", dir);
  try {
    const keep = `${dir}/keep.txt`;
    const gone = `${dir}/gone.txt`;
    await Deno.writeTextFile(keep, "v1");
    await Deno.writeTextFile(gone, "v1");

    const pt = await createRollbackPoint({
      kind: "config",
      trigger: "测试：手动创建",
      artifacts: [{ path: keep, mode: "copy" }, { path: gone, mode: "copy" }],
      reverse: { op: "restore-files" },
    });

    // 制造差异：keep 还在（会被覆盖）、gone 被删掉（会被补回）
    await Deno.remove(gone);
    const pv = previewRollbackPoint(pt.id);
    assertEquals(pv !== null, true);
    assertEquals(pv!.summary.total, 2);
    assertEquals(pv!.summary.toOverwrite, 1);
    assertEquals(pv!.summary.toRestore, 1);
    assertEquals(pv!.summary.backupMissing, 0);
    assertEquals(pv!.effect.includes("写回"), true);

    // 写前检查里必须带上这条预览（用户在确认弹窗里就能看到会改什么）
    const findings = applyPreflight({ id: pt.id });
    const impact = findings.find((f) => f.id === "backup.impact-preview");
    assertEquals(impact !== undefined, true, "写前检查必须带影响预览");
    assertEquals(impact!.severity, "info");
    assertEquals(impact!.title.includes("覆盖 1"), true);
    assertEquals((impact!.evidence ?? []).length, 2);

    // 回滚点不存在时预览返回 null，写前检查给 error
    assertEquals(previewRollbackPoint("pt-不存在"), null);
    const bad = applyPreflight({ id: "pt-不存在" });
    assertEquals(bad.some((f) => f.id === "backup.not-found" && f.severity === "error"), true);
  } finally {
    if (prev === undefined) Deno.env.delete("BUTLER_ROLLBACK_DIR");
    else Deno.env.set("BUTLER_ROLLBACK_DIR", prev);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
