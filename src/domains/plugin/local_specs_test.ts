/**
 * 本地依赖协议改写（link:/portal: → file:）的测试。
 *
 * 四层：
 *   ① convertLocalSpec —— 纯字符串：换什么、不换什么（含真实取值 link:G:/02_开发项目/…）；
 *   ② planLocalSpecRewrites —— 纯 JSON：三个依赖字段都覆盖，坏输入不猜不改；
 *   ③ normalizeLocalSpecs —— 真落盘：往返、幂等（没要改的一个字节都不写）、异常不抛；
 *   ④ 接线守卫 + 体检结论：四处 npm 调用前都先规范化，体检能提前点出这条。
 */
import { assert, assertEquals } from "@std/assert";
import {
  convertLocalSpec,
  normalizeLocalSpecs,
  planLocalSpecRewrites,
  readLocalSpecRewrites,
  type SpecRewrite,
} from "./local_specs.ts";
import { depsFindings } from "./deps_actions.ts";
import type { DepsReport } from "./deps_actions.ts";

Deno.test("convertLocalSpec：link:/portal: 换 file:，其它写法一律不动", () => {
  // 用户现场的真实取值（2026-10-02 装机清单里那条）
  assertEquals(
    convertLocalSpec("link:G:/02_开发项目/DSH插件/prompt-optimizer").spec,
    "file:G:/02_开发项目/DSH插件/prompt-optimizer",
  );
  assertEquals(convertLocalSpec("link:../sibling").spec, "file:../sibling");
  assertEquals(convertLocalSpec("link:C:\\dev\\p").spec, "file:C:\\dev\\p");
  assertEquals(convertLocalSpec("portal:./y").spec, "file:./y");
  // 协议名大小写不敏感（pnpm 写的是小写，但清单是人手编的）
  assertEquals(convertLocalSpec("LINK:C:/x").spec, "file:C:/x");

  for (const keep of [
    "file:C:/already/ok.tgz",
    "^1.2.3",
    "1.2.3",
    "workspace:*",
    "npm:other-pkg@1.0.0",
    "git+https://github.com/a/b.git",
    "github:a/b",
    "",
  ]) {
    const out = convertLocalSpec(keep);
    assertEquals(out.changed, false, `不该被改：${keep}`);
    assertEquals(out.spec, keep.trim(), `原样返回：${keep}`);
  }
});

Deno.test("planLocalSpecRewrites：三个依赖字段都覆盖，非字符串跳过，没有要改的不给清单", () => {
  const text = JSON.stringify({
    name: "dsh-profile-web",
    dependencies: {
      "@local/prompt-optimizer": "link:G:/02_开发项目/DSH插件/prompt-optimizer",
      "dshmarket": "1.66.8",
    },
    devDependencies: { "my-dev": "portal:../dev" },
    optionalDependencies: { "my-opt": "link:./opt", "weird": 123 },
    peerDependencies: { "peer-one": "link:./peer" },
    dsh: { profile: { bundles: ["@local/prompt-optimizer"] } },
  });
  const plan = planLocalSpecRewrites(text);
  assertEquals(plan.rewrites.length, 3, `应改 3 条：${JSON.stringify(plan.rewrites)}`);
  assertEquals(plan.rewrites.map((r) => r.name), ["@local/prompt-optimizer", "my-dev", "my-opt"]);
  assertEquals(plan.rewrites.map((r) => r.field), ["dependencies", "devDependencies", "optionalDependencies"]);
  const next = plan.manifest as Record<string, Record<string, unknown>>;
  assertEquals(next.dependencies!["@local/prompt-optimizer"], "file:G:/02_开发项目/DSH插件/prompt-optimizer");
  assertEquals(next.dependencies!.dshmarket, "1.66.8", "普通版本串不许动");
  assertEquals(next.optionalDependencies!.weird, 123, "非字符串值不许动");
  assertEquals(next.peerDependencies!["peer-one"], "link:./peer", "peer 不落盘，不动");
  // dsh 那段（DSH 真正在用的配置）必须原样保留
  assertEquals(JSON.stringify((plan.manifest as { dsh: unknown }).dsh), JSON.stringify({ profile: { bundles: ["@local/prompt-optimizer"] } }));

  const clean = planLocalSpecRewrites(JSON.stringify({ dependencies: { a: "^1.0.0" } }));
  assertEquals(clean.rewrites.length, 0);
  assertEquals(clean.manifest, null, "没有要改的就不给清单（调用方据此不写盘）");
});

Deno.test("planLocalSpecRewrites：坏 JSON / 非对象 / 空文本一律空计划（不猜不改）", () => {
  for (const bad of ["{ 这不是 JSON", "", "[]", '"一个字符串"', "null", "42"]) {
    const plan = planLocalSpecRewrites(bad);
    assertEquals(plan.rewrites.length, 0, `不该产生改写：${bad}`);
    assertEquals(plan.manifest, null);
  }
});

