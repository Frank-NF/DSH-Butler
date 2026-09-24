/**
 * core.status —— DSH 本体状态（只读）。
 *
 * 关键判定：「是否需要完成更新」不靠时间戳猜，而是比对
 *   .dsh-build/client-build-environment.json 里记录的源码提交 vs 当前 HEAD。
 * 这是旧版 1.18.12 用血换来的结论，必须继承。
 */

import type { ActionDef } from "../../jobs/types.ts";
import { type Finding, finding } from "../../util/result.ts";
import { run } from "../../host/shell.ts";
import { isDir, isFile, readJson } from "../../host/fs.ts";
import { dshProfileDir, p, resolveDshSourceRoot } from "../../util/paths.ts";
import { type BuildIntegrity, verifyBuildIntegrity } from "./official.ts";

export interface GitInfo {
  head: string | null;
  headShort: string | null;
  branch: string | null;
  /** 已跟踪文件的改动条数（不含未跟踪文件，避免被海量产物干扰）。 */
  dirtyTracked: number;
}

export interface BuildRecord {
  path: string;
  formatVersion: number | null;
  commit: string | null;
  version: string | null;
  dirty: boolean;
  fileCount: number | null;
  artifactsSha256: string | null;
  recordedAt: string | null;
  /** 实测产物文件数（官方算法口径，仅在完整性校验成功时可用）。 */
  artifactsFileCount?: number | null;
  /** 实测产物摘要（官方算法口径）。 */
  artifactsSha256Actual?: string | null;
}

/**
 * 插件双名单检查。
 * activePlugins = dependencies ∩ dsh.profile.bundles —— 这两个名单必须同时维护，
 * 否则会出现「装了不生效」或「卸载后启动即崩」。
 *
 * 注意 bundles 侧的判据【不是】"不在 dependencies 里就算缺失"：
 * DSH 的 resolveBundleDir 解析顺序是「安装锚点优先，profile 次之」，
 * 因此 @deepseek-ai/dsh-base / dsh-web-app 这类基座包本来就该从本体解析，
 * 不会（也不该）出现在 profile 的 dependencies 里。见 inBox。
 */
export interface PluginListCheck {
  dependencies: string[];
  bundles: string[];
  active: string[];
  /** 在 dependencies 里但不在 bundles 里 → 装了不生效。 */
  declaredButInactive: string[];
  /** bundles 里的基座/内置包：从 DSH 安装目录解析到，不要求写在 dependencies 里。 */
  inBox: string[];
  /** bundles 里但装位置、profile 位置都解析不到 → 真缺失，会让 DSH 启动直接终止。 */
  bundledButUndeclared: string[];
}

/** 一处残留物。 */
export interface ResidueEntry {
  /** 相对 <profile>/node_modules 的路径，如 "@codemirror/.autocomplete_tmp_15580_31"。 */
  name: string;
  /** 命中的形态说明，用于向用户解释"凭什么说它是残留"。 */
  kind: string;
}

export interface CoreStatus {
  sourceRoot: string | null;
  discoveredBy: string | null;
  version: string | null;
  git: GitInfo | null;
  build: BuildRecord | null;
  /** 产物完整性（走 DSH 官方算法判定）。 */
  integrity: BuildIntegrity | null;
  /** 源码已更新但界面产物没重建 → 需要「完成更新」。 */
  needsFinishUpdate: boolean;
  finishReason: string | null;
  plugins: PluginListCheck | null;
  /** profile/node_modules 下的残留物（只认 pnpm 临时目录特征，不做"不在清单即残留"的推断）。 */
  suspectedOrphans: ResidueEntry[];
  findings: Finding[];
  checkedAt: string;
}

const BUILD_RECORD_REL = ".dsh-build/client-build-environment.json";

