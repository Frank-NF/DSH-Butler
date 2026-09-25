/**
 * 日志落盘与轮转的回归测试。【2026-09-25 审计 Q-06】
 *
 * 旧实现写满 20000 行后只 close、不重开也不改名 —— 本进程此后再也不写日志文件。
 * 这里用很小的阈值把那条路径跑一遍，确保「改名成 .1 + 重开继续写」。
 */
import { assertEquals } from "@std/assert";
import { Logger } from "./log.ts";

Deno.test("日志轮转：写满阈值后改名保留旧文件并继续写新文件", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-log-" });
  const path = `${dir}\\butler-test.log`;
  try {
    const lg = new Logger({ maxFileLines: 3 });
    lg.attachFile(path);
    for (let i = 0; i < 7; i++) lg.info("test", `第 ${i} 行`);

    const current = await Deno.readTextFile(path);
    assertEquals(current.includes("第 6 行"), true, "轮转之后必须继续写当前文件（旧实现到这里就断了）");

    const rolled = await Deno.readTextFile(`${path}.1`);
    assertEquals(rolled.includes("第 5 行"), true, "上一份应当改名成 .1 保留下来");
    assertEquals(rolled.includes("第 0 行"), false, "只保留最近一份，更早的被覆盖");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
