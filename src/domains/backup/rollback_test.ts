/**
 * 回滚点生命周期的判据回归测试（方案 §8.1/§8.2 → AC-C3 的地基）。
 *
 * 每条都对应一条方案规则，缺一条回滚就是纸糊的：
 *   - create write-ahead：先落盘再见索引；失败不留半成品；
 *   - apply 三段闸：完整性不过绝不动系统 / 还原后回读比哈希 / 验证不过保留回滚点；
 *   - prune 纪律：先删最旧且已验证；【未验证永不自动删】；
 *   - 索引损坏宁可炸出来也不静默当成「什么都没有」。
 *
 * 全部用 BUTLER_ROLLBACK_DIR 指到临时目录，绝不碰真实 ~/.dsh-butler/rollback。
 */

import { p } from "../../util/paths.ts";
import { isFile } from "../../host/fs.ts";
import { run } from "../../host/shell.ts";
import {
  applyRollbackPoint,
  checkIntegrity,
  createRollbackPoint,
  deleteRollbackPoint,
  getRollbackPoint,
  listRollbackPoints,
  pruneRollbackPoints,
  rollbackRoot,
  storedArtifactPath,
} from "./rollback.ts";
import type { RollbackPoint } from "./rollback.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`断言失败：${msg}`);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${msg}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
  }
}

async function assertThrows(fn: () => Promise<unknown>, contains: string, msg: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const m = (e as Error).message;
    assert(m.includes(contains), `${msg} —— 报错应含「${contains}」，实际：${m}`);
    return;
  }
  throw new Error(`断言失败：${msg}（期望抛错但没有）`);
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 每个测试独立的存储根：装好 env、跑完连临时目录一起删。 */
async function withTempStore(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = Deno.makeTempDirSync();
  const prev = Deno.env.get("BUTLER_ROLLBACK_DIR");
  Deno.env.set("BUTLER_ROLLBACK_DIR", dir);
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) Deno.env.delete("BUTLER_ROLLBACK_DIR");
    else Deno.env.set("BUTLER_ROLLBACK_DIR", prev);
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch { /* ignore */ }
  }
}

/** 临时工作目录 + 一个源文件。 */
function makeWorkspace(name: string): { ws: string; file: string } {
  const ws = Deno.makeTempDirSync();
  const file = p(ws, name);
  Deno.writeTextFileSync(file, "原始内容 v1");
  return { ws, file };
}

// ── create ────────────────────────────────────────────────────────

Deno.test("create：write-ahead——内容与索引全部落盘，回读即见（verified=true）", async () => {
  await withTempStore(async () => {
    const { ws, file } = makeWorkspace("a.json");
    const bytes = await Deno.readFile(file);

    const pt = await createRollbackPoint({
      kind: "config",
      trigger: "测试",
      artifacts: [{ path: file, mode: "copy" }],
      reverse: { op: "restore-files" },
    });

    assertEq(pt.verified, true, "创建时回读校验通过应记 verified=true");
    assertEq(pt.sizeBytes, bytes.length, "sizeBytes 应等于源文件字节数");
    const art0 = pt.artifacts[0];
    assert(art0 !== undefined, "应至少有一个备份条目");
    assertEq(art0.sha256, await sha256Of(bytes), "记录的哈希应与源内容一致");

    // 副本真的在盘上，且不是空壳
    const stored = storedArtifactPath(pt.id, 0, file);
    assert(isFile(stored), `备份副本应落盘：${stored}`);
    assertEq(await sha256Of(await Deno.readFile(stored)), art0.sha256, "副本内容应与记录哈希一致");

    // 新鲜读取（不经内存）也能看到 —— write-ahead 的「见索引」
    const fresh = getRollbackPoint(pt.id);
    assert(fresh !== null, "重新读取索引应能拿到刚创建的回滚点");
    assertEq(fresh?.id, pt.id, "id 应一致");

    Deno.removeSync(ws, { recursive: true });
  });
});

Deno.test("create：源文件不存在必须抛错，且不留任何半成品（索引与目录都干净）", async () => {
  await withTempStore(async (store) => {
    await assertThrows(
      () =>
        createRollbackPoint({
          kind: "config",
          trigger: "测试",
          artifacts: [{ path: p(store, "不存在.json"), mode: "copy" }],
          reverse: { op: "restore-files" },
        }),
      "备份源不存在",
      "缺失源必须失败",
    );

    assertEq(listRollbackPoints().length, 0, "失败后索引里不该有条目");
    const leftovers = [...Deno.readDirSync(store)].filter((e) => e.isDirectory);
    assertEq(leftovers.length, 0, `失败后不该留下孤儿目录，实际：${leftovers.map((x) => x.name).join(", ")}`);
  });
});

