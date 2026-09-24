/**
 * runtime.logs 的测试：AC-R2 —— 10 万行日志检索 < 500ms。
 *
 * 样本现场：临时文件写满 100000 行常规日志 + 尾部 1 行目标错误，
 * 断言 searchInLog 命中且耗时 < 500ms（本机实测约 26ms，余量 19 倍；
 * 即使机械盘退化 10 倍也有富余）。
 */

import { extractErrors, searchInLog } from "./logs.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("AC-R2：10 万行日志检索 < 500ms 且命中正确", async () => {
  const path = await Deno.makeTempFile({ suffix: ".log" });
  try {
    const file = await Deno.open(path, { write: true, create: true });
    try {
      const enc = new TextEncoder();
      const line =
        "2026-09-24T12:00:00.000Z INFO  plugin-loader composed 42 entries in 312ms id=entry-";
      for (let i = 0; i < 100_000; i++) await file.write(enc.encode(line + i + "\n"));
      await file.write(
        enc.encode("2026-09-24T12:05:00.000Z ERROR waiting for service: remote.market\n"),
      );
    } finally {
      file.close();
    }

    const t0 = performance.now();
    const hits = searchInLog(path, "waiting for service");
    const ms = performance.now() - t0;

    assertEq(hits.length, 1, "应恰好命中尾部那行目标错误");
    assert(String(hits[0]?.text ?? "").includes("remote.market"), "命中的行内容不对");
    assert(ms < 500, `10 万行检索耗时 ${ms.toFixed(0)}ms，超过 500ms 门槛`);
  } finally {
    Deno.removeSync(path);
  }
});

Deno.test("AC-R2：检索上限生效（limit 截断，不被海量命中拖垮）", async () => {
  const path = await Deno.makeTempFile({ suffix: ".log" });
  try {
    const lines: string[] = [];
    for (let i = 0; i < 50_000; i++) lines.push(`ERROR needle ${i}`);
    await Deno.writeTextFileSync(path, lines.join("\n"));

    const t0 = performance.now();
    const hits = searchInLog(path, "needle", { limit: 50 });
    const ms = performance.now() - t0;
    assertEq(hits.length, 50, "limit 没生效");
    assert(ms < 500, `截断检索耗时 ${ms.toFixed(0)}ms 超标`);
  } finally {
    Deno.removeSync(path);
  }
});

Deno.test("extractErrors：从混杂行里挑真错误、滤栈帧与噪音", () => {
  const errs = extractErrors([
    "2026-09-22T23:25:53.316Z INFO  boot starting",
    "    at Fiber.execute (file:///G:/DeepSeek_Harness/vendor/cordis/lib/index.js:1068:24)", // 栈帧噪音
    "  DeprecationWarning: 老 API 将废弃", // 噪音
    "Error: dsh: startup failed: 1 required plugin did not activate",
    "  Cannot find module 'ghost-pkg'",
    "  Cannot find module 'ghost-pkg'", // 重复行应去重
    "GET / 200 12ms",
  ]);
  assert(errs.some((e) => e.includes("startup failed")), "没挑出启动失败行");
  assert(errs.some((e) => e.includes("Cannot find module")), "没挑出包缺失行");
  assert(!errs.some((e) => e.includes("at Fiber")), "栈帧噪音没滤掉");
  assert(!errs.some((e) => e.includes("DeprecationWarning")), "DeprecationWarning 没滤掉");
  assertEq(errs.filter((e) => e.includes("Cannot find module")).length, 1, "重复行没去重");
});