export async function collectCoreStatus(): Promise<CoreStatus> {
  const findings: Finding[] = [];
  const probe = resolveDshSourceRoot();

  if (!probe) {
    return {
      sourceRoot: null,
      discoveredBy: null,
      version: null,
      git: null,
      build: null,
      integrity: null,
      needsFinishUpdate: false,
      finishReason: null,
      plugins: null,
      suspectedOrphans: [],
      findings: [
        finding("core.not-installed", "error", "未安装 DSH 本体", {
          cause: "没有找到 DSH 源码目录",
          impact: "本体与插件相关功能全部不可用",
          action: "使用「一键部署」从零安装 DSH",
          fixAction: "bootstrap.plan",
        }),
      ],
      checkedAt: new Date().toISOString(),
    };
  }

  const root = probe.path;

  // ── git 信息 ─────────────────────────────────────────────────
  const git: GitInfo = {
    head: (await gitOut(root, ["rev-parse", "HEAD"])) ?? null,
    headShort: (await gitOut(root, ["rev-parse", "--short", "HEAD"])) ?? null,
    branch: (await gitOut(root, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? null,
    dirtyTracked: 0,
  };
  const porcelain = await gitOut(root, ["status", "--porcelain", "-uno"]);
  if (porcelain) {
    git.dirtyTracked = porcelain.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  }

  if (git.dirtyTracked > 0) {
    findings.push(
      finding("core.working-tree-dirty", "warn", `本体有 ${git.dirtyTracked} 个已跟踪文件被修改`, {
        cause: "源码目录里存在未提交的改动（可能是手动改过，或上次更新中途被打断）",
        impact: "更新时的 git pull 可能因为冲突而失败",
        action: "确认这些改动是否需要保留；不需要的话在更新前先还原",
        evidence: [root],
      }),
    );
  }

  // ── 构建记录 ─────────────────────────────────────────────────
  const recordPath = p(root, BUILD_RECORD_REL);
  let build: BuildRecord | null = null;
  if (isFile(recordPath)) {
    const raw = readJson<{
      formatVersion?: number;
      environment?: Record<string, string>;
      artifacts?: { fileCount?: number; sha256?: string };
    }>(recordPath);
    let mtime: string | null = null;
    try {
      mtime = Deno.statSync(recordPath).mtime?.toISOString() ?? null;
    } catch { /* ignore */ }
    build = {
      path: recordPath,
      formatVersion: raw?.formatVersion ?? null,
      commit: raw?.environment?.DSH_CLIENT_COMMIT_HASH ?? null,
      version: raw?.environment?.DSH_CLIENT_VERSION ?? null,
      dirty: raw?.environment?.DSH_CLIENT_GIT_DIRTY === "true",
      fileCount: raw?.artifacts?.fileCount ?? null,
      artifactsSha256: raw?.artifacts?.sha256 ?? null,
      recordedAt: mtime,
    };
  } else {
    findings.push(
      finding("core.no-build-record", "error", "缺少构建记录文件", {
        cause: `未找到 ${BUILD_RECORD_REL}`,
        impact: "无法判断界面产物是否与源码一致，DSH 可能根本起不来",
        action: "执行一次「完成更新」（含全量重建）以生成构建记录",
        fixAction: "core.finishUpdate",
        evidence: [recordPath],
      }),
    );
  }

  // 一致性判定的两个结果变量（完整性校验与提交号比对都会写它们）
  let needsFinishUpdate = false;
  let finishReason: string | null = null;

  // ── 产物完整性：交给官方算法判，不自己复刻（见 core/official.ts 的说明） ──
  const integrity = await verifyBuildIntegrity(root);
  if (integrity.official && integrity.verified) {
    // 官方判据通过：产物与构建记录完全一致，这是最强的一条结论
    if (build) {
      build.artifactsFileCount = integrity.fileCount;
      build.artifactsSha256Actual = integrity.sha256;
    }
  } else if (integrity.official && !integrity.verified) {
    // 官方脚本加载成功但判定不一致 → 真问题：产物被改过、删过，或不完整
    needsFinishUpdate = true;
    finishReason = "产物的实际内容与构建记录不一致。";
    findings.push(
      finding("core.artifacts-mismatch", "error", "界面产物与构建记录不一致", {
        cause: integrity.error ?? "官方校验判定不一致",
        impact:
          "DSH 启动时会加载到不完整或过期的产物，典型症状是界面能开但某些面板永久卡住、或报某个文件不存在",
        action: "点「完成更新」重建一次（必须走官方 pnpm run build）",
        fixAction: "core.finishUpdate",
        evidence: [`官方脚本：${integrity.modulePath ?? "?"}`, integrity.error ?? ""],
      }),
    );
  } else {
    // 拿不到官方判据（脚本缺失 / 加载失败）—— 只当"无法校验"，绝不报成错误
    findings.push(
      finding("core.integrity-unverifiable", "info", "无法校验产物完整性", {
        cause: integrity.error ?? "未能调用官方校验脚本",
        impact: "只能退化为比对提交号，无法证明产物内容与源码一致",
        action: "若本体源码完整，可忽略；否则请确认本体安装是否完整",
        evidence: integrity.modulePath ? [integrity.modulePath] : [],
      }),
    );
  }

  // ── 一致性判定（提交号层面，作为上面完整性校验的粗粒度补充） ──────
  if (build?.commit && git.head) {
    // 构建记录里存的是短 sha，用前缀匹配
    if (!git.head.startsWith(build.commit)) {
      needsFinishUpdate = true;
      finishReason =
        `源码已更新到 ${
          git.headShort ?? git.head.slice(0, 7)
        }，但界面产物仍是 ${build.commit} 构建的（` +
        `版本 ${build.version ?? "未知"}）。`;
      findings.push(
        finding("core.needs-finish-update", "error", "需要「完成更新」", {
          cause: finishReason,
          impact:
            "只执行了拉取源码却没重建，会留下新旧产物混跑的烂摊子（典型症状：界面报某函数不存在、插件面板永久卡住）",
          action: "点「完成更新」：清理残留 → 装依赖 → 全量重建 → 重启（共 6 步）",
          fixAction: "core.finishUpdate",
          evidence: [
            `HEAD=${git.head}`,
            `构建记录=${build.commit}`,
            `记录版本=${build.version ?? "?"}`,
          ],
        }),
      );
    }
  } else if (build === null && git.head) {
    needsFinishUpdate = true;
    finishReason = "找不到构建记录，无法确认产物是否为当前源码所构建。";
  }

  // ── 脏树构建提醒 ─────────────────────────────────────────────
  // DSH 记录 DSH_CLIENT_GIT_DIRTY 用的是 `git status --porcelain --untracked-files=normal`，
  // 也就是【包含未跟踪文件】。仓库里未跟踪文件本来就多（产物、临时目录），
  // 所以这个标记为 true 通常只说明"当时工作区不干净"，不等于源码被改过。
  // 因此这里只作提示，且把两种可能都写清楚，不制造恐慌。
  if (build?.dirty && !needsFinishUpdate) {
    findings.push(
      finding("core.built-from-dirty-tree", "info", "本次产物是在工作区不干净时构建的", {
        cause: "构建记录里带 DSH_CLIENT_GIT_DIRTY=true（该标记把未跟踪文件也算在内）",
        impact:
          "提交号虽然一致，但无法从提交号反推产物内容；若当时确有改过源码又没提交，产物就与源码不符",
        action: "在意的话重建一次即可消除疑虑；日常使用可忽略",
        evidence: [`HEAD=${git.headShort ?? "?"}`, `构建记录提交=${build.commit}`],
      }),
    );
  }

  // ── 插件双名单 ───────────────────────────────────────────────
  const profileDir = dshProfileDir();
  const plugins = readPluginLists(p(profileDir, "package.json"), { installRoot: root, profileDir });

  if (plugins) {
    if (plugins.declaredButInactive.length > 0) {
      findings.push(
        finding(
          "core.plugin-declared-but-inactive",
          "warn",
          `${plugins.declaredButInactive.length} 个插件装了但没生效`,
          {
            cause:
              "这些包写在 dependencies 里，但没出现在 profile 的 bundles 名单中，DSH 不会加载它们",
            impact: "插件看起来装了，实际完全不起作用",
            action: "把它们补进 profile 的 bundles 名单（用「修复」动作）",
            fixAction: "plugin.repair",
            evidence: plugins.declaredButInactive,
          },
        ),
      );
    }
    if (plugins.bundledButUndeclared.length > 0) {
      findings.push(
        finding(
          "core.plugin-bundled-but-undeclared",
          "error",
          `${plugins.bundledButUndeclared.length} 个插件在名单里但装不上`,
          {
            cause: "这些包写在 bundles 名单里，但本体安装目录与 profile 目录都解析不到它们",
            impact: "DSH 启动时会去加载不存在的包，直接终止启动",
            action: "把它们从 bundles 名单里移除，或重新安装这些包",
            fixAction: "plugin.repair",
            evidence: plugins.bundledButUndeclared,
          },
        ),
      );
    }
  }

  // ── 残留物 ───────────────────────────────────────────────────
  // 只认 pnpm 临时目录特征。绝不使用「不在清单里就算残留」的推断 ——
  // profile/node_modules 里绝大多数非直接依赖是第三方插件的传递依赖
  // （rolldown / typescript / dsh-mnemon-provider-* …），清掉插件立刻全崩。
  const suspectedOrphans = scanResidue(p(profileDir, "node_modules"));
  if (suspectedOrphans.length > 0) {
    findings.push(
      finding("core.pnpm-residue", "warn", `发现 ${suspectedOrphans.length} 处安装中断残留`, {
        cause:
          "这些目录带 pnpm 临时暂存特征（隐藏前缀 / _tmp_<pid> / 日期戳），是上次装插件或换版本被中断时留下的整包副本，正式的那份已经在原位",
        impact: "多数无害，但会被当成模块参与打包，导致构建失败或插件加载到旧版本",
        action: "一键清理（只移动到隔离区，不删除，可整体还原）",
        fixAction: "plugin.cleanResidue",
        evidence: suspectedOrphans.slice(0, 20).map((r) => `${r.name}（${r.kind}）`),
      }),
    );
  }

  if (git.branch && git.branch !== "main" && git.branch !== "HEAD") {
    findings.push(
      finding("core.not-on-main", "info", `当前位于分支 ${git.branch}`, {
        cause: "本体源码不在 main 分支上",
        impact: "更新时拉取的提交可能不是最新正式版本",
        action: "确认是否有意为之；需要回到正式版本时切回 main",
        evidence: [root],
      }),
    );
  }

  return {
    sourceRoot: root,
    discoveredBy: probe.source,
    version: build?.version ?? (await readPkgVersion(root)),
    git,
    build,
    integrity,
    needsFinishUpdate,
    finishReason,
    plugins,
    suspectedOrphans,
    findings,
    checkedAt: new Date().toISOString(),
  };
}

async function gitOut(root: string, args: string[]): Promise<string | null> {
  const r = await run("git", ["-C", root, ...args], {
    timeoutMs: 30_000,
    allowNonZero: true,
    scope: "git",
  });
  const out = r.stdout.trim();
  return r.code === 0 && out.length > 0 ? out : null;
}

async function readPkgVersion(root: string): Promise<string | null> {
  const pkg = readJson<{ version?: string }>(p(root, "package.json"));
  return pkg?.version ?? null;
}

/**
 * 读取 profile 的双名单并算出差集。
 *
 * bundles 里"不在 dependencies"的名字要再分两类：能从 DSH 安装目录解析到的
 * 算 inBox（合法，本就不该写进 profile 的 dependencies），解析不到的才算真缺失。
 * 传了 installRoot 才做这项区分；不传时退化为"全部算 inBox"，
 * 即【绝不】在信息不足时把名字报成缺失。
 */
export function readPluginLists(
  pkgPath: string,
  locate?: { installRoot: string; profileDir: string },
): PluginListCheck | null {
  const pkg = readJson<{
    dependencies?: Record<string, string>;
    dsh?: { profile?: { bundles?: string[] } };
  }>(pkgPath);
  if (!pkg) return null;

  const dependencies = Object.keys(pkg.dependencies ?? {});
  const bundles = pkg.dsh?.profile?.bundles ?? [];
  const depSet = new Set(dependencies);
  const bundleSet = new Set(bundles);

  const outsideDeps = bundles.filter((b) => !depSet.has(b));
  const inBox: string[] = [];
  const bundledButUndeclared: string[] = [];
  for (const name of outsideDeps) {
    if (!locate || resolvesBundle(name, locate)) inBox.push(name);
    else bundledButUndeclared.push(name);
  }

  return {
    dependencies,
    bundles,
    active: dependencies.filter((d) => bundleSet.has(d)),
    declaredButInactive: dependencies.filter((d) => !bundleSet.has(d)),
    inBox,
    bundledButUndeclared,
  };
}

/**
 * 包名能否从安装目录或 profile 目录解析到。
 *
 * 这里复刻的是 DSH 自己的 resolveBundleDir（packages/boot/app-boot/src/profile.ts）：
 * 解析锚点顺序是【安装锚点优先，profile 次之】，这是"in-box bundle 永远来自
 * 运行中的这份 dsh 安装，而不是 profile 本地副本"的契约。
 * 所以安装侧要同时看仓库根与 apps/cli 两处 node_modules（pnpm workspace 会把
 * 工作区包链接到根，而 apps/cli 下也有一份）。
 */
function resolvesBundle(
  name: string,
  locate: { installRoot: string; profileDir: string },
): boolean {
  const roots = [
    p(locate.installRoot, "node_modules"),
    p(locate.installRoot, "apps", "cli", "node_modules"),
    p(locate.profileDir, "node_modules"),
  ];
  return roots.some((r) => isFile(p(r, ...name.split("/"), "package.json")));
}

/**
 * pnpm 中断残留。
 *
 * 【判据只认临时目录特征】，不做「不在清单里就算残留」的推断 ——
 * profile/node_modules 里绝大多数非直接依赖是第三方插件的传递依赖
 * （rolldown / typescript / ssh2 / dsh-mnemon-provider-* 全是正常的），
 * 按"不在清单即垃圾"去清，插件会立刻全部崩。
 * 宁可漏报，不可误报：漏报只是没帮忙，误报会把用户的东西弄坏。
 *
 * 2026-09-24 本机实测到的三种真实形态（共 12 处，均为完整包副本）：
 *   @codemirror/.autocomplete_tmp_15580_31-2kN2ZzMh   ← scope 下的隐藏目录
 *   nan_tmp_1248_8 / dsh-ego-browser_tmp_1248_2       ← _tmp_<pid>_<n>
 *   dshmarket_20260924_110135                         ← 日期戳后缀（换版本时暂存的旧版）
 */
const RESIDUE_FORMS: Array<{ kind: string; hit: (n: string) => boolean }> = [
  { kind: "上次清理留下的暂存备份", hit: (n) => /^\.residue_backup_/.test(n) },
  { kind: "pnpm 暂存目录（隐藏前缀）", hit: (n) => n.startsWith(".") && n.length > 1 },
  { kind: "pnpm 暂存目录（_tmp_ 后缀）", hit: (n) => /_tmp_\d+(_\d+)?(-[A-Za-z0-9]{8})?$/.test(n) },
  { kind: "pnpm 暂存目录（随机后缀）", hit: isPnpmRandomSuffix },
  { kind: "换版本时残留的旧副本（日期戳）", hit: (n) => /_\d{8}_\d{6}$/.test(n) },
];

/**
 * pnpm 的随机暂存后缀：形如 `chalk-rGZ71ppw` / `ansi-regex-AFJM5CM4`。
 * 签名 = 末段恰好 8 位，且【至少含一个大写字母与一个数字】。
 *
 * 为什么这两条约束就够了：npm 自 2017 年起强制包名全小写，
 * 因此"末段 8 位里出现大写"对正常包名几乎不可能成立；
 * 再叠加"必须含数字"，真实包名的末段（meter / jsx / msvc / x64 / mem0）全都对不上。
 * 注意【不能】额外要求同时含小写：pnpm 的随机串取自 A-Za-z0-9，
 * 实测本机就有一个纯大写的 `AFJM5CM4`，多这条会把真残留漏掉。
 */
function isPnpmRandomSuffix(name: string): boolean {
  const m = /-([A-Za-z0-9]{8})$/.exec(name);
  const s = m?.[1];
  if (!s) return false;
  return /\d/.test(s) && /[A-Z]/.test(s);
}

export function scanResidue(nodeModules: string): ResidueEntry[] {
  if (!isDir(nodeModules)) return [];
  // 顶层这些是 pnpm 自己的基础设施，不是残留
  const infra = new Set([".bin", ".pnpm", ".modules.yaml", ".package-lock.json", ".npmrc"]);
  const out: ResidueEntry[] = [];

  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(nodeModules)];
  } catch {
    return [];
  }

  for (const e of entries) {
    if (!e.isDirectory) continue;
    if (infra.has(e.name)) continue;

    if (e.name.startsWith("@")) {
      // scoped 容器：残留只可能出现在它内部（形如 @scope/.xxx-HASH）
      try {
        for (const sub of Deno.readDirSync(p(nodeModules, e.name))) {
          if (!sub.isDirectory) continue;
          const kind = residueKindOf(sub.name);
          if (kind) out.push({ name: `${e.name}/${sub.name}`, kind });
        }
      } catch { /* ignore */ }
      continue;
    }
    const kind = residueKindOf(e.name);
    if (kind) out.push({ name: e.name, kind });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 单看一个目录名，判断它是不是残留物。命中返回形态说明，否则返回 null。
 *
 * 【这是本模块最需要小心的函数】：判错方向决定后果 ——
 * 漏报只是没帮上忙；误报会让用户去清掉真正的依赖，插件立刻全崩。
 * 所以每个模式都要求"多重特征同时成立"才算数，且必须与已知的
 * 正常传递依赖（rolldown / typescript / dsh-mnemon-provider-* …）对不上。
 * 回归用例见 core/status_test.ts。
 */
export function residueKindOf(name: string): string | null {
  // 允许直接传带 scope 的完整名（@codemirror/.lang-php_tmp_…）：只看 scope 之后的部分，
  // 这样调用方不必先自己拆名字（拆错了就会漏判）。
  const local = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  if (!local) return null;
  for (const f of RESIDUE_FORMS) {
    if (f.hit(local)) return f.kind;
  }
  return null;
}

export const coreStatusAction: ActionDef<Record<string, never>, CoreStatus> = {
  name: "core.status",
  domain: "core",
  title: "本体状态检查",
  description:
    "检测 DSH 本体版本、源码提交、构建记录是否一致，并检查插件双名单。只读，用来判断「是否需要完成更新」。",
  readonly: true,
  steps: ["定位本体源码", "读取 git 状态", "比对构建记录", "检查插件双名单", "汇总"],
  run: async (ctx): Promise<CoreStatus> => {
    ctx.step("s1", "定位本体源码与版本");
    ctx.progress(0.2);
    const status = await collectCoreStatus();
    ctx.detail(status.sourceRoot ? `位置：${status.sourceRoot}` : "未找到本体");
    ctx.throwIfCancelled();

    ctx.step("s2", "读取 git 状态");
    ctx.progress(0.4);
    ctx.detail(
      status.git
        ? `分支 ${status.git.branch} · 提交 ${status.git.headShort}${
          status.git.dirtyTracked > 0 ? ` · ${status.git.dirtyTracked} 个文件有改动` : ""
        }`
        : "不可用",
    );
    ctx.throwIfCancelled();

    ctx.step("s3", "比对构建记录");
    ctx.progress(0.65);
    ctx.detail(
      status.build
        ? status.needsFinishUpdate ? "结论：需要「完成更新」" : "结论：源码与产物一致"
        : "无构建记录",
    );
    ctx.throwIfCancelled();

    ctx.step("s4", "检查插件双名单");
    ctx.progress(0.85);
    ctx.detail(
      status.plugins
        ? `依赖 ${status.plugins.dependencies.length} · 名单 ${status.plugins.bundles.length} · 生效 ${status.plugins.active.length}`
        : "无 profile 清单",
    );
    ctx.progress(1);
    return status;
  },
};