Deno.test("create：manifest-only 只记哈希不复制；git-ref 钉住 commit", async () => {
  await withTempStore(async () => {
    const { ws, file } = makeWorkspace("m.json");

    const pt = await createRollbackPoint({
      kind: "snapshot",
      trigger: "测试",
      artifacts: [
        { path: file, mode: "manifest-only" },
        { path: ws, mode: "git-ref", ref: "HEAD" }, // 非 git 仓库 → 应抛错
      ],
      reverse: { op: "restore-files" },
    }).catch((e) => e as Error);

    // 上面这条因 git-ref 在非仓库上解析失败而整体抛错（原子性：要么全成要么全不成）
    assert(pt instanceof Error, "非 git 仓库上的 git-ref 必须让创建整体失败");
    assert((pt as Error).message.includes("git 引用无法解析"), `报错应说明 git 解析失败，实际：${(pt as Error).message}`);
    assertEq(listRollbackPoints().length, 0, "部分失败不应留下半条索引");

    // manifest-only 单独建：不复制内容
    const m = await createRollbackPoint({
      kind: "snapshot",
      trigger: "测试",
      artifacts: [{ path: file, mode: "manifest-only" }],
      reverse: { op: "restore-files" },
    });
    const stored = storedArtifactPath(m.id, 0, file);
    assert(!isFile(stored), "manifest-only 不应产生物理副本");
    const rep = await checkIntegrity(m);
    assert(rep.ok, `记录型条目无可校验实体，完整性应通过：${rep.problems.join("；")}`);

    Deno.removeSync(ws, { recursive: true });
  });
});

// ── apply ─────────────────────────────────────────────────────────

Deno.test("apply restore-files：还原被改坏的文件，应用后回读验证通过", async () => {
  await withTempStore(async () => {
    const { ws, file } = makeWorkspace("cfg.json");
    const pt = await createRollbackPoint({
      kind: "config",
      trigger: "测试",
      artifacts: [{ path: file, mode: "copy" }],
      reverse: { op: "restore-files" },
    });

    Deno.writeTextFileSync(file, "被改坏的内容！！");
    const res = await applyRollbackPoint(pt.id);

    assert(res.ok, `还原应成功，实际：${JSON.stringify(res)}`);
    assertEq(Deno.readTextFileSync(file), "原始内容 v1", "文件内容应被还原");
    assertEq(getRollbackPoint(pt.id)?.verified, true, "成功后 verified 应为 true");

    Deno.removeSync(ws, { recursive: true });
  });
});

Deno.test("apply 完整性闸：备份副本被改动 → 一个字节都不许碰系统，回滚点保留", async () => {
  await withTempStore(async () => {
    const { ws, file } = makeWorkspace("cfg.json");
    const pt = await createRollbackPoint({
      kind: "config",
      trigger: "测试",
      artifacts: [{ path: file, mode: "copy" }],
      reverse: { op: "restore-files" },
    });

    // 篡改备份副本 + 改坏源文件：完整性必须先拦，源文件保持「改坏」状态原样
    Deno.writeTextFileSync(storedArtifactPath(pt.id, 0, file), "恶意篡改的备份");
    Deno.writeTextFileSync(file, "源文件被改");

    const res = await applyRollbackPoint(pt.id);
    assert(!res.ok, "备份被篡改时必须拒绝还原");
    assertEq(res.stage, "integrity", "失败段应是完整性校验");
    assertEq(Deno.readTextFileSync(file), "源文件被改", "完整性不过时绝不能动源文件");
    assertEq(getRollbackPoint(pt.id)?.verified, false, "完整性失败应把 verified 置 false 并持久化");
    assert(getRollbackPoint(pt.id) !== null, "验证失败必须保留回滚点（不静默成功也不销毁证据）");

    Deno.removeSync(ws, { recursive: true });
  });
});

Deno.test("apply 领域验证不过：还原保留、回滚点保留、verified=false", async () => {
  await withTempStore(async () => {
    const { ws, file } = makeWorkspace("cfg.json");
    const pt = await createRollbackPoint({
      kind: "config",
      trigger: "测试",
      artifacts: [{ path: file, mode: "copy" }],
      reverse: { op: "restore-files" },
    });

    Deno.writeTextFileSync(file, "改坏");
    const res = await applyRollbackPoint(pt.id, { verify: () => false });

    assert(!res.ok, "领域验证不过必须判失败");
    assertEq(res.stage, "verify", "失败段应是应用后验证");
    assertEq(Deno.readTextFileSync(file), "原始内容 v1", "文件级还原本身已成功，不该回退");
    assertEq(getRollbackPoint(pt.id)?.verified, false, "验证不过 → verified=false 且点保留");
    assert(getRollbackPoint(pt.id) !== null, "回滚点必须保留");

    Deno.removeSync(ws, { recursive: true });
  });
});

