/** 守卫：数据搬家页的入口、按钮与参数通道（P1-2）。 */
import { assertEquals } from "@std/assert";
import { CLIENT_JS } from "./client.ts";

Deno.test("数据搬家页：导航 + 三个动作按钮 + 带参数的检查/恢复", () => {
  assertEquals(CLIENT_JS.includes("label: '数据搬家'"), true, "导航里没有这一页");
  assertEquals(CLIENT_JS.includes("'data.backups'"), true, "页面没有数据源动作");
  assertEquals(CLIENT_JS.includes("'data.export'"), true, "缺导出按钮");
  assertEquals(CLIENT_JS.includes("'data.backup'"), true, "缺立即备份按钮");
  assertEquals(CLIENT_JS.includes("packBtn("), true, "缺带参数的只读按钮构造器");
  assertEquals(
    CLIENT_JS.includes("'data.restore', { params: { dir: b.dir } }"),
    true,
    "恢复按钮必须把包目录传下去（不然会去猜最新一个）",
  );
  assertEquals(CLIENT_JS.includes("if (action === 'data.inspect')"), true, "检查结果没有渲染分支");
  assertEquals(CLIENT_JS.includes("搬移包检查结果"), true, "检查弹窗标题丢了");
});
