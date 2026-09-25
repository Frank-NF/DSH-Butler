/**
 * 两个「用户能直接看到」的界面缺陷的守卫测试（2026-09-25 审计）：
 *   Q-12 市场筛选栏多出一个孤立闭合标签，把 .market-bar 的 DOM 结构推歪；
 *   Q-11 悬浮条脚本会输出 dbb-dot warn，但样式表里从来没定义过这个类。
 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";
import { BUTLER_BAR_JS } from "./bar.ts";

Deno.test("市场筛选栏：标签开闭配平（Q-12）", () => {
  const start = CLIENT_JS.indexOf('<div class="card"><div class="market-bar">');
  assertEquals(start >= 0, true, "找不到市场筛选栏的构造代码");
  // 取到这一句结束（那串 '</div>'; 才是筛选栏自己的收尾），否则会漏算一个闭合 div
  const end = CLIENT_JS.indexOf("'</div>';", start);
  assertEquals(end > start, true, "筛选栏代码块边界没找到");
  const block = CLIENT_JS.slice(start, end + 8);
  const count = (s: string, needle: string) => s.split(needle).length - 1;
  for (const tag of ["div", "span", "button"]) {
    const open = count(block, `<${tag}`);
    const close = count(block, `</${tag}>`);
    assertEquals(open, close, `筛选栏里 <${tag}> 开闭不配平：${open} 开 / ${close} 闭`);
  }
});

Deno.test("悬浮条：脚本输出的状态点类名都有样式（Q-11）", () => {
  assertEquals(
    BUTLER_BAR_JS.includes(".dbb-dot.warn{"),
    true,
    "脚本会输出 dbb-dot warn，但样式表没定义它 —— 「已启动未就绪」会和「已停止」一样是灰点",
  );
});
