/**
 * 窗口按钮行为的守卫测试。【2026-09-25 用户实测反馈】
 *
 * 事故：点「最小化」时窗口被 hide() 收进托盘，任务栏图标消失，用户只能去托盘里找。
 * 根因是拿 [-32000,-32000]（Windows 表示"窗口已最小化"的标准坐标）当成了"该隐藏"的信号。
 * 这条测试直接盯住源码文本，防止有人再把最小化改回收托盘。
 */
import { assertEquals } from "@std/assert";

Deno.test("窗口行为：最小化只最小化，不藏进托盘", async () => {
  const src = await Deno.readTextFile(new URL("../main.ts", import.meta.url));
  assertEquals(
    src.includes("hideToTray"),
    false,
    "最小化不该再把窗口 hide 掉（任务栏图标会消失，用户只能去托盘找）",
  );
  assertEquals(
    src.includes("pos[0] <= -30000"),
    false,
    "别再拿最小化坐标哨兵当收托盘的判据 —— 它只是 Windows 表示窗口已最小化",
  );
  // 点 X 到托盘这条路必须留着，而且要按设置走
  assertEquals(src.includes("closeToTray"), true, "「点 X 收进托盘」的设置不能弄丢");
});
