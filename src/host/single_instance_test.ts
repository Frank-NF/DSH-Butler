/**
 * 单实例保护的回归测试。
 * 【2026-09-25 实测事故】管家重复启动 → 两个实例共用同一份 WebView2 用户数据目录 →
 * 后开的那个窗口全白；两个实例还会互相抢窗口。
 */
import { assertEquals } from "@std/assert";
import {
  claimSingleInstance,
  consumeShowRequest,
  readHolder,
  releaseSingleInstance,
  requestShow,
} from "./single-instance.ts";

/** 起一个短命子进程，用它的 pid 当「另一个活着的实例」。 */
function spawnLiveChild(): Deno.ChildProcess {
  return new Deno.Command(Deno.execPath(), {
    args: ["eval", "await new Promise((r) => setTimeout(r, 8000));"],
    stdout: "null",
    stderr: "null",
  }).spawn();
}

Deno.test("单实例保护：第二个实例被挡下，陈旧锁能被接管", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-inst-" });
  const file = `${dir}\\instance.json`;
  const child = spawnLiveChild();
  try {
    const first = await claimSingleInstance(file);
    assertEquals(first.ok, true, "第一个实例应该拿到锁");
    assertEquals(readHolder(file)?.pid, Deno.pid);

    // 模拟另一个「活着的」实例持有锁
    await Deno.writeTextFile(
      file,
      JSON.stringify({ pid: child.pid, startedAt: "", version: "test" }),
    );
    const blocked = await claimSingleInstance(file);
    assertEquals(blocked.ok, false, "已有实例在跑时不该放行");
    assertEquals(blocked.holderPid, child.pid);

    // 不是自己写的锁，绝不能删
    releaseSingleInstance(file);
    assertEquals(readHolder(file)?.pid, child.pid, "不许误删别人的锁");

    // 崩死留下的陈旧锁应被接管（否则用户会被一个幽灵实例永远关在门外）
    await Deno.writeTextFile(
      file,
      JSON.stringify({ pid: 999999, startedAt: "", version: "test" }),
    );
    const takeover = await claimSingleInstance(file);
    assertEquals(takeover.ok, true, "死进程的锁要能接管");
    assertEquals(readHolder(file)?.pid, Deno.pid);

    releaseSingleInstance(file);
    assertEquals(readHolder(file), null, "退出时要把自己的锁清掉");
  } finally {
    try {
      child.kill();
    } catch { /* 已退出 */ }
    await child.status.catch(() => {});
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("「请把窗口叫出来」请求：写一次消费一次", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-show-" });
  const file = `${dir}\\show-request`;
  try {
    assertEquals(consumeShowRequest(file), false, "没有请求时不该误报");
    requestShow(file);
    assertEquals(consumeShowRequest(file), true, "写了就该被消费");
    assertEquals(consumeShowRequest(file), false, "只能被消费一次");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
