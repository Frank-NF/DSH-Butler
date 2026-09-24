/**
 * plugin.rules —— 插件诊断的【判定层】。
 *
 * 纯函数：PluginFacts → Finding[]。不读磁盘、不起进程、不碰真实 DSH 目录 ——
 * 所以每条规则都能用手搓的 facts 样本做阴阳测试（AC-P4）。
 *
 * 规则清单（12 条，AC-P4 要求每条都有阳性 + 阴性样本）：
 *   1. plugin.manifest-missing          profile 的 package.json 缺失/坏掉
 *   2. plugin.declared-but-inactive     装了但没进 bundles（AC-P1）
 *   3. plugin.declared-not-installed    装了、没生效、包目录还解析不到
 *   4. plugin.repair-blocked            装了没生效但不可作层 → 禁止盲目补登记（AC-P2 前半）
 *   5. plugin.bundled-but-undeclared    bundles 里的名字哪儿都解析不到
 *   6. plugin.not-a-layer               登记在册但不可作层（AC-P2 后半）
 *   7. plugin.dup-insert-profile-bundle profile 与包自带 patch 双重 insert（技能 A3/S）
 *   8. plugin.dup-insert-cross-bundle   两个包（或同包两文件）insert 同一 id（技能 A3b）
 *   9. plugin.zombie-lock               僵尸写锁 stale/recycled（技能 AH / 事故 #48）
 *  10. plugin.lock-unrecognized         锁看不懂 —— 只报告，绝不判可清
 *  11. plugin.temp-dependency           依赖指向 %TEMP%（机器迁移即断）
 *  12. plugin.pnpm-residue              pnpm 中断残留
 *
 * 阴性基线（防「正常机器天天误报」，来自真机取证）：
 *   - profile cordis.patch.yml 顶层全是 targeting `- id:`（不构成重复注册，不许报）
 *   - @deepseek-ai/dsh-web-app 的 dsh.bundle.patch 是 5 元素数组（合法，不许报）
 *   - inBox 基座包不写 dependencies 也合法（不许报）
 */

import type { Finding } from "../../util/result.ts";
import { finding } from "../../util/result.ts";
import type { LayerVerdict, PluginFacts } from "./facts.ts";

/** 一条诊断规则。产出的 finding.id 即规则 id（多条命中共享 id，用 data 区分）。 */
export interface Rule {
  id: string;
  /** 人话说明，供文档与规则列表展示。 */
  title: string;
  test: (facts: PluginFacts) => Finding[];
}

/** 不可作层原因 → 人话解释（与本体 throw 点一一对应）。 */
const REASON_TEXT: Record<LayerVerdict["reason"] & string, string> = {
  unresolved: "这个名字在安装锚点与 profile 的 node_modules 都解析不到",
  "no-dsh-bundle": "包的 package.json 里没有 dsh.bundle 对象",
  "patch-illegal": "dsh.bundle.patch 既不是字符串也不是字符串数组",
  "patch-missing": "声明的 patch 文件在磁盘上不存在",
};

/** 本体遇到不可作层 bundle 的真实行为（profile.ts:666-668 catch → skip），两种后果都写全。 */
const BAD_LAYER_IMPACT =
  "本体会在 stderr 警告后跳过该层：层内插件全部不生效；若该包同时被其它层 insert 引用，则插件树加载失败。";

