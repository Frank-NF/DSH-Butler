/**
 * 窗口健康判据测试。
 *
 * 判错的代价是两个方向都很难受：漏判 = 用户对着"拒绝连接"只能重开管家；
 * 误判 = 用户正在看页面，窗口被反复重新导航。所以每种情形都钉一条。
 */

import { assertEquals } from "@std/assert";
import { isLoopbackOrigin, redactUrl, windowLooksStuck } from "./window_health.ts";

const EXPECTED = "http://127.0.0.1:64290";

Deno.test("窗口判据：停在别的本地端口上 = 卡死（真机出事那次）", () => {
  assertEquals(
    windowLooksStuck({ href: "http://127.0.0.1:64288/", origin: "http://127.0.0.1:64288" }, EXPECTED),
    true,
  );
  assertEquals(
    windowLooksStuck({ href: "http://127.0.0.1:54129/?t=x", origin: "http://127.0.0.1:54129" }, EXPECTED),
    true,
    "上个实例的端口已经没了，同样要救",
  );
});

Deno.test("窗口判据：正常页面（同一个源、没有错误标记）不许动", () => {
  assertEquals(
    windowLooksStuck({ href: "http://127.0.0.1:64290/?t=x", origin: EXPECTED, title: "DSH管家" }, EXPECTED),
    false,
  );
  assertEquals(
    windowLooksStuck({ href: "http://127.0.0.1:64290/#/sessions/a", origin: EXPECTED }, EXPECTED),
    false,
    "管家页里翻页（换路径）不算跑偏",
  );
});

Deno.test("窗口判据：DSH 服务换端口后也要认得出来", () => {
  const dsh = "http://127.0.0.1:3081";
  assertEquals(windowLooksStuck({ origin: dsh, href: dsh + "/?token=x" }, dsh), false, "正常在 DSH 里");
  assertEquals(
    windowLooksStuck({ origin: "http://127.0.0.1:3082", href: "http://127.0.0.1:3082/" }, dsh),
    true,
    "DSH 重启换了端口：老页面就成了死页面",
  );
});

Deno.test("窗口判据：源一样但是错误页 = 也要救", () => {
  assertEquals(
    windowLooksStuck({ href: EXPECTED + "/?t=x", origin: EXPECTED, error: true }, EXPECTED),
    true,
    "管家自己的地址没打开时，源还是一样的，只能靠错误页标记认出来",
  );
});

Deno.test("窗口判据：空白页算卡死，外部网站不算", () => {
  assertEquals(windowLooksStuck({ href: "about:blank", origin: "null" }, EXPECTED), true);
  assertEquals(windowLooksStuck({ href: "about:blank", origin: "" }, EXPECTED), true);
  assertEquals(
    windowLooksStuck({ href: "https://example.com/", origin: "https://example.com" }, EXPECTED),
    false,
    "用户自己点开的外部网站不打断",
  );
});

Deno.test("窗口判据：刚导航完的空白不算卡死（启动时第一次探测就撞上过）", () => {
  // 实测：进程起来后第一轮探测，页面还没加载完，报的就是 origin=null、标题空
  assertEquals(
    windowLooksStuck({ href: "about:blank", origin: "null" }, EXPECTED, { msSinceNavigation: 500 }),
    false,
    "刚导航 0.5 秒的空白是正常的加载中",
  );
  assertEquals(
    windowLooksStuck({ href: "about:blank", origin: "null" }, EXPECTED, { msSinceNavigation: 90_000 }),
    true,
    "导航完 90 秒还是空白 = 真卡住了",
  );
  assertEquals(
    windowLooksStuck({ href: "", origin: "" }, EXPECTED, { msSinceNavigation: 5_000 }),
    false,
    "空 origin 同理",
  );
  // 错误页与本地端口跑偏不受宽限期影响：那两种状态不会出现在正常加载中
  assertEquals(
    windowLooksStuck({ href: "chrome-error://chromewebdata/", origin: "null", error: true }, EXPECTED, {
      msSinceNavigation: 100,
    }),
    true,
    "错误页立刻要救",
  );
  assertEquals(
    windowLooksStuck({ origin: "http://127.0.0.1:64288" }, EXPECTED, { msSinceNavigation: 100 }),
    true,
    "跑到别的本地端口立刻要救",
  );
});

Deno.test("窗口判据：还不知道期望的源时，只认错误页与空白页", () => {
  assertEquals(windowLooksStuck({ origin: "http://127.0.0.1:1234", href: "x" }, null), false);
  assertEquals(windowLooksStuck({ origin: "http://127.0.0.1:1234", href: "x", error: true }, null), true);
});

Deno.test("日志脱敏：地址里的令牌不许进日志", () => {
  assertEquals(
    redactUrl("http://127.0.0.1:3081/?token=SECRET123"),
    "http://127.0.0.1:3081/?…",
    "令牌段必须被截掉（但要留下主机与端口，那是排查的关键）",
  );
  assertEquals(redactUrl("http://127.0.0.1:39999/"), "http://127.0.0.1:39999/", "没有查询串就原样");
});

Deno.test("回环地址识别", () => {
  assertEquals(isLoopbackOrigin("http://127.0.0.1:3081"), true);
  assertEquals(isLoopbackOrigin("http://localhost:3081"), true);
  assertEquals(isLoopbackOrigin("https://127.0.0.1"), true);
  assertEquals(isLoopbackOrigin("http://192.168.1.5:3081"), false);
  assertEquals(isLoopbackOrigin("https://dsh.huilinsh.cn"), false);
  assertEquals(isLoopbackOrigin("null"), false);
  assertEquals(isLoopbackOrigin("about:blank"), false);
});
