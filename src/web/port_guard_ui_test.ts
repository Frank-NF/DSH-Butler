/**
 * 守卫：页面内服务失联兜底。
 *
 * 端口漂移的最后一公里：页面还活着，但 API 全部连不上。
 * 裸放着的话用户看到的是浏览器原生的"拒绝连接"——那正是弃用的原因，
 * 所以必须自己说人话，并且给出"点一下就回到管家"的按钮。
 */

import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";
import { INDEX_HTML } from "./markup.ts";
import { STYLE_CSS } from "./styles.ts";

Deno.test("端口换掉后页面要能自己找到新地址", () => {
  assertEquals(
    CLIENT_JS.includes("dead-host"),
    true,
    "缺兜底覆盖层的挂载点",
  );
  assertEquals(
    CLIENT_JS.includes("no-cors"),
    true,
    "探测邻近端口要用 no-cors：读不到正文也要能分清「有人应答」和「连接被拒」",
  );
  assertEquals(
    /连不上管家/.test(CLIENT_JS),
    true,
    "兜底要说人话，不是把浏览器的拒绝连接页转译一下",
  );
  assertEquals(
    CLIENT_JS.includes("location.replace"),
    true,
    "找到新地址要能一键跳过去（replace：不留后退历史，刷新不会又回到死地址）",
  );
  assertEquals(INDEX_HTML.includes('id="dead-host"'), true, "骨架缺兜底容器");
  assertEquals(STYLE_CSS.includes(".dead-host"), true, "缺兜底样式");
});