Deno.test("apply npm-reinstall：清单两件套一并还原", async () => {
  await withTempStore(async () => {
    const ws = Deno.makeTempDirSync();
    const pkgJson = p(ws, "package.json");
    const lockfile = p(ws, "pnpm-lock.yaml");
    Deno.writeTextFileSync(pkgJson, `{"name":"demo","version":"1.0.0"}`);
    Deno.writeTextFileSync(lockfile, "lockfileVersion: '9.0'");

    const pt = await createRollbackPoint({
      kind: "plugin-set",
      trigger: "测试",
      artifacts: [
        { path: pkgJson, mode: "copy" },
        { path: lockfile, mode: "copy" },
      ],
      reverse: { op: "npm-reinstall", pkgJson, lockfile },
    });

    Deno.writeTextFileSync(pkgJson, `{"name":"hacked"}`);
    Deno.writeTextFileSync(lockfile, "broken");
    const res = await applyRollbackPoint(pt.id);

    assert(res.ok, `两件套还原应成功，实际：${JSON.stringify(res)}`);
    assert(Deno.readTextFileSync(pkgJson).includes("demo"), "package.json 应还原");
    assert(Deno.readTextFileSync(lockfile).includes("9.0"), "lockfile 应还原");

    Deno.removeSync(ws, { recursive: true });
  });
});

Deno.test("apply git-reset：HEAD 退回目标提交，隔离区内容移回（只移动不删除）", async () => {
  await withTempStore(async () => {
    const repo = Deno.makeTempDirSync();
    const sh = (args: string[]) => run("git", ["-C", repo, ...args], { timeoutMs: 20_000, allowNonZero: true });

    await run("git", ["init", repo], { timeoutMs: 20_000, allowNonZero: true });
    await sh(["config", "user.email", "t@test.local"]);
    await sh(["config", "user.name", "t"]);

    const file = p(repo, "app.txt");
    Deno.writeTextFileSync(file, "v1");
    await sh(["add", "-A"]);
    await sh(["commit", "-m", "c1"]);
    const c1 = (await sh(["rev-parse", "HEAD"])).stdout.trim();

    // 钉住 c1 的回滚点
    const quarantine = p(Deno.makeTempDirSync(), "q"); // 隔离区（模拟被移走的东西）
    Deno.mkdirSync(quarantine, { recursive: true });
    Deno.writeTextFileSync(p(quarantine, "stray.txt"), "被隔离的残留包");
    const pt = await createRollbackPoint({
      kind: "core-build",
      trigger: "测试",
      artifacts: [{ path: repo, mode: "git-ref", ref: "HEAD" }],
      reverse: { op: "git-reset", commit: c1, quarantine },
    });
    assertEq(pt.artifacts[0]?.sha256, c1, "git-ref 应钉住创建时的 commit");

    // 推进到 v2
    Deno.writeTextFileSync(file, "v2");
    await sh(["add", "-A"]);
    await sh(["commit", "-m", "c2"]);

    const res = await applyRollbackPoint(pt.id);
    assert(res.ok, `git-reset 回滚应成功，实际：${JSON.stringify(res)}`);
    assertEq(Deno.readTextFileSync(file), "v1", "工作树内容应退回 c1");
    assertEq((await sh(["rev-parse", "HEAD"])).stdout.trim(), c1, "HEAD 应落在 c1");
    assertEq(Deno.readTextFileSync(p(repo, "stray.txt")), "被隔离的残留包", "隔离区内容应移回仓库根");
    assert(!isFile(p(quarantine, "stray.txt")), "移回是移动不是复制，原位置不应还有");

    Deno.removeSync(repo, { recursive: true });
  });
});

// ── 索引纪律 ──────────────────────────────────────────────────────

Deno.test("索引损坏：list 必须炸出来，绝不静默当成「回滚点全没了」", async () => {
  await withTempStore(async (store) => {
    Deno.writeTextFileSync(p(store, "index.json"), "这不是JSON{{{");
    try {
      listRollbackPoints();
    } catch (e) {
      assert((e as Error).message.includes("损坏"), `报错应说明索引损坏，实际：${(e as Error).message}`);
      return;
    }
    throw new Error("断言失败：损坏索引必须抛错");
  });
});

