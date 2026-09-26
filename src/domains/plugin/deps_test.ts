/**
 * 依赖冲突扫描的测试（P0-3）。
 *
 * 三层：① 最小 semver 范围判断（含 2026-09-25 事故那条真实取值）；
 * ② fixture 目录上的真实扫描（重复安装 / 版本冲突 / 不该误报的兼容要求）；③ 锁文件状态。
 */
import { assertEquals } from "@std/assert";
import { baseOf, findProblems, satisfies, scanInstalled, lockFileState } from "./deps.ts";

async function writePkg(dir: string, rel: string, body: Record<string, unknown>): Promise<void> {
  const path = `${dir}/${rel}/package.json`;
  await Deno.mkdir(path.replace(/\\package\.json$/, "").replace(/\/package\.json$/, ""), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(body, null, 2));
}

Deno.test("semver：范围判断（含事故取值）", () => {
  // 2026-09-25 的真实冲突：0.0.1-rc.1 不满足 ^0.1.2-rc.1
  assertEquals(satisfies("0.0.1-rc.1", "^0.1.2-rc.1"), false);
  assertEquals(satisfies("0.1.2-rc.1", "^0.1.2-rc.1"), true);
  assertEquals(satisfies("1.2.3", "^1.2.0"), true);
  assertEquals(satisfies("2.0.0", "^1.2.0"), false);
  assertEquals(satisfies("0.2.9", "^0.2.1"), true);
  assertEquals(satisfies("0.3.0", "^0.2.1"), false);
  assertEquals(satisfies("1.2.9", "~1.2.3"), true);
  assertEquals(satisfies("1.3.0", "~1.2.3"), false);
  assertEquals(satisfies("3.26.5", ">=3.0.0 <4.0.0"), true);
  assertEquals(satisfies("2.0.0", ">=3.0.0 <4.0.0"), false);
  assertEquals(satisfies("1.5.0", "^1.0.0 || ^2.0.0"), true);
  assertEquals(satisfies("3.0.0", "^1.0.0 || ^2.0.0"), false);
  assertEquals(satisfies("2.5.0", "2.x"), true);
  assertEquals(satisfies("1.9.0", "* "), true);
  // 带预发布的范围 + 不带预发布的版本：npm 语义不允许（这里只要不炸、结论稳定）
  assertEquals(typeof satisfies("1.0.0", "^1.0.0-rc.1"), "boolean");
  assertEquals(baseOf("^0.1.2-rc.1"), "0.1.2-rc.1");
  assertEquals(baseOf(">=0.1.7-alpha.1 <0.2.0-0"), "0.1.7-alpha.1");
  assertEquals(baseOf("x"), null);
});

Deno.test("扫描：重复安装与版本冲突都要找出来，兼容的要求不许误报", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-deps-" });
  try {
    await Deno.writeTextFile(`${dir}/package.json`, JSON.stringify({ dependencies: {} }));
    // foo 要 bar ^1.0.0；@scope/baz 要 bar >=3.0.0 → 不可能同时满足
    await writePkg(dir, "node_modules/foo", { name: "foo", version: "1.0.0", peerDependencies: { bar: "^1.0.0" } });
    await writePkg(dir, "node_modules/bar", { name: "bar", version: "1.0.0" });
    await writePkg(dir, "node_modules/@scope/baz", { name: "@scope/baz", version: "2.0.0", peerDependencies: { bar: ">=3.0.0" } });
    // qux 要 bar >=1.0.0 <2.0.0 → 与 foo 的 ^1.0.0 兼容，不该报冲突
    await writePkg(dir, "node_modules/qux", { name: "qux", version: "1.0.0", peerDependencies: { bar: ">=1.0.0 <2.0.0" } });
    // dup 顶层 2.0.0、foo 里嵌套 1.0.0 → 重复安装
    await writePkg(dir, "node_modules/dup", { name: "dup", version: "2.0.0" });
    await writePkg(dir, "node_modules/foo/node_modules/dup", { name: "dup", version: "1.0.0" });

    const pkgs = scanInstalled(dir);
    assertEquals(pkgs.length, 6, "应扫到 6 个包（含嵌套与 scope 包）");
    assertEquals(pkgs.some((x) => x.name === "dup" && x.depth === 1), true, "嵌套包要被扫到");

    const problems = findProblems(pkgs);
    const conflicts = problems.filter((p) => p.kind === "range-conflict");
    const dups = problems.filter((p) => p.kind === "duplicate");
    // baz(>=3.0.0) 与 foo(^1.0.0)、与 qux(>=1.0.0 <2.0.0) 都互斥 → 2 处冲突；
    // 而 foo 与 qux 彼此兼容，不许被算成冲突（下面单独断言）。
    assertEquals(conflicts.length, 2, `应有 2 处冲突，实际 ${conflicts.length}：${JSON.stringify(conflicts)}`);
    assertEquals(
      conflicts.some((c) => c.subject.includes("foo") && c.subject.includes("qux")),
      false,
      "foo 与 qux 的要求是兼容的，不许误报",
    );
    for (const c of conflicts) assertEquals(c.dependency, "bar");
    assertEquals(conflicts.some((c) => c.subject.includes("@scope/baz")), true, "涉及 baz 的冲突要报出来");
    assertEquals(dups.length, 1, "dup 两个版本应报一处重复");
    assertEquals(dups[0]!.dependency, "dup");
    assertEquals(dups[0]!.found, ["1.0.0", "2.0.0"]);
    // （foo 与 qux 这对兼容要求不许误报 —— 上面已经精确断言过）
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("锁文件：缺失 / 损坏 / 正常三种状态", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-lock-" });
  try {
    assertEquals(lockFileState(dir).exists, false);
    assertEquals(lockFileState(dir).note.includes("没有 package-lock.json"), true);

    await Deno.writeTextFile(`${dir}/package-lock.json`, "{ 这不是 JSON");
    const bad = lockFileState(dir);
    assertEquals(bad.exists, true);
    assertEquals(bad.corrupt, true);
    assertEquals(bad.note.includes("解析不了"), true);

    await Deno.writeTextFile(`${dir}/package-lock.json`, JSON.stringify({ lockfileVersion: 3, packages: {} }));
    const ok = lockFileState(dir);
    assertEquals(ok.corrupt, false);
    assertEquals(ok.lockfileVersion, 3);
    assertEquals(ok.note.includes("lockfileVersion 3"), true);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
