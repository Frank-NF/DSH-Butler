/**
 * core.deep_clean 的判据回归测试（AC-C2）。
 *
 * 为什么这些逻辑必须有测试：
 *   深度清理是「完成更新」链路里唯一会动用户文件的步骤，判错的两个方向代价不对称：
 *     - 漏判：孤儿包 / 残留源文件留在线上 → 构建报 MISSING_EXPORT / TS6307（#47 事故根因）；
 *     - 误判：把用户正在写的东西、正经产物搬进隔离区 → 比不修更糟。
 *   所以阴阳样本同等重要；隔离区【同盘】路径规则也必须钉死——
 *   跨盘 rename 在 Windows 必失败（winerror=17），清理会静默失效、按钮白点。
 *
 * 测试铁律（沿用 verify_test.ts）：
 *   - 极简手写断言，不引外部依赖，任何网络环境下都能跑；
 *   - fixture 全部用临时目录 + 真 git 仓库，绝不碰真实 DSH 源码树；
 *   - 本机没有 git 时端到端用例跳过（不判失败），只读判据测试照常跑。
 */

import { pathExists } from "../../host/fs.ts";
import {
  basename,
  dirname,
  normalize,
  p,
  quarantineStampDir,
  sameVolume,
} from "../../util/paths.ts";
import {
  deepCleanInto,
  isInsideVersionedPackage,
  isOrphanPackage,
  isResidueName,
  isRiskyPath,
  packageRootOf,
  trackedChangeCount,
} from "./deep_clean.ts";

// ── 极简断言 ────────────────────────────────────────────────────────

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

// ── fixture 工具 ────────────────────────────────────────────────────

const HAS_GIT = (() => {
  try {
    return new Deno.Command("git", { args: ["--version"], stdout: "piped", stderr: "piped" })
      .outputSync().code === 0;
  } catch {
    return false;
  }
})();

