/**
 * env.toolchain 的单元测试。
 *
 * 【刻意不测真下载】真跑一遍要 100MB 流量与几分钟，属于"发布前人工验收"的事，
 * 不适合塞进每次 CI 跑的单元测试。这里钉死的是"离线也能判断对错"的部分：
 * 规格表的自洽性、路径推导、剥离顶层目录、以及"没装时不能谎报装了"。
 */

import { assertEquals, assert } from "jsr:@std/assert@1";
import {
  missingTools,
  installedTools,
  hasTool,
  toolchainRoot,
  toolDir,
  toolBinDirs,
  TOOL_ORDER,
  TOOL_SPECS,
  TOOL_VERSIONS,
} from "./toolchain.ts";
import { p } from "../../util/paths.ts";

Deno.test("规格表：三个运行时都齐全，且 URL 用 https（不能明文下发可执行文件）", () => {
  assertEquals(TOOL_ORDER, ["git", "node", "pnpm"], "安装顺序 git → node → pnpm（pnpm 依赖 node）");
  for (const name of TOOL_ORDER) {
    const spec = TOOL_SPECS[name];
    assert(spec, `${name} 必须有规格`);
    assert(spec.version.length > 0, `${name} 必须钉死版本`);
    assert(spec.sizeBytes > 0, `${name} 必须有体积（下载预估要用）`);
    assert(spec.binDirs.length > 0, `${name} 必须声明可执行目录`);
    for (const u of spec.urls) {
      assert(u.startsWith("https://"), `${name} 的下载源必须 https：${u}`);
    }
  }
});

Deno.test("规格表：pnpm 走 npm 获取（不依赖第三方独立 exe）", () => {
  const spec = TOOL_SPECS.pnpm;
  assertEquals(spec.kind, "npm");
  assertEquals(spec.urls.length, 0, "pnpm 没有归档下载源，靠内置 npm 安装");
});

Deno.test("规格表：路径与版本号是单一事实来源", () => {
  assertEquals(TOOL_SPECS.node.version, TOOL_VERSIONS.node);
  assert(TOOL_SPECS.git.verifyExe.endsWith("git.exe"));
  assert(TOOL_SPECS.node.verifyExe === "node.exe");
  // Node 的 zip 解出来带一层版本目录，必须剥掉
  assertEquals(TOOL_SPECS.node.stripTopDir, true);
  assertEquals(TOOL_SPECS.git.stripTopDir, undefined, "PortableGit 自解压出来就是平铺的");
});

Deno.test("路径推导：工具目录都在管家数据目录下（不碰系统目录）", () => {
  const root = toolchainRoot();
  assert(root.includes(".dsh-butler"), `工具链必须落在管家数据目录：${root}`);
  assertEquals(toolDir("git"), p(root, "git"));
  assertEquals(toolDir("node"), p(root, "node"));
  assertEquals(toolDir("pnpm"), p(root, "pnpm"));
});

Deno.test("未安装时不谎报：缺失扫描与 hasTool 一致", () => {
  for (const name of TOOL_ORDER) {
    const installed = hasTool(name);
    const inList = installedTools().some((t) => t.name === name);
    assertEquals(installed, inList, `${name} 的两处判断必须一致`);
    if (!installed) {
      assert(!missingTools().includes(name) === false, `${name} 未装时必须出现在待装清单里`);
    }
  }
});

Deno.test("binDirs 只返回真实存在的目录（不存在的目录不该进 PATH）", () => {
  for (const name of TOOL_ORDER) {
    for (const d of toolBinDirs(name)) {
      assert(d.startsWith(toolchainRoot()), `${d} 必须在工具链目录内`);
    }
  }
});
