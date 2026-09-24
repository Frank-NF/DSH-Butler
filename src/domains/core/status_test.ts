/**
 * core.status 的判据回归测试。
 *
 * 为什么这些逻辑必须有测试：
 *   scanResidue / readPluginLists 的【误报】会直接导致用户清掉真正的依赖，
 *   插件当场全崩；而实测发现这两个判据的第一版都报错了东西
 *   （把 @deepseek-ai/dsh-base 当"依赖缺失"、把 85 个传递依赖当"残留包"）。
 *   用 2026-09-24 本机真实观察到的目录名做样本，钉住"该报的报、不该报的绝不报"。
 */

import {
  isWindows,
  normalize,
  p,
  quarantineRootFor,
  sameVolume,
  volumeOf,
} from "../../util/paths.ts";
import { readPluginLists, residueKindOf, scanResidue } from "./status.ts";

// ── 极简断言（不引外部依赖，保证测试在任何网络环境下都能跑） ──────

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`,
    );
  }
}

function assertIncludes(haystack: string[], needle: string, msg: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(
      `断言失败：${msg}\n  期望包含 ${JSON.stringify(needle)}\n  实际 ${JSON.stringify(haystack)}`,
    );
  }
}

function assertExcludes(haystack: string[], needle: string, msg: string): void {
  if (haystack.includes(needle)) {
    throw new Error(
      `断言失败：${msg}\n  不该包含 ${JSON.stringify(needle)}\n  实际 ${JSON.stringify(haystack)}`,
    );
  }
}

// ══ 残留物判据 ════════════════════════════════════════════════════

Deno.test("residueKindOf：五种真实残留形态必须全部命中", () => {
  // 样本全部取自 2026-09-24 本机 profile/node_modules 的实测
  const residual = [
    "@codemirror/.autocomplete_tmp_15580_31-2kN2ZzMh", // scope 下的隐藏目录
    "@alcalzone/.ansi-tokenize-UrBYhFyc",
    "@deepseek-ai/.dsh-subprocess-JedPizTD",
    "nan_tmp_1248_8", // _tmp_<pid>_<n>
    "dsh-ego-browser_tmp_1248_2",
    "undici-types_tmp_1248_18",
    "ansi-regex-AFJM5CM4", // 随机后缀（8 位，含大小写与数字）
    "chalk-rGZ71ppw",
    "clsx_tmp_15580_4-BNzciLPQ",
    "dshmarket_20260924_110135", // 换版本时暂存的旧副本
    ".residue_backup_20260918", // 上次清理留下的暂存区
  ];
  for (const n of residual) {
    assert(residueKindOf(n) !== null, `应判为残留却没有：${n}`);
  }
});

Deno.test("residueKindOf：正常依赖一个都不许判成残留", () => {
  // 这些全是插件或本体的合法依赖，清掉就会出事
  const legit = [
    // 第三方传递依赖
    "rolldown",
    "tsdown",
    "typescript",
    "ssh2",
    "js-yaml",
    "zod",
    "yaml",
    "ws",
    "picomatch",
    "schemastery",
    "commander",
    "undici",
    "tweetnacl",
    "safer-buffer",
    "markdown-to-jsx",
    "typescript-win32-x64",
    "binding-win32-x64-msvc",
    // DSH 自己的包
    "cosmokit",
    "dsh-subprocess",
    "@deepseek-ai/dsh-base",
    // 第三方插件本体
    "dsh-cost-meter",
    "dsh-mcp-panel",
    "dsh-github-workbench",
    "dshmarket",
    "dsh-client-ui-skill-explorer",
    "@liustack/modlens",
    "@linxin666/dsh-client-ui-skill-explorer",
    // dsh-mnemon 的子包（卸了 mnemon 才会消失，不是残留）
    "dsh-mnemon-provider-mem0",
    "dsh-mnemon-provider-byterover",
    "dsh-mnemon-source-documents",
    "dsh-mnemon-strategy-default-three-tier",
    "dsh-ego-browser",
  ];
  for (const n of legit) {
    assertEq(residueKindOf(n), null, `把正常依赖误判成残留了：${n}`);
  }
});

Deno.test("residueKindOf：随机后缀判据不能被普通包名蒙混过关", () => {
  // 只有"恰好 8 位 + 至少含一个大写与一个数字"才算，缺一项都不算
  assertEq(residueKindOf("foo-abcdefgh"), null, "全小写 8 位不是 pnpm 随机串");
  assertEq(residueKindOf("foo-12345678"), null, "全数字 8 位不是 pnpm 随机串");
  assertEq(residueKindOf("foo-ABCDEFGH"), null, "全大写无数字不是 pnpm 随机串");
  assertEq(residueKindOf("foo-aB3dE5gHx"), null, "大小写数字都有、但不是恰好 8 位");
  assert(residueKindOf("foo-aB3dE5gH") !== null, "恰好 8 位且含大写与数字，应命中");
  // 实测反例：本机真有一个纯大写的随机串，漏了它就会漏报真残留
  assert(residueKindOf("ansi-regex-AFJM5CM4") !== null, "纯大写但含数字的 8 位随机串应命中");
});

Deno.test("scanResidue：真实 node_modules 上跑一遍，确认零误报", () => {
  const profileNm = "C:\\Users\\niufe\\.dsh\\profiles\\web\\node_modules";
  if (!isWindows) return; // 样本来自本机 Windows 环境
  let exists = false;
  try {
    exists = Deno.statSync(profileNm).isDirectory;
  } catch { /* 换机器就没这个目录 */ }
  if (!exists) return;

  const found = scanResidue(profileNm);
  const names = found.map((r) => r.name);

  // 关键回归：这几类曾经被误报成"残留包"
  for (
    const mustNot of [
      "rolldown",
      "typescript",
      "nan",
      "ws",
      "zod",
      "cosmokit",
      "@deepseek-ai/dsh-subprocess",
    ]
  ) {
    assertExcludes(names, mustNot, "正常依赖被误报为残留");
  }
  // 拿 scoped 名字再核一遍（scanResidue 对 scoped 是拆开成 @scope/sub 的）
  assertExcludes(names, "@liustack/modlens", "第三方插件本体被误报");
});

/**
 * 「必须抓到残留」这条断言【不能】拿本机真实 node_modules 当依据。
 *
 * 2026-09-24 实测教训：用户在界面上点了一次「清理残留」，27 处残留被移进隔离区，
 * 于是上面那条基于机器现状的断言立刻变红 —— 那是"测试跟着环境漂"，不是真回归。
 * 改为自建样本目录：既是确定性回归，也不会被用户的一次正常操作影响。
 */
Deno.test("scanResidue：自建样本 —— scope 里的 _tmp_ 残留必抓，正常包绝不误报", () => {
  const dir = Deno.makeTempDirSync({ prefix: "butler-residue-" });
  try {
    const mk = (rel: string) => Deno.mkdirSync(p(dir, rel), { recursive: true });
    // 该抓的：scope 下的 pnpm 暂存目录、纯大写随机后缀
    mk("@codemirror/.autocomplete_tmp_15580_31-2kwZ2ZfMh");
    mk("@codemirror/ansi-regex-AFJM5CM4");
    // 不该抓的：正常包、正常 scope 包、DSH 自带包
    mk("rolldown");
    mk("typescript");
    mk("@liustack/modlens");
    mk("@deepseek-ai/dsh-subprocess");

    const names = scanResidue(dir).map((r) => r.name);
    assert(
      names.some((n) => n.startsWith("@codemirror/") && n.includes("_tmp_")),
      "藏在 scope 目录里的 pnpm 暂存残留没有被扫到",
    );
    assert(
      names.some((n) => n.includes("ansi-regex-AFJM5CM4")),
      "纯大写随机后缀的残留没有被扫到",
    );
    assertExcludes(names, "rolldown", "正常依赖被误报为残留");
    assertExcludes(names, "typescript", "正常依赖被误报为残留");
    assertExcludes(names, "@liustack/modlens", "第三方插件本体被误报");
    assertExcludes(names, "@deepseek-ai/dsh-subprocess", "DSH 自带包被误报");
  } finally {
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch { /* 清理失败不影响结论 */ }
  }
});

// ══ 路径归一化（这里曾出过一个静默大坑） ══════════════════════════

Deno.test("normalize：盘符与首段之间必须保留分隔符", () => {
  if (isWindows) {
    // 曾经的 bug：G:\DeepSeek_Harness 被归一化成 G:DeepSeek_Harness，
    // 导致后续 git 探测、构建记录查找全部静默落空（探测本身用原始路径所以照常成功）
    assertEq(normalize("G:\\DeepSeek_Harness"), "G:\\DeepSeek_Harness", "盘符后丢了分隔符");
    assertEq(normalize("C:\\Users\\niufe"), "C:\\Users\\niufe", "盘符后丢了分隔符");
    assertEq(normalize("G:/DeepSeek_Harness/"), "G:\\DeepSeek_Harness", "尾部斜杠未去掉");
    assertEq(normalize("G:\\a\\..\\b"), "G:\\b", ".. 未正确回溯");
    // "." 是当前目录，不是垃圾段：G:\a\.\b 就等于 G:\a\b
    assertEq(normalize("G:\\a\\.\\b"), "G:\\a\\b", ". 处理错误");
    assertEq(normalize("G:\\"), "G:\\", "盘符根不应被改写");
    assertEq(normalize("\\\\srv\\share\\x"), "\\\\srv\\share\\x", "UNC 前缀被吃掉了");
  } else {
    assertEq(normalize("/home/x/"), "/home/x", "POSIX 路径归一化错误");
  }
});

Deno.test("quarantineRootFor：隔离区必须与本体同盘同级（跨盘 rename 必失败）", () => {
  const root = isWindows ? "G:\\DeepSeek_Harness" : "/srv/DeepSeek_Harness";
  const q = quarantineRootFor(root);
  assert(sameVolume(root, q), "隔离区与本体不同盘 —— 移动会整体失败且被静默跳过");
  assert(!q.includes("DeepSeek_Harness" + (isWindows ? "\\" : "/")), "隔离区被放进了本体内部");
  if (isWindows) {
    assertEq(volumeOf(root), "G:", "卷标识解析错误");
    assertEq(q, "G:\\dsh-quarantine", "隔离区位置不符合约定");
  }
});

// ══ 插件双名单 ════════════════════════════════════════════════════

Deno.test("readPluginLists：本体自带基座包算 inBox，不算依赖缺失", () => {
  // 复刻本机真实清单：bundles 里的 @deepseek-ai/* 从本体解析，不该写进 profile 的 dependencies
  const dir = Deno.makeTempDirSync();
  try {
    const profileDir = `${dir}\\profiles\\web`;
    Deno.mkdirSync(profileDir, { recursive: true });

    // 造一个"本体安装目录"，让两个基座包能被解析到
    for (const base of ["dsh-base", "dsh-web-app"]) {
      Deno.mkdirSync(`${dir}\\node_modules\\@deepseek-ai\\${base}`, { recursive: true });
      Deno.writeTextFileSync(
        `${dir}\\node_modules\\@deepseek-ai\\${base}\\package.json`,
        JSON.stringify({ name: `@deepseek-ai/${base}` }),
      );
    }
    // 再造一个第三方插件（从 profile 侧解析）
    Deno.mkdirSync(`${profileDir}\\node_modules\\dsh-cost-meter`, { recursive: true });
    Deno.writeTextFileSync(
      `${profileDir}\\node_modules\\dsh-cost-meter\\package.json`,
      JSON.stringify({ name: "dsh-cost-meter" }),
    );

    const pkgPath = `${profileDir}\\package.json`;
    Deno.writeTextFileSync(
      pkgPath,
      JSON.stringify({
        dependencies: { "dsh-cost-meter": "^1.0.0", "dsh-not-loaded": "^1.0.0" },
        dsh: {
          profile: {
            bundles: [
              "@deepseek-ai/dsh-base",
              "@deepseek-ai/dsh-web-app",
              "dsh-cost-meter",
              "dsh-ghost-plugin", // 哪里都解析不到 → 真缺失
            ],
          },
        },
      }),
    );

    const r = readPluginLists(pkgPath, { installRoot: dir, profileDir });
    assert(r !== null, "应能读出清单");
    if (!r) return;

    assertEq(r.inBox.length, 2, "两个基座包应算 inBox");
    assertIncludes(r.inBox, "@deepseek-ai/dsh-base", "dsh-base 应算 inBox");
    assertIncludes(r.inBox, "@deepseek-ai/dsh-web-app", "dsh-web-app 应算 inBox");
    assertEq(r.bundledButUndeclared.length, 1, "只有解析不到的才算缺失");
    assertIncludes(r.bundledButUndeclared, "dsh-ghost-plugin", "解析不到的应算缺失");
    assertExcludes(r.bundledButUndeclared, "@deepseek-ai/dsh-base", "基座包绝不能被报成缺失");
    assertIncludes(r.declaredButInactive, "dsh-not-loaded", "声明了但不在名单里的应被指出");
    assertEq(r.active.length, 1, "生效数应只算交集");
    assertIncludes(r.active, "dsh-cost-meter", "交集计算错误");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("readPluginLists：不传定位信息时【绝不】把名字报成缺失", () => {
  // 信息不足时宁可退化为"都算 inBox"，也不能制造假警报
  const dir = Deno.makeTempDirSync();
  try {
    const pkgPath = `${dir}\\package.json`;
    Deno.writeTextFileSync(
      pkgPath,
      JSON.stringify({
        dependencies: {},
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "whatever"] } },
      }),
    );
    const r = readPluginLists(pkgPath);
    assert(r !== null, "应能读出清单");
    if (!r) return;
    assertEq(r.bundledButUndeclared.length, 0, "信息不足时不该报缺失");
    assertEq(r.inBox.length, 2, "信息不足时应全部归入 inBox");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