Deno.test("delete：显式删除连根拔（索引 + 目录）；未知 id 返回 false", async () => {
  await withTempStore(async () => {
    const { ws, file } = makeWorkspace("d.json");
    const pt = await createRollbackPoint({
      kind: "config",
      trigger: "测试",
      artifacts: [{ path: file, mode: "copy" }],
      reverse: { op: "restore-files" },
    });

    assert(deleteRollbackPoint(pt.id), "删除已存在点应返回 true");
    assertEq(getRollbackPoint(pt.id), null, "索引里应已消失");
    assert(!pathExistsSafe(p(rollbackRoot(), pt.id)), "备份目录应一并删除");
    assert(!deleteRollbackPoint("rp-not-here"), "删除不存在的点应返回 false 而不是抛错");

    Deno.removeSync(ws, { recursive: true });
  });
});

function pathExistsSafe(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

// ── prune ─────────────────────────────────────────────────────────

/** 造一个可指定「是否已验证」的回滚点（直接改索引模拟未验证态）。 */
async function makePoint(tag: string, verified: boolean): Promise<RollbackPoint> {
  const { ws, file } = makeWorkspace(`${tag}.json`);
  const pt = await createRollbackPoint({
    kind: "config",
    trigger: "测试",
    artifacts: [{ path: file, mode: "copy" }],
    reverse: { op: "restore-files" },
  });
  Deno.removeSync(ws, { recursive: true }); // 源文件不再需要；回滚点只认自己的副本
  if (!verified) {
    // 白盒：直接翻索引里的 verified 标记（未验证态的最快构造方式）
    const idxPath = p(rollbackRoot(), "index.json");
    const idx = JSON.parse(Deno.readTextFileSync(idxPath)) as RollbackPoint[];
    const hit = idx.find((x) => x.id === pt.id);
    if (hit) hit.verified = false;
    Deno.writeTextFileSync(idxPath, JSON.stringify(idx, null, 2));
  }
  return getRollbackPoint(pt.id) ?? pt;
}

Deno.test("prune 数量上限：超过 keep 的最旧已验证点被删（索引 + 目录），孤儿目录一并清", async () => {
  await withTempStore(async (store) => {
    const points: RollbackPoint[] = [];
    for (let i = 0; i < 12; i++) points.push(await makePoint(`p${String(i).padStart(2, "0")}`, true));

    // 手工塞一个「复制了内容但没写进索引」的无主目录（create 中途崩溃的遗留形态）
    const orphan = p(store, "rp-orphan-xxxx");
    Deno.mkdirSync(orphan, { recursive: true });
    Deno.writeTextFileSync(p(orphan, "0-left.bin"), "半截内容");

    const r = pruneRollbackPoints({ keep: 10 });
    assertEq(r.removed.length, 2, "应删掉超出 keep 的 2 个");
    assertEq(r.kept, 10, "保留数应为 10");

    const keptIds = listRollbackPoints().map((x) => x.id);
    const oldestTwo = points.slice(0, 2).map((x) => x.id);
    for (const id of oldestTwo) {
      assert(!keptIds.includes(id), `最旧的点应被删：${id}`);
      assert(!pathExistsSafe(p(rollbackRoot(), id)), `目录应一并删除：${id}`);
    }
    assert(!pathExistsSafe(orphan), "无主目录应被顺手清掉");
    assertEq(listRollbackPoints().length, 10, "索引应只剩 10 条");
  });
});

Deno.test("prune 纪律：未验证的点就算超龄也永不自动删（安全 > 配额）", async () => {
  await withTempStore(async () => {
    const old1 = await makePoint("old-unverified", false); // 最旧 + 未验证
    const old2 = await makePoint("old-verified", true);
    await makePoint("new1", true);

    const r = pruneRollbackPoints({ keep: 1 });
    assert(r.removed.includes(old2.id), "超龄且已验证的应被删");
    assert(!r.removed.includes(old1.id), "未验证的绝不能进删除名单");
    assert(getRollbackPoint(old1.id) !== null, "未验证点必须还在索引里");
    assert(pathExistsSafe(p(rollbackRoot(), old1.id)), "未验证点的目录必须还在");
  });
});

Deno.test("prune 容量上限：超 maxBytes 时从最旧的已验证点开始腾位", async () => {
  await withTempStore(async () => {
    const a = await makePoint("big-a", true); // 每个约 10+ 字节
    const b = await makePoint("big-b", true);
    const c = await makePoint("big-c", true);
    const total = a.sizeBytes + b.sizeBytes + c.sizeBytes;

    // 上限卡在「只装得下两个」的水位
    const r = pruneRollbackPoints({ keep: 99, maxBytes: Math.floor(total * 0.66) });
    assert(r.removed.includes(a.id), "超容量时最旧的应先走");
    assert(!r.removed.includes(c.id), "最新的不该被误删");
    assert(getRollbackPoint(c.id) !== null, "最新点必须保留");
    assert(r.freedBytes > 0, "应报告释放的字节数");
  });
});
