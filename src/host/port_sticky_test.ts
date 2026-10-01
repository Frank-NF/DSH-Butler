/**
 * 端口粘住测试。
 *
 * 用户原话（2026-09-30）：「这个自动换端口太烦了……用着用着就页面拒绝访问了。
 * 我是开发者我知道原因，用户不知道啊，两次就弃用了。」
 *
 * 所以端口不能是"每次重新挑一个"，得先问"上次用的是哪个"：
 * 首选 → 上次用的 → 顺延。记忆文件坏了也绝不能把启动搞挂。
 */

import { assert, assertEquals } from "@std/assert";
import { resolvePort } from "../api/server.ts";
import { portCandidates, readLastPort, rememberPort } from "./port_memory.ts";

const SPAN = 10;

// ① 候选顺序：首选 → 粘住 → 顺延
assertEquals(portCandidates(8731, null, SPAN), [
  8731,
  8732,
  8733,
  8734,
  8735,
  8736,
  8737,
  8738,
  8739,
  8740,
  8741,
]);
assertEquals(portCandidates(8731, 8733, SPAN)[0], 8731, "首选永远排第一");
assertEquals(portCandidates(8731, 8733, SPAN)[1], 8733, "上次用过的端口排在顺延前面");
assertEquals(
  portCandidates(8731, 8733, SPAN).filter((p) => p === 8733).length,
  1,
  "同一个端口只试一次",
);
assertEquals(portCandidates(8731, 8731, SPAN)[1], 8732, "粘住的就是首选时不重复试");
assert(
  portCandidates(8731, 8800, SPAN).includes(8800),
  "粘住端口超出顺延范围也要能用（那正是它存在的意义）",
);
assertEquals(
  portCandidates(8731, 99999, SPAN).indexOf(99999),
  -1,
  "越界端口号不是端口，别去试（试了也绑不上）",
);
assertEquals(portCandidates(8731, 0, SPAN)[1], 8732, "0 / 非法粘住值当没有");

// ② resolvePort 走一遍真实决策（探测函数注入，不占真端口）
const free = (...ports: number[]) => (p: number) => ports.includes(p);
assertEquals(resolvePort(8731, true, 8733, free(8731)), 8731, "首选空闲就用首选");
assertEquals(resolvePort(8731, true, 8733, free(8733)), 8733, "首选被占就用上次的");
assertEquals(resolvePort(8731, true, 8733, free(8732)), 8732, "上次也被占才顺延");
assertEquals(resolvePort(8731, true, null, free()), 0, "全占 → 随机端口");
assertEquals(resolvePort(8731, false, 8733, free(8733)), 8731, "headless 不粘住");
assertEquals(resolvePort(undefined, true, 8733, free(8733)), 0, "没给首选就是随机");

// ③ 记忆读写（临时目录，绝不碰真实的 ~/.dsh-butler）
const dir = await Deno.makeTempDir();
try {
  assertEquals(readLastPort(dir), null, "没记过就是没有");
  rememberPort(8733, dir);
  assertEquals(readLastPort(dir), 8733);
  rememberPort(8731, dir);
  assertEquals(readLastPort(dir), 8731, "后写的覆盖先写的");
} finally {
  await Deno.remove(dir, { recursive: true });
}

// ④ 坏记忆文件不能把启动搞挂
const bad = await Deno.makeTempDir();
try {
  Deno.writeTextFileSync(`${bad}/last-port.json`, "{ 坏文件");
  assertEquals(readLastPort(bad), null, "坏文件当没有，绝不因此启动失败");
  Deno.writeTextFileSync(`${bad}/last-port.json`, '{"port":"不是数字"}');
  assertEquals(readLastPort(bad), null);
  Deno.writeTextFileSync(`${bad}/last-port.json`, '{"port":0}');
  assertEquals(readLastPort(bad), null, "0 不是合法端口");
} finally {
  await Deno.remove(bad, { recursive: true });
}
