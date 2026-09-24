/**
 * plugin.facts 的采集层测试。
 *
 * 这里测的全是「判据本身」—— 它们错了，上层 12 条规则就会集体误报/漏报：
 *   - extractInsertIds：只认 `- insert:` 块内的 id。真机 profile 顶层全是
 *     targeting `- id:`，算进来正常机器天天误报（AC-P4 阴性基线的源头）。
 *   - judgeLayer：与本体 throw 点逐条对齐；特别要钉住
 *     `dsh.bundle.patch` 是【字符串或字符串数组】双形态 ——
 *     真机 @deepseek-ai/dsh-web-app 就是 5 元素数组，只判字符串会误报基座包。
 *
 * 全部用临时目录 fixture，不碰真实 DSH 目录（方案 §10.3）。
 */

import { isFile } from "../../host/fs.ts";
import { p } from "../../util/paths.ts";
import { extractInsertIds, judgeLayer } from "./facts.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
  }
}

function assertArrEq(actual: string[], expected: string[], msg: string): void {
  assertEq(JSON.stringify(actual), JSON.stringify(expected), msg);
}

// ══ extractInsertIds ═══════════════════════════════════════════════

Deno.test("extractInsertIds：只收 - insert: 块内的 id（真机 dshmarket 形态）", () => {
  const yaml = `
plugins:
  - insert:
      - id: dsh-market
        config:
          foo: 1
`;
  assertArrEq(extractInsertIds(yaml), ["dsh-market"], "insert 块内的 id 没收到");
});

Deno.test("extractInsertIds：顶层 targeting - id: 绝不算 insert（真机 profile 形态，防误报根基）", () => {
  // 真机 cordis.patch.yml 顶层全是这种 targeting —— 它们是对已有 entry 的
  // config 覆盖，不新建 loader entry，算成重复注册的话正常机器天天报
  const yaml = `
# aigc-canvas 曾双重注册的教训，见历史
plugins:
  - id: aigc-canvas
    config:
      enabled: false
  - id: dsh-market
    config:
      sidebar: true
  - insert:
      - id: only-this-one-counts
`;
  assertArrEq(extractInsertIds(yaml), ["only-this-one-counts"], "targeting 被误算成 insert");
});

Deno.test("extractInsertIds：注释与空行不干扰，缩进回到外层即结束 insert 块", () => {
  const yaml = `
# 注释里的 insert: 和 id: 都不许算
plugins:
  - insert:
      # 块内注释
      - id: first

  - id: targeting-after-block
    config: {}
  - insert:
      - id: second
      - id: "quoted-third"
`;
  assertArrEq(extractInsertIds(yaml), ["first", "second", "quoted-third"], "多块 insert / 块结束判定有误");
});

Deno.test("extractInsertIds：insert 深处 config 里的 - id: 是数据不是 entry（真机 presets 形态，防误报根基）", () => {
  // 2026-09-24 真机教训：第一版把块内任意深度的 - id: 都收了，
  // 真机一跑报出 32 条假「重复注册」—— tool-bash/persona 其实躺在
  // preset-standard 的 config.plugins[] 里，根本不是 loader entry。
  const yaml = `
# Agent preset standard: one declaration inserted after the web patch.
- insert:
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are a coding agent.
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            config:
              approval: ask
    - id: preset-second
      name: '@deepseek-ai/dsh-agent-preset'
`;
  // 直接子级只有 preset-standard / preset-second；深处的 persona / tool-bash 是配置数据
  assertArrEq(extractInsertIds(yaml), ["preset-standard", "preset-second"], "把 config 深处的 id 当成了 entry");
});

// ══ judgeLayer（四态，用临时目录 fixture） ══════════════════════════

function makePkg(dir: string, pkgJson: unknown, files: Record<string, string> = {}): string {
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(p(dir, "package.json"), JSON.stringify(pkgJson));
  for (const [name, content] of Object.entries(files)) {
    const fp = p(dir, name);
    Deno.mkdirSync(p(fp, ".."), { recursive: true });
    Deno.writeTextFileSync(fp, content);
  }
  return dir;
}

Deno.test("judgeLayer：dir=null → unresolved（解析不到）", () => {
  const v = judgeLayer("ghost", null);
  assertEq(v.canLayer, false, "解析不到当然不能作层");
  assertEq(v.reason, "unresolved", "原因应为 unresolved");
});

Deno.test("judgeLayer：没有 dsh.bundle 对象 → no-dsh-bundle", () => {
  const dir = Deno.makeTempDirSync();
  try {
    makePkg(dir, { name: "plain-pkg" });
    const v = judgeLayer("plain-pkg", dir);
    assertEq(v.canLayer, false, "没有 dsh.bundle 不能作层");
    assertEq(v.reason, "no-dsh-bundle", "原因判错");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("judgeLayer：patch 是字符串且文件存在 → 可作层（真机 dshmarket 形态）", () => {
  const dir = Deno.makeTempDirSync();
  try {
    makePkg(dir, { name: "dshmarket", dsh: { bundle: { patch: "./cordis.patch.yml" } } }, { "cordis.patch.yml": "plugins: []\n" });
    const v = judgeLayer("dshmarket", dir);
    assertEq(v.canLayer, true, "字符串 patch + 文件存在应可作层");
    assertArrEq(v.patchFiles, ["./cordis.patch.yml"], "patchFiles 应记录声明原文");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("judgeLayer：patch 是字符串数组且文件都在 → 可作层（真机 web-app 5 元素形态，防误报）", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const files = ["a.yml", "b.yml", "c.yml", "d.yml", "e.yml"];
    makePkg(
      dir,
      { name: "@deepseek-ai/dsh-web-app", dsh: { bundle: { patch: files.map((f) => `./${f}`) } } },
      Object.fromEntries(files.map((f) => [f, "plugins: []\n"])),
    );
    const v = judgeLayer("@deepseek-ai/dsh-web-app", dir);
    assertEq(v.canLayer, true, "数组形态的 patch 是合法的 —— 只判字符串会把基座包误报成不可作层");
    assertEq(v.patchFiles.length, 5, "5 个 patch 文件都要记录");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("judgeLayer：patch 既非字符串也非字符串数组 → patch-illegal", () => {
  const dir = Deno.makeTempDirSync();
  try {
    makePkg(dir, { name: "bad-pkg", dsh: { bundle: { patch: 42 } } });
    const v = judgeLayer("bad-pkg", dir);
    assertEq(v.canLayer, false, "patch=42 不能作层");
    assertEq(v.reason, "patch-illegal", "原因判错");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("judgeLayer：声明的 patch 文件不存在 → patch-missing（loadOverlayPatches 会 throw）", () => {
  const dir = Deno.makeTempDirSync();
  try {
    makePkg(dir, { name: "bad-pkg", dsh: { bundle: { patch: "./cordis.patch.yml" } } }, {});
    const v = judgeLayer("bad-pkg", dir);
    assertEq(v.canLayer, false, "patch 文件缺失不能作层");
    assertEq(v.reason, "patch-missing", "原因判错");
    assert(isFile(p(dir, "package.json")), "fixture 自身没造好，测试无效");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