/** 在指定仓库里跑 git（自带测试身份，关掉可能存在的全局 gpg 签名）。 */
function sh(root: string, ...args: string[]): void {
  const out = new Deno.Command("git", {
    args: [
      "-C",
      root,
      "-c",
      "user.email=butler@test.local",
      "-c",
      "user.name=butler",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (out.code !== 0) {
    throw new Error(`git ${args.join(" ")} 失败：${new TextDecoder().decode(out.stderr)}`);
  }
}

/** 按 POSIX 相对路径写文件（自动建父目录）。 */
function writeFile(root: string, rel: string, text: string): void {
  const full = p(root, ...rel.split("/"));
  Deno.mkdirSync(dirname(full), { recursive: true });
  Deno.writeTextFileSync(full, text);
}

function removeAll(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      Deno.removeSync(d, { recursive: true });
    } catch { /* 已删则忽略 */ }
  }
}

// ══ 只读判据：risky_path 阴阳样本（移植 Rust 7+7） ═════════════════

Deno.test("AC-C2 判据：risky_path 只命中会炸构建的文件（7 阳 7 阴）", () => {
  // 必须命中：不属于 HEAD 的残留测试/源码（真实的故障来源）
  assert(isRiskyPath("apps/web/tests/message-feedback-layout.e2e.ts"), "残留 e2e 测试应命中");
  assert(
    isRiskyPath("packages/client/ui-tool/tests/tool-details-render.client.tsx"),
    "残留组件测试应命中",
  );
  assert(isRiskyPath("packages/feedback/message-feedback/src/spec.ts"), "残留 spec 应命中");
  assert(isRiskyPath("packages/core/agent/src/inbox.ts"), "残留源文件应命中");
  // 编译产物倒灌进 src/ 的伴生文件
  assert(isRiskyPath("packages/test-support/llm-replay/src/index.js"), "src/ 下的 js 应命中");
  assert(
    isRiskyPath("packages/test-support/llm-replay/src/index.d.ts.map"),
    "src/ 下的 map 应命中",
  );
  // 外来的样式文件同样会被通配符收进工程
  assert(isRiskyPath("packages/client/ui-chat/src/Details.module.css"), "src/ 下的 css 应命中");

  // 不许命中：仓库根的零散文件、构建产物目录、用户数据（误伤比不修更糟）
  assert(!isRiskyPath(".dsh-web-server.pid"), "pid 文件不进编译工程，不许碰");
  assert(!isRiskyPath("probe-disable-new.yml"), "根目录 yml 不许碰");
  assert(!isRiskyPath("apps/cli/workflow.optimization.yml"), "业务配置 yml 不许碰");
  assert(!isRiskyPath("packages/llm/llm/lib/index.js"), "正经产物 lib/ 不许碰");
  assert(!isRiskyPath("apps/web/dist/assets/index-abc.js"), "dist 产物不许碰");
  assert(!isRiskyPath("README.md"), "文档不许碰");
  // 目录名里带 src 但不是独立目录段（防止 mysrc/ 被误判）
  assert(!isRiskyPath("tools/mysrc/notes.md"), "非独立目录段的 src 字样不许碰");
});

Deno.test("AC-C2 判据：.stale-* 是本工具自己的残留，无论在哪都要认领", () => {
  assert(
    isRiskyPath("packages/client/ui-chat/lib/types.stale-2026-09-18T14-30-26"),
    "lib 下的 stale 应命中",
  );
  assert(
    isRiskyPath("tsconfig.client.tsbuildinfo.stale-2026-09-18T15-08-00"),
    "根目录 stale 应命中",
  );
});

// ══ 只读判据：残渣名与孤儿包三条件 ════════════════════════════════

Deno.test("AC-C2 判据：残渣名白名单——构建产物命中，正经文件不碰", () => {
  for (const n of ["lib", "node_modules", ".typecheck", ".dsh-build", "dist", "tmp", "coverage"]) {
    assert(isResidueName(n), `构建残渣 ${n} 应命中`);
  }
  assert(isResidueName("tsconfig.client.tsbuildinfo"), "*.tsbuildinfo 应命中");
  assert(isResidueName("debug.log"), "*.log 应命中");

  assert(!isResidueName("package.json"), "包声明绝不能算残渣");
  assert(!isResidueName("src"), "源码目录绝不能算残渣");
  assert(!isResidueName("index.ts"), "源文件绝不能算残渣");
  assert(!isResidueName("README.md"), "文档绝不能算残渣");
});

Deno.test("AC-C2 判据：孤儿包三条件缺一不可", () => {
  const root = Deno.makeTempDirSync();
  try {
    // 三条件全中 → 孤儿
    writeFile(root, "full/lib/index.js", "module.exports = {};\n");
    // ① 目录里有 package.json → 真包，哪怕暂时没内容也不能碰
    writeFile(root, "haspkg/package.json", '{"name":"haspkg"}\n');
    writeFile(root, "haspkg/lib/index.js", "module.exports = {};\n");
    // ② 直接子项里有非残渣（源码目录）→ 不是「只剩残渣」
    writeFile(root, "mixed/src/index.ts", "export const a = 1;\n");
    // ② 目录是空的 → 没有可清的东西
    Deno.mkdirSync(p(root, "empty"));
    // ③ git 仍在跟踪 → 安全兜底，哪怕只剩 lib 也不能碰
    writeFile(root, "watched/lib/index.js", "module.exports = {};\n");
    const tracked = new Set(["watched/lib/index.js"]);

    const at = (rel: string) => p(root, ...rel.split("/"));
    assert(isOrphanPackage(at("full"), "full", new Set()), "三条件全中应判孤儿");
    assert(!isOrphanPackage(at("haspkg"), "haspkg", new Set()), "有 package.json 不是孤儿");
    assert(!isOrphanPackage(at("mixed"), "mixed", new Set()), "还有源码的目录不是孤儿");
    assert(
      !isOrphanPackage(at("empty"), "empty", new Set()),
      "空目录不是孤儿（缺「至少一个子项」）",
    );
    assert(!isOrphanPackage(at("watched"), "watched", tracked), "git 跟踪中的目录绝不能碰");
  } finally {
    removeAll(root);
  }
});

// ══ 同盘路径规则（单测钉死，不依赖真实文件系统） ═══════════════════

Deno.test("AC-C2 路径规则：隔离区落在源码树父目录下（=同盘）且每次带独立时间戳", () => {
  const root = "G:\\DeepSeek_Harness";
  const q = quarantineStampDir(root, "20260918-120000");
  const parent = dirname(root);

  assert(
    normalize(q).startsWith(normalize(parent)),
    `隔离区必须落在源码树父目录内（=同盘）：期望在 ${parent} 下，实际 ${q}`,
  );
  assert(q.includes("dsh-quarantine"), `名字要能一眼看出是隔离区：${q}`);
  assert(
    basename(q).includes("20260918-120000"),
    `每次执行要有独立的时间戳子目录，免得互相覆盖：${q}`,
  );
  assert(sameVolume(root, q), `卷标识必须一致（跨盘 rename 在 Windows 必失败）：${root} vs ${q}`);

  // 极端情况：本体直接装在盘符根，没有父目录——也必须给得出可用的绝对路径
  const q2 = quarantineStampDir("G:\\", "20260918-120000");
  assert(q2.length > 0, "盘符根也必须给出非空路径");
  assert(/^([A-Za-z]:[\\/]|\/)/.test(q2), `盘符根的情况也必须是绝对路径：${q2}`);
  assert(q2.includes("dsh-quarantine"), `盘符根的隔离区同样要带标识：${q2}`);
});

// ══ 只读判据：「HEAD 里的包」判定（2026-10-04 误隔离事故的根因） ═════

Deno.test("AC-C2 判据：packageRootOf 只认「包的祖先」，绝不把仓库根当包", () => {
  const base = Deno.makeTempDirSync();
  try {
    writeFile(base, "package.json", '{"name":"root"}\n');
    writeFile(base, "packages/app/package.json", '{"name":"app"}\n');
    writeFile(base, "packages/app/src/wip.ts", "export {};\n");
    writeFile(base, "packages/app/src/deep/nested.ts", "export {};\n");
    writeFile(base, "packages/demo/src/ghost.ts", "export {};\n");
    writeFile(base, "loose.ts", "export {};\n");

    assertEq(packageRootOf(base, "packages/app/src/wip.ts"), "packages/app", "取最近的包目录");
    assertEq(packageRootOf(base, "packages/app/src/deep/nested.ts"), "packages/app", "跨层也要找到");
    assertEq(
      packageRootOf(base, "packages/demo/src/ghost.ts"),
      null,
      "没有包声明的目录不算包——本地新写的包正是这种形状",
    );
    assertEq(
      packageRootOf(base, "loose.ts"),
      null,
      "仓库根的 package.json 属于整个仓库，不能把散文件认成包内文件",
    );
  } finally {
    removeAll(base);
  }
});

Deno.test("AC-C2 判据：isInsideVersionedPackage —— 包必须「进过 HEAD」才算老包", () => {
  const base = Deno.makeTempDirSync();
  try {
    writeFile(base, "packages/app/package.json", '{"name":"app"}\n');
    writeFile(base, "packages/app/src/wip.ts", "export {};\n");
    writeFile(base, "packages/wip/package.json", '{"name":"wip"}\n');
    writeFile(base, "packages/wip/src/new.ts", "export {};\n");

    const tracked = new Set(["packages/app/package.json"]);
    assert(
      isInsideVersionedPackage(base, "packages/app/src/wip.ts", tracked),
      "老包里的残留该被隔离",
    );
    assert(
      !isInsideVersionedPackage(base, "packages/wip/src/new.ts", tracked),
      "包声明不在 HEAD 里（本地新写的包）必须放过",
    );
    assert(
      !isInsideVersionedPackage(base, "packages/wip/src/new.ts", new Set(["package.json"])),
      "只有仓库根在 HEAD 里时，同样不算包内文件",
    );
  } finally {
    removeAll(base);
  }
});

Deno.test("AC-C2 判据：trackedChangeCount —— 脏工作区必须认得出（读不到给 null 不给 0）", async () => {
  if (!HAS_GIT) return;
  const base = Deno.makeTempDirSync();
  const repo = p(base, "repo");
  try {
    writeFile(repo, "src/index.ts", "export const a = 1;\n");
    assertEq(await trackedChangeCount(repo), null, "还不是 git 仓库 → null（不能当成干净的 0）");
    sh(repo, "init", "-b", "main");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-m", "init");
    assertEq(await trackedChangeCount(repo), 0, "干净检出 → 0");
    writeFile(repo, "src/index.ts", "export const a = 2;\n");
    assertEq(await trackedChangeCount(repo), 1, "改了 1 个已跟踪文件 → 1");
    writeFile(repo, "src/brand-new.ts", "export {};\n");
    assertEq(await trackedChangeCount(repo), 1, "未跟踪文件不计入「改动」（它另有判据）");
  } finally {
    removeAll(base);
  }
});

// ══ 端到端：孤儿包 + 陈旧缓存照清，未跟踪源文件按包归属分流 ════════

Deno.test("AC-C2 端到端：孤儿包与陈旧缓存照清，未跟踪源文件只动「HEAD 里的包」内的，二跑全 0", async () => {
  if (!HAS_GIT) return;
  const base = Deno.makeTempDirSync();
  const repo = p(base, "repo");
  // 隔离区走真实路径规则（源码树父目录下的 dsh-quarantine/<时间戳>），顺带验证同盘
  const destRoot = quarantineStampDir(repo, "20260924-120000");
  try {
    // ── 第一阶段：会被 git 跟踪的「真」内容 ──────────────────────────
    writeFile(repo, "package.json", '{"name":"fixture-deep-clean","version":"0.0.0"}\n');
    writeFile(repo, "packages/real/package.json", '{"name":"real"}\n');
    writeFile(repo, "packages/real/src/index.ts", "export const a = 1;\n");
    writeFile(repo, "packages/real/lib/index.js", "// 正经产物：有包声明，绝不能动\n");
    writeFile(repo, "packages/onlysrc/src/index.ts", "export const b = 2;\n");
    writeFile(repo, "packages/tracked-lib/lib/index.js", "// git 跟踪中的产物：安全兜底不许动\n");
    writeFile(repo, "apps/web/src/main.ts", "export {};\n");

    sh(repo, "init", "-b", "main");
    // -f：lib/ 常被（全局）gitignore 忽略，强行入账正是为了造出「git 认识它」的情形
    sh(
      repo,
      "add",
      "-f",
      "-A",
      "package.json",
      "packages/real",
      "packages/onlysrc",
      "packages/tracked-lib",
      "apps/web/src",
    );
    sh(repo, "commit", "-m", "init");

    // ── 第二阶段：提交之后积累的现场（残留 = 未跟踪、不属于 HEAD） ─────
    // 编译缓存与历史残留（第①步清，不依赖 git）
    writeFile(repo, "tsconfig.client.tsbuildinfo", "{}");
    writeFile(repo, "packages/real/lib/types.stale-2026-09-18", "old\n");
    // 4 个孤儿包：无 package.json + 子项全残渣 + git 不跟踪
    writeFile(repo, "packages/gone1/lib/index.js", "module.exports = {};\n");
    writeFile(repo, "packages/gone1/node_modules/dep/package.json", "{}\n");
    writeFile(repo, "packages/gone2/lib/index.js", "module.exports = {};\n");
    writeFile(repo, "packages/gone3/dist/bundle.js", "var x = 1;\n");
    writeFile(repo, "packages/gone3/tmp/scratch.log", "noise\n");
    writeFile(repo, "packages/gone4/.typecheck/marker", "x\n");
    writeFile(repo, "packages/gone4/coverage/lcov.info", "TN:\n");
    // ① 真残留：未跟踪 + 危险目录 + 源码扩展名，且所在包在 HEAD 里有 package.json
    writeFile(repo, "packages/real/src/residue-helper.ts", "export {};\n");
    // ② 阴性样本：未跟踪源文件，但所在包没进 HEAD（2026-10-04 事故的形状）
    writeFile(repo, "apps/web/tests/leftover.e2e.ts", "export {};\n");
    writeFile(repo, "packages/demo/src/ghost.ts", "export {};\n");
    writeFile(repo, "packages/demo/src/extra.module.css", ".x {}\n");
    // 仓库根的零散文件：与编译无关，一个都不能碰
    writeFile(repo, "probe.yml", "a: 1\n");

    // ── 第一遍：全部该走的都走，该留的都留 ────────────────────────────
    const { report, lines } = await deepCleanInto(repo, destRoot);

    assertEq(report.orphanPackages, 4, "4 个孤儿包应全部清掉");
    assertEq(report.quarantined, 1, "只有「HEAD 里的包」内那个残留源文件该被隔离");
    assertEq(report.protectedAsUserWork, 3, "3 个看着像新写的东西必须被保护下来");
    assertEq(report.skippedSourceIsolation, false, "干净的检出不该跳过源文件隔离");
    assertEq(report.staleRemoved, 1, "1 个 .stale-* 应被清掉");
    assertEq(report.tsbuildinfoReset, 1, "1 个编译缓存应被作废");
    assertEq(report.failed.length, 0, `不该有移动失败：${JSON.stringify(report.failed)}`);
    assertEq(report.quarantineDir, destRoot, "有内容时 quarantineDir 必须指向隔离区");
    assert(sameVolume(repo, destRoot), "隔离区必须与源码树同盘");

    // 该留的（误伤用户文件比不修更糟）
    const keeps = [
      "package.json",
      "probe.yml",
      "packages/real/package.json",
      "packages/real/src/index.ts",
      "packages/real/lib/index.js",
      "packages/onlysrc/src/index.ts",
      "packages/tracked-lib/lib/index.js",
      "apps/web/src/main.ts",
      // 2026-10-04 事故的形状：用户本地写、还没进 HEAD 的源文件一个都不能动
      "apps/web/tests/leftover.e2e.ts",
      "packages/demo/src/ghost.ts",
      "packages/demo/src/extra.module.css",
    ];
    for (const rel of keeps) {
      assert(pathExists(p(repo, ...rel.split("/"))), `必须保留：${rel}`);
    }
    // 该走的：整目录搬走
    for (const gone of ["packages/gone1", "packages/gone2", "packages/gone3", "packages/gone4"]) {
      assert(!pathExists(p(repo, ...gone.split("/"))), `孤儿包应整目录搬走：${gone}`);
    }
    // 是「搬进隔离区」而不是删掉——用户必须能还原
    const movedSamples = [
      "packages/gone1/lib/index.js",
      "packages/real/src/residue-helper.ts",
      "tsconfig.client.tsbuildinfo",
      "packages/real/lib/types.stale-2026-09-18",
    ];
    for (const rel of movedSamples) {
      assert(pathExists(p(destRoot, ...rel.split("/"))), `隔离区应能找到：${rel}`);
    }
    assert(pathExists(p(destRoot, "MANIFEST.json")), "必须留下可还原的清单");
    const manifest = JSON.parse(Deno.readTextFileSync(p(destRoot, "MANIFEST.json"))) as {
      movedCount: number;
      moved: string[];
    };
    assertEq(manifest.movedCount, 7, "清单计数应为 1 缓存 + 1 stale + 4 孤儿 + 1 残留源文件");
    assertEq(manifest.moved.length, 7, "清单明细条数与计数一致");
    assert(lines.some((l) => l.includes("孤儿包")), "汇报里要说清清了几个孤儿包");
    assert(
      lines.some((l) => l.includes("隔离「不属于当前版本」")),
      "汇报里要说清隔离了几个残留文件",
    );
    assert(
      lines.some((l) => l.includes("不在任何已知的包里")),
      "被保护的源文件必须在汇报里说清楚，否则用户不知道自己的东西被保住了",
    );
    assert(
      lines.some((l) => l.includes("· 保留 packages/demo/src/ghost.ts")),
      "汇报里要逐条列出保住了哪些文件",
    );

    // ── 第二遍：幂等——现场已干净，什么都别再动 ────────────────────────
    const again = await deepCleanInto(repo, destRoot);
    assertEq(again.report.quarantined, 0, "二跑不得再隔离任何文件");
    assertEq(again.report.staleRemoved, 0, "二跑不得再清残留");
    assertEq(again.report.tsbuildinfoReset, 0, "二跑不得再动作编译缓存");
    assertEq(again.report.orphanPackages, 0, "二跑不得再清孤儿包");
    assertEq(again.report.protectedAsUserWork, 3, "二跑仍要认出那 3 个是你写的东西");
    assertEq(again.report.failed.length, 0, "二跑不该有失败");
    assertEq(again.report.quarantineDir, null, "无内容时不该报隔离区");
  } finally {
    removeAll(base);
  }
});

// ══ 保护：开发检出（有未提交改动）时整步跳过源文件隔离 ═══════════════

Deno.test("AC-C2 保护：工作区有未提交改动时，「隔离源文件」整步跳过，一个都不动", async () => {
  if (!HAS_GIT) return;
  const base = Deno.makeTempDirSync();
  const repo = p(base, "repo");
  const dest = p(base, "q");
  try {
    writeFile(repo, "package.json", '{"name":"fixture-dev","version":"0.0.0"}\n');
    writeFile(repo, "packages/app/package.json", '{"name":"app"}\n');
    writeFile(repo, "packages/app/src/index.ts", "export const a = 1;\n");
    sh(repo, "init", "-b", "main");
    sh(repo, "add", "-f", "-A");
    sh(repo, "commit", "-m", "init");

    // 开发现场：有人正在改代码（已跟踪文件有未提交改动）
    writeFile(repo, "packages/app/src/index.ts", "export const a = 2; // 改到一半\n");
    // 未跟踪的新文件：旧逻辑会把它们当成残留搬进隔离区
    writeFile(repo, "packages/app/src/wip.ts", "export {};\n");
    // 与「谁在写代码」无关的两步照旧：编译缓存 + 孤儿包
    writeFile(repo, "tsconfig.tsbuildinfo", "{}");
    writeFile(repo, "packages/gone/lib/index.js", "module.exports = {};\n");

    const { report, lines } = await deepCleanInto(repo, dest);

    assertEq(report.skippedSourceIsolation, true, "开发检出必须跳过源文件隔离");
    assertEq(report.protectedAsUserWork, 1, "1 个未跟踪源文件被保护");
    assertEq(report.quarantined, 0, "一个源文件都不许搬");
    assertEq(report.tsbuildinfoReset, 1, "编译缓存照旧作废（与 git 无关）");
    assertEq(report.orphanPackages, 1, "孤儿包照旧清理");
    assertEq(report.failed.length, 0, `不该有失败：${JSON.stringify(report.failed)}`);
    assert(
      pathExists(p(repo, "packages", "app", "src", "wip.ts")),
      "正在写的东西必须原样留在原地",
    );
    assert(pathExists(p(repo, "packages", "app", "src", "index.ts")), "已跟踪文件当然也不许动");
    assert(pathExists(p(dest, "tsconfig.tsbuildinfo")), "编译缓存要进隔离区");
    assert(pathExists(p(dest, "packages", "gone", "lib", "index.js")), "孤儿包要进隔离区");
    assert(lines.some((l) => l.includes("工作区有 1 个已跟踪文件未提交")), "必须说清为什么跳过");
    assert(lines.some((l) => l.includes("已跳过「隔离残留源文件」")), "必须直说这一步跳过了");
    assert(
      lines.some((l) => l.includes("· 保留 packages/app/src/wip.ts")),
      "被保护的文件要逐条列出来",
    );
  } finally {
    removeAll(base);
  }
});

// ══ 降级：读不到 git 清单时的整体保守跳过 ═════════════════════════

Deno.test("AC-C2 降级：读不到 git 清单时只清编译缓存，绝不动孤儿与残留", async () => {
  const base = Deno.makeTempDirSync();
  const repo = p(base, "tree");
  const dest = p(base, "q");
  try {
    writeFile(repo, "tsconfig.tsbuildinfo", "{}");
    writeFile(repo, "packages/ghost/lib/index.js", "module.exports = {};\n");
    writeFile(repo, "src/leftover.ts", "export {};\n");

    const { report, lines } = await deepCleanInto(repo, dest);

    assertEq(report.tsbuildinfoReset, 1, "编译缓存不依赖 git，照常作废");
    assertEq(report.orphanPackages, 0, "读不到清单时不许清孤儿包（不能把读不到当成全部未跟踪）");
    assertEq(report.quarantined, 0, "读不到清单时不许隔离任何文件");
    assert(
      pathExists(p(repo, "packages", "ghost", "lib", "index.js")),
      "孤儿形状的目录必须原样保留",
    );
    assert(pathExists(p(repo, "src", "leftover.ts")), "残留源文件必须原样保留");
    assert(
      lines.some((l) => l.includes("读不到 git")),
      "必须明说跳过了哪两步，否则用户不知道构建为什么还会挂",
    );
  } finally {
    removeAll(base);
  }
});
