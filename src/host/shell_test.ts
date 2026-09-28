/**
 * 子进程输出管道被孙进程占用时必须按时收工（2026-09-25 core.update 卡死的根因回归）。
 *
 * 背景：powershell 用 Start-Process -NoNewWindow 起【控制台程序】（node.exe）时，
 * node 会一直握着 powershell 的输出管道写端 → powershell 退出后管道永远不 EOF →
 * 老版 run() 的 Promise.all 永远等不到，而超时只杀得掉子进程、解不开这个等待，
 * 于是「执行一条命令」无限挂起：core.update 的重启服务一步永远 running，
 * 界面上进度条一直跑（任务其实早已完成）——用户报的「更新完了还在提示一直跑」。
 *
 * 钉死两件事：
 *   1) 这种形态必须在有限时间内带着 PID 返回（老版是永久挂起）；
 *   2) 常规超时路径仍然有效：超时后立刻收工，不拖满宽限期。
 * 只在 Windows + 本机有 node 时跑（其它平台直接跳过）。
 */
import { isSafeExternalUrl, locate, run } from "./shell.ts";


function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

const isWindows = Deno.build.os === "windows";

/** 数一下命令行里带 token 的存活进程（确认测试起的孙进程还在）。 */
async function countToken(token: string): Promise<number> {
  const r = await new Deno.Command("powershell.exe", {
    args: ["-NoProfile", "-Command",
      `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${token}*' }).Count`],
    stdout: "piped", stderr: "null",
  }).output();
  return Number(new TextDecoder().decode(r.stdout).trim()) || 0;
}

Deno.test({
  name: "run：输出管道被孙进程占着也要按时返回（Start-Process 起 node）",
  ignore: !isWindows,
  fn: async () => {
    const node = await locate("node");
    if (!node) return; // 本机没装 node 时跳过，不算失败
    const token = "dsh-pipetest-" + Math.random().toString(36).slice(2, 8);
    const dir = Deno.makeTempDirSync();
    const out = `${dir}/out.log`, err = `${dir}/err.log`;
    const q = (s: string) => `"${s.replaceAll("/", "\\")}"`;
    const ps =
      `$p = Start-Process -FilePath ${q(node)} ` +
      `-ArgumentList ${q("-e")},${q(`setInterval(()=>{},1e9)//${token}`)} ` +
      `-RedirectStandardOutput ${q(out)} -RedirectStandardError ${q(err)} ` +
      "-NoNewWindow -PassThru; $p.Id";
    try {
      const t0 = Date.now();
      // 看门狗：真回归时别把整个测试套件挂死，要给出明确报错
      const r = await Promise.race([
        run(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
          { timeoutMs: 8_000, scope: "test" },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("20 秒未返回：run() 又回到无限挂起的老毛病")), 20_000)
        ),
      ]);
      const elapsed = Date.now() - t0;
      assert(elapsed < 12_000, `老版这里会永久挂起，现在必须在 12 秒内返回，实测 ${elapsed} ms`);
      assert(!r.timedOut, `命令本体 1 秒内就完成，不该被当成超时（${elapsed} ms）`);
      assert(r.code === 0, `退出码应为 0，实为 ${r.code}`);
      assert(/^\d+/m.test(r.stdout.trim()), `stdout 里应有子进程 PID，实为 ${JSON.stringify(r.stdout.trim())}`);
      // 场景必须真复现：孙进程还活着（活着才可能占着管道写端），否则这条测试是空跑
      const alive = await countToken(token);
      assert(alive > 0, "孙进程 node 应当仍然存活，否则没复现「管道被孙进程占着」的场景");
    } finally {
      // 清掉测试起的常驻 node，绝不留垃圾进程
      await new Deno.Command("powershell.exe", {
        args: ["-NoProfile", "-Command",
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${token}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
        stdout: "null", stderr: "null",
      }).output();
      try { Deno.removeSync(dir, { recursive: true }); } catch { /* 已删则忽略 */ }
    }
  },
});

Deno.test({
  name: "run：常规超时仍然立刻收工",
  ignore: !isWindows,
  fn: async () => {
    const t0 = Date.now();
    const r = await run("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep 30"], {
      timeoutMs: 400,
      scope: "test",
    });
    const elapsed = Date.now() - t0;
    assert(r.timedOut, "应标记为超时");
    assert(elapsed < 5_000, `超时后要立刻收工，实测 ${elapsed} ms`);
  },
});

Deno.test("跨源链接白名单：只放行干净的 http/https（页面递过来的字符串不能直接进 cmd）", () => {
  assert(isSafeExternalUrl("http://127.0.0.1:64119/"), "本机服务地址要放行");
  assert(isSafeExternalUrl("https://github.com/Frank-NF/DSH-Butler"), "普通网址要放行");
  assert(isSafeExternalUrl("http://127.0.0.1:3081/?token=abc"), "带查询串没问题");
  assert(!isSafeExternalUrl("file:///C:/Windows/System32/calc.exe"), "不是 http(s) 一律拒绝");
  assert(!isSafeExternalUrl("javascript:alert(1)"), "伪协议要拒绝");
  assert(!isSafeExternalUrl("http://x/ & calc.exe"), "带 cmd 特殊字符要拒绝");
  assert(!isSafeExternalUrl('http://x/"y'), "带引号要拒绝");
  assert(!isSafeExternalUrl("http://x/ y"), "带空格要拒绝");
});