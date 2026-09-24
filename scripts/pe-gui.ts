/**
 * PE 子系统补丁：CUI（控制台程序）→ GUI（窗口程序）。
 *
 * 2026-09-24 实测定论：`deno desktop` 产物**本来就是 Subsystem=2（GUI）**，
 * 双击零黑窗，本脚本对它是幂等 no-op。历史上误以为产物是 CUI（把 2 读成了
 * CUI），并据此写过一版常量表反了的补丁，把 exe 改成 NATIVE 导致 193 起不来。
 * 保留本脚本作为「若未来 deno 改为输出 CUI(3) 时的一键修正」+ 结构自检。
 *
 * 改成 GUI（Subsystem=1）后的效果：
 *   - 进程**根本不创建控制台** → 双击零黑窗（不是"藏起来"，是压根没有）；
 *   - 派生的控制台子进程（git/powershell…）**继承不到控制台**，会各开各的
 *     新窗口 —— 这是本补丁的代价，子进程是否闪窗需另行验证/封装（见 shell.ts）；
 *   - `Deno.stdout.isTerminal()` 变 false → 不往控制台刷日志，只落盘（正确行为）；
 *   - 仅影响**编译产物**，`deno desktop --hmr` 开发态不走本补丁，终端照常。
 *
 * 已知取舍：GUI 进程从 cmd.exe 交互启动时 stdout 无效（headless 的 READY 打不到
 * 控制台）。Git Bash / 管道启动时句柄照常继承，能拿到；脚本对接一律以
 * 固定端口 /healthz 为准，README 有记。
 *
 * PE 头事实（本脚本依赖，勿改）：
 *   - PE 签名偏移 = e_lfanew（文件 0x3C 处的 u32）
 *   - Optional Header 紧跟 COFF 头（签名 4 + COFF 20）
 *   - **Subsystem 在 Optional Header 内偏移 68** —— PE32 与 PE32+ 恰好相同
 *     （PE32 头 28 字节标准段，PE32+ 头 24 字节但 ImageBase 多 4 字节，殊途同归）
 *   - 值：1 = IMAGE_SUBSYSTEM_NATIVE（本机态，Win32 拒绝运行，报
 *     「%1 应用程序无法在 Win32 模式中运行」）、2 = IMAGE_SUBSYSTEM_WINDOWS_GUI、
 *     3 = IMAGE_SUBSYSTEM_WINDOWS_CUI
 *   ⚠️ 2026-09-24 踩坑：本脚本旧版把 1/2 当成 GUI/CUI，把 deno desktop 已经是
 *     GUI(2) 的产物改成了 NATIVE(1)，exe 直接起不来。真实常量表如上，勿再写反。
 *
 * 幂等：已是 GUI 则直接通过（可重复跑）。
 */

const SUBSYSTEM_OFFSET_IN_OPTIONAL = 68;
const CUI = 3;
const GUI = 2;

function patchExeToGui(path: string): { changed: boolean; detail: string } {
  const data = new Uint8Array(Deno.readFileSync(path));
  const dv = new DataView(data.buffer);

  if (data.length < 0x40) throw new Error(`${path}: 文件太小，不是有效 PE`);
  const e_lfanew = dv.getUint32(0x3c, true);
  const sig = String.fromCharCode(data[e_lfanew], data[e_lfanew + 1], data[e_lfanew + 2], data[e_lfanew + 3]);
  if (sig !== "PE\0\0") throw new Error(`${path}: PE 签名不存在（读到 ${JSON.stringify(sig)}）`);

  const optStart = e_lfanew + 4 + 20; // 签名 + COFF 头
  const magic = dv.getUint16(optStart, true);
  if (magic !== 0x10b && magic !== 0x20b) {
    throw new Error(`${path}: 未知 Optional Header magic 0x${magic.toString(16)}`);
  }

  const subOff = optStart + SUBSYSTEM_OFFSET_IN_OPTIONAL;
  const current = dv.getUint16(subOff, true);

  if (current === GUI) {
    return { changed: false, detail: "已是 GUI，无需修改（幂等跳过）" };
  }
  if (current !== CUI) {
    throw new Error(`${path}: 意外的 Subsystem=${current}（既非 CUI=3 也非 GUI=2），拒绝修改`);
  }

  dv.setUint16(subOff, GUI, true);
  Deno.writeFileSync(path, data);

  // 写后回读校验 —— 改 PE 头这种事不回读等于没做
  const verify = new DataView(new Uint8Array(Deno.readFileSync(path)).buffer);
  const after = verify.getUint16(optStart + SUBSYSTEM_OFFSET_IN_OPTIONAL, true);
  if (after !== GUI) throw new Error(`${path}: 写入后回读为 ${after}，期望 ${GUI} — 补丁失败`);

  return { changed: true, detail: `CUI(3) → GUI(2)，回读校验通过` };
}

const target = Deno.args[0];
if (!target) {
  console.error("用法: deno run -A scripts/pe-gui.ts <exe路径>");
  Deno.exit(2);
}

try {
  const r = patchExeToGui(target);
  console.log(`[pe-gui] ${target}: ${r.detail}`);
} catch (e) {
  console.error(`[pe-gui] 失败：${(e as Error).message}`);
  Deno.exit(1);
}