Deno.test("normalizeLocalSpecs：落盘往返 + 幂等（没要改的一个字节都不写）", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-linkspec-" });
  try {
    const path = `${dir}/package.json`;
    await Deno.writeTextFile(
      path,
      JSON.stringify(
        { name: "p", dependencies: { "@local/prompt-optimizer": "link:G:/src/prompt-optimizer" } },
        null,
        2,
      ),
    );
    assertEquals(readLocalSpecRewrites(dir).length, 1, "只读体检能看到 1 条");

    const fixes = normalizeLocalSpecs(dir);
    assertEquals(fixes.length, 1);
    assertEquals(fixes[0]!.from, "link:G:/src/prompt-optimizer");
    assertEquals(fixes[0]!.to, "file:G:/src/prompt-optimizer");
    const onDisk = JSON.parse(await Deno.readTextFile(path)) as { dependencies: Record<string, string> };
    assertEquals(onDisk.dependencies["@local/prompt-optimizer"], "file:G:/src/prompt-optimizer");
    assertEquals(readLocalSpecRewrites(dir).length, 0, "改完就查不到了");

    // 幂等：第二次没有任何改写 —— 而且排版特殊时也必须原样不动
    const odd = '{\n    "dependencies":  {  "x": "^1.0.0"  }\n}';
    await Deno.writeTextFile(path, odd);
    assertEquals(normalizeLocalSpecs(dir).length, 0);
    assertEquals(await Deno.readTextFile(path), odd, "没要改的就不许重写清单（别把用户排版搅了）");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("normalizeLocalSpecs：清单缺失 / 坏 JSON / 目录不存在都不抛（不制造新失败点）", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-linkspec-bad-" });
  try {
    assertEquals(normalizeLocalSpecs(`${dir}/根本没有这个目录`).length, 0, "目录不存在");
    assertEquals(normalizeLocalSpecs(dir).length, 0, "目录在但没有清单");
    await Deno.writeTextFile(`${dir}/package.json`, "{ 这不是 JSON");
    assertEquals(normalizeLocalSpecs(dir).length, 0, "坏 JSON：让 npm 自己报它的错");
    assertEquals(await Deno.readTextFile(`${dir}/package.json`), "{ 这不是 JSON", "坏 JSON 绝不被改写");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("接线守卫：四处 npm 调用之前都先规范化（漏一处就等于没修）", async () => {
  // 直接用 URL 读（Windows 上 pathname 是百分号编码的，拼路径必踩坑）
  const mutate = await Deno.readTextFile(new URL("mutate.ts", import.meta.url));
  const deps = await Deno.readTextFile(new URL("deps_actions.ts", import.meta.url));

  const between = (src: string, from: string, to: string): string => {
    const a = src.indexOf(from);
    assert(a >= 0, `找不到起点：${from}`);
    const b = src.indexOf(to, a);
    assert(b > a, `找不到终点：${to}`);
    return src.slice(a, b);
  };

  // pmInstall / pmSync / pmUnlink：规范化调用必须排在 runCmd 之前
  for (
    const [name, sig, next] of [
      ["pmInstall", "async function pmInstall(", "async function pmSync("],
      ["pmSync", "export async function pmSync(", "async function pmUnlink("],
      ["pmUnlink", "async function pmUnlink(", "// ── 插件名防呆"],
    ] as const
  ) {
    const body = between(mutate, sig, next);
    const fixAt = body.indexOf("normalizeLocalSpecs(profileDir)");
    const runAt = body.indexOf("runCmd(");
    assert(fixAt >= 0, `${name} 没接上 normalizeLocalSpecs`);
    assert(runAt >= 0, `${name} 里找不到 runCmd`);
    assert(fixAt < runAt, `${name} 必须先规范化再调 npm`);
  }

  // plugin.syncLock（重建锁文件）自己也有一次 npm 调用
  const syncLock = between(deps, "async function runSyncLock(", "export const pluginSyncLockAction");
  assert(
    syncLock.indexOf("normalizeLocalSpecs(profileDir)") < syncLock.indexOf("runCmd("),
    "重建锁文件也必须先规范化（--package-lock-only 同样过不了 npm 这关）",
  );
});

Deno.test("体检：命中 link: 时点出 plugin.local-protocol，没命中仍是 deps-ok", () => {
  const base: DepsReport = {
    profileDir: "C:/x",
    problems: [],
    lock: {
      path: "C:/x/package-lock.json",
      exists: false,
      corrupt: false,
      lockfileVersion: null,
      note: "profile 目录里没有 package-lock.json",
    },
    summary: { duplicates: 0, conflicts: 0, lockOk: false },
    localSpecs: [],
    findings: [],
  };
  assertEquals(depsFindings(base)[0]!.id, "plugin.deps-ok", "没有本地协议问题时结论是「没发现问题」");

  const rewrites: SpecRewrite[] = [
    { name: "@local/prompt-optimizer", field: "dependencies", from: "link:G:/src/p", to: "file:G:/src/p" },
  ];
  const out = depsFindings({ ...base, localSpecs: rewrites });
  const hit = out.find((f) => f.id === "plugin.local-protocol");
  assert(hit, "应报 plugin.local-protocol");
  assertEquals(hit!.severity, "warn");
  assert(hit!.cause!.includes("@local/prompt-optimizer"), "要说清是哪一条");
  assert(hit!.impact!.includes("EUNSUPPORTEDPROTOCOL"), "影响里要点名真实报错");
  assert(hit!.action!.includes("file:"), "建议动作要给出路");
  assertEquals(out.some((f) => f.id === "plugin.deps-ok"), false, "有问题时不该同时报「没发现问题」");
});