const RULES: Rule[] = [
  {
    id: "plugin.manifest-missing",
    title: "profile 的 package.json 缺失或无法解析",
    test: (f) =>
      f.manifestExists
        ? []
        : [
            finding("plugin.manifest-missing", "error", "profile 的 package.json 缺失或无法解析", {
              cause: `读不到或解析失败：${f.profileDir}\\package.json`,
              impact: "DSH 无法加载 profile，插件双名单、依赖全部无从谈起。",
              action: "检查该文件是否被误删或写坏；从备份恢复，或重建 profile。",
              evidence: [f.profileDir],
            }),
          ],
  },
  {
    id: "plugin.declared-but-inactive",
    title: "插件装了但没登记进 bundles，永远不会加载",
    test: (f) =>
      f.lists.declaredButInactive.map((name) =>
        finding("plugin.declared-but-inactive", "error", `插件「${name}」装了但没生效`, {
          cause:
            "activePlugins = dependencies ∩ dsh.profile.bundles（双名单交集）。它在 dependencies 里，但没登记进 bundles。",
          impact: "插件永远不会被加载，界面上表现为「装了却找不到」。",
          action:
            "把它补登记进 dsh.profile.bundles；若同时命中「不可作层」告警，先修包本身再登记。",
          fixAction: "plugin.repair",
          data: { plugin: name },
        }),
      ),
  },
  {
    id: "plugin.declared-not-installed",
    title: "登记在 dependencies 但包目录根本不存在",
    test: (f) =>
      f.inactiveLayers
        .filter((l) => l.reason === "unresolved")
        .map((l) =>
          finding("plugin.declared-not-installed", "error", `插件「${l.name}」声明了但没装上`, {
            cause: "dependencies 里有它，但在安装锚点与 profile 的 node_modules 都找不到包目录。",
            impact: "多半是安装中断过（pnpm 没装完），插件不可用。",
            action: "重装该插件（或补跑一次安装），不要直接补登记 bundles —— 目录都没有。",
            data: { plugin: l.name },
          }),
        ),
  },
  {
    id: "plugin.repair-blocked",
    title: "装了没生效，但这个包不可作层 —— 禁止盲目补登记",
    test: (f) =>
      f.inactiveLayers
        .filter((l) => l.reason !== null && l.reason !== "unresolved")
        .map((l) =>
          finding("plugin.repair-blocked", "error", `插件「${l.name}」不能直接补登记进 bundles`, {
            cause: `${REASON_TEXT[l.reason ?? "no-dsh-bundle"]}（${l.reason}）`,
            impact: BAD_LAYER_IMPACT,
            action: "先修复包本身（补 dsh.bundle 声明 / 补 patch 文件），修好再登记。绕过这道守卫会把 DSH 搞出启动问题。",
            evidence: l.dir ? [l.dir] : [],
            data: { plugin: l.name, reason: l.reason },
          }),
        ),
  },
  {
    id: "plugin.bundled-but-undeclared",
    title: "bundles 里的名字哪儿都解析不到",
    test: (f) =>
      f.lists.bundledButUndeclared.map((name) =>
        finding("plugin.bundled-but-undeclared", "error", `bundles 里的「${name}」找不到包`, {
          cause: "安装锚点与 profile 的 node_modules 都没有这个包（多半是被卸载/清残留时清掉了目录，名单却没删）。",
          impact: BAD_LAYER_IMPACT,
          action: "要么补装这个包，要么把它从 bundles 名单里摘掉 —— 名单和实物必须对得上。",
          data: { plugin: name },
        }),
      ),
  },
  {
    id: "plugin.not-a-layer",
    title: "登记在册但不可作层（AC-P2 拦截对象）",
    test: (f) =>
      f.layers
        .filter((l) => !l.canLayer && l.reason !== null && l.reason !== "unresolved")
        .map((l) =>
          finding("plugin.not-a-layer", "error", `bundles 里的「${l.name}」不可作层`, {
            cause: `${REASON_TEXT[l.reason ?? "no-dsh-bundle"]}（${l.reason}）`,
            impact: BAD_LAYER_IMPACT,
            action: "不要改 profile 去迁就它；修复包本身（补声明/补文件），或把它从 bundles 摘掉。",
            evidence: l.dir ? [l.dir, ...l.patchFiles] : [],
            data: { plugin: l.name, reason: l.reason },
          }),
        ),
  },
  {
    id: "plugin.dup-insert-profile-bundle",
    title: "profile 与包自带 patch 对同一 id 双重 insert（技能 A3/S）",
    test: (f) => {
      const ownerOf = new Map<string, string>();
      for (const b of f.bundlePatchInsertIds) {
        for (const id of b.ids) if (!ownerOf.has(id)) ownerOf.set(id, b.pkg);
      }
      const out: Finding[] = [];
      for (const id of f.profilePatchInsertIds) {
        const owner = ownerOf.get(id);
        if (owner === undefined) continue;
        out.push(
          finding("plugin.dup-insert-profile-bundle", "error", `插件入口「${id}」被注册了两次`, {
            cause: `profile 的 cordis.patch.yml 与包 ${owner} 自带的 patch 都对它做了 - insert:（双重注册）。`,
            impact: "loader entry 双重注册，插件树加载失败或行为错乱（历史上 aigc-canvas 就这么炸过）。",
            action: "两处只留一处 insert：包自己带 patch 就删 profile 里那份；反之亦然。",
            evidence: [`profile cordis.patch.yml`, `pkg ${owner}`],
            data: { insertId: id, pkg: owner },
          }),
        );
      }
      return out;
    },
  },
  {
    id: "plugin.dup-insert-cross-bundle",
    title: "两个包（或同包两个文件）insert 同一 id（技能 A3b）",
    test: (f) => {
      const byId = new Map<string, string[]>();
      for (const b of f.bundlePatchInsertIds) {
        for (const id of b.ids) {
          const arr = byId.get(id) ?? [];
          arr.push(`${b.pkg}#${b.patchFile}`);
          byId.set(id, arr);
        }
      }
      const out: Finding[] = [];
      for (const [id, sources] of byId) {
        if (sources.length < 2) continue;
        out.push(
          finding("plugin.dup-insert-cross-bundle", "error", `插件入口「${id}」被注册了 ${sources.length} 次`, {
            cause: `多个 patch 文件都对它做了 - insert:：${sources.join("、")}`,
            impact: "loader entry 双重注册，插件树加载失败或行为错乱。",
            action: "确认哪个包才是该入口的正主，把多余的 insert 摘掉。",
            evidence: sources,
            data: { insertId: id, sources },
          }),
        );
      }
      return out;
    },
  },
  {
    id: "plugin.zombie-lock",
    title: "僵尸写锁（持有者已死 / PID 被复用）",
    test: (f) =>
      f.locks
        .filter((l) => l.verdict === "stale" || l.verdict === "recycled")
        .map((l) =>
          finding(
            "plugin.zombie-lock",
            "error",
            l.verdict === "stale"
              ? `僵尸写锁：${l.path}（PID ${l.pid} 已不存在）`
              : `失效写锁：${l.path}（PID ${l.pid} 已被 ${l.procName ?? "别的程序"} 复用）`,
            {
              cause:
                l.verdict === "stale"
                  ? "持有者进程已崩溃/退出，锁文件却留在原地。"
                  : "锁里记的 PID 还活着，但已经是别的程序 —— 这把锁早已失效。",
              impact: "DSH 的 atomic-write 只等 2 秒就超时、绝不自行移除别人的锁 → 之后所有配置写入全部失败。",
              action: "把锁改名留证（.stale-<时间戳>）再继续；持有者是活 node 进程时绝不清（本规则不会对 held 报警）。",
              evidence: [l.path, `firstLine=${l.firstLine}`, l.procName ? `proc=${l.procName}` : ""].filter(Boolean),
              data: { path: l.path, pid: l.pid, verdict: l.verdict },
            },
          ),
        ),
  },
  {
    id: "plugin.lock-unrecognized",
    title: "锁文件看不懂 —— 只报告，绝不判可清",
    test: (f) =>
      f.locks
        .filter((l) => l.verdict === "unknown")
        .map((l) =>
          finding("plugin.lock-unrecognized", "info", `看不懂的锁文件：${l.path}`, {
            cause: l.firstLine === "" ? "读不到首行（文件为空或无权限）。" : `首行不是 PID：「${l.firstLine}」`,
            impact: "无法判断持有者死活，因此不会自动清理 —— 宁可当没看见，也绝不误清活锁。",
            action: "人工看一眼这是什么进程的锁；确认无人持有后再处理。",
            evidence: [l.path],
            data: { path: l.path },
          }),
        ),
  },
  {
    id: "plugin.temp-dependency",
    title: "依赖指向 %TEMP%（临时目录），机器一清就断",
    test: (f) => {
      const out: Finding[] = [];
      for (const [name, spec] of Object.entries(f.depEntries)) {
        if (!spec.startsWith("file:")) continue;
        const target = spec.slice("file:".length);
        if (!/%TEMP%|[\\/]temp[\\/]/i.test(target)) continue;
        out.push(
          finding("plugin.temp-dependency", "warn", `插件「${name}」指向临时目录`, {
            cause: `依赖声明是 ${spec} —— 指向系统临时目录。`,
            impact: "系统清理临时文件后这个依赖就断了，且换机器/重装系统必坏。",
            action: "把插件挪到持久位置再安装，别让依赖住在临时目录里。",
            data: { plugin: name, spec },
          }),
        );
      }
      return out;
    },
  },
  {
    id: "plugin.pnpm-residue",
    title: "profile/node_modules 下有 pnpm 中断残留",
    test: (f) =>
      f.residue.length === 0
        ? []
        : [
            finding("plugin.pnpm-residue", "warn", `发现 ${f.residue.length} 处安装残留`, {
              cause: "pnpm 安装/更新被中断时会留下临时目录或孤儿包（特征形态见 kind 说明）。",
              impact: "残留物可能被当作打包入口或占住包名，导致构建/加载异常（实测踩过：孤儿 lib/ 让构建挂掉）。",
              action: "清走残留（只进隔离区、不删文件）；本阶段只读报告，清理动作后续提供。",
              evidence: f.residue.map((r) => `${r.name}（${r.kind}）`),
              data: { count: f.residue.length },
            }),
          ],
  },
];

/** 跑全部规则，按规则声明顺序输出。 */
export function runRules(facts: PluginFacts): Finding[] {
  return RULES.flatMap((r) => r.test(facts));
}

/** 规则总数（测试断言 ≥10，AC-P4 的门槛）。 */
export const RULE_COUNT = RULES.length;

/**
 * AC-P2：修复动作（S3 的 plugin.repair）在【改动任何文件之前】必须先跑这道拦截。
 * 返回的发现里只要有一条 error 级，动作引擎就拒绝执行（engine 的 preflight 语义）。
 * S2 阶段 repair 尚未注册，这个入口先钉住契约并被测试覆盖。
 */
export function repairBlockers(facts: PluginFacts): Finding[] {
  const ids = new Set(["plugin.repair-blocked", "plugin.not-a-layer", "plugin.bundled-but-undeclared"]);
  return RULES.filter((r) => ids.has(r.id)).flatMap((r) => r.test(facts));
}
