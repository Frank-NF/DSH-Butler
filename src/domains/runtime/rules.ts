/**
 * runtime.rules —— 运行时诊断的【判定层】（AC-R1/R3）。
 *
 * 纯函数：RuntimeFacts → Finding[]。不碰磁盘、不起进程 ——
 * 每条规则用手搓 facts 做阴阳测试；阳性样本取自 dsh-plugin-repair
 * 技能记录的【真实故障报错原文】（13 类历史故障回归集，映射见各规则注释）。
 *
 * 13 条规则：
 *   1. runtime.proc-no-http         进程活着但服务没起来（AC-R1 态A；类型 U 近亲）
 *   2. runtime.plugins-not-ready    服务起来了但插件树没加载完（AC-R1 态B）
 *   3. runtime.duplicate-processes  多个服务进程（历史：重复启动）
 *   4. runtime.port-foreign         候选端口被非 DSH 进程占用（历史：端口冲突）
 *   5. runtime.stale-lock           僵尸写锁（类型 AH / 事故 #48）
 *   6. runtime.boot-failed          启动失败转储（类型 A1/Q/T/R/Y/Z/E 的启动侧）
 *   7. runtime.remote-hang          waiting for service: remote.*（类型 X）
 *   8. runtime.double-registration  has been registered at（类型 S / aigc-canvas）
 *   9. runtime.dep-unresolved       Cannot find package/module（类型 A1/E/AG）
 *  10. runtime.module-table-miss    missed the module table / 导出名缺失（类型 W/AG）
 *  11. runtime.strict-codec         strict codec has no create()（类型 V）
 *  12. runtime.preset-unmount       session resume 的 preset 挂载失败（类型 C/Z）
 *  13. runtime.save-fail            保存失败（类型 P/AH —— 分「有僵尸锁」与「宿主旧客户端新」两支）
 *
 * 时效语义（防「修一个早就修好的问题」）：日志证据 fresh（12h 内）→ error；
 * 非 fresh → info（历史现场）。启动失败转储现场窗口 15 分钟。
 */

import type { Finding } from "../../util/result.ts";
import { finding } from "../../util/result.ts";
import { DUMP_FRESH_MS, LOG_FRESH_HOURS, type RuntimeFacts } from "./facts.ts";

export interface Rule {
  id: string;
  title: string;
  test: (facts: RuntimeFacts) => Finding[];
}

/** 取某证据键的命中；freshOnly 只看现场。 */
function hits(f: RuntimeFacts, key: keyof RuntimeFacts["logHits"], freshOnly: boolean): string[] {
  return (f.logHits[key] ?? []).filter((h) => (freshOnly ? h.fresh : true)).map((h) => h.text);
}

function anyFresh(f: RuntimeFacts, key: keyof RuntimeFacts["logHits"]): boolean {
  return (f.logHits[key] ?? []).some((h) => h.fresh);
}

/** 历史现场（非 fresh）的统一降级：现场报 error，历史报 info。 */
function staleNote(): string {
  return `这些证据写入超过 ${LOG_FRESH_HOURS} 小时，记录的可能是历史故障 —— 若当前一切正常可忽略`;
}

const RULES: Rule[] = [
  {
    id: "runtime.proc-no-http",
    title: "进程活着但服务没起来（AC-R1 态A）",
    test: (f) => {
      if (f.procCount === 0) return [];
      if (f.http?.reachable) return [];
      const cause = f.http === null
        ? `进程在（PID ${f.pids.join("、")}），但没找到任何监听端口 —— 服务还没进入监听阶段或起来又挂了`
        : `进程在（PID ${f.pids.join("、")}），端口 ${f.port} 但 HTTP 不可达：${f.http.error ?? "未知错误"}`;
      const dumpHint = f.startupDump.failed && (f.startupDump.ageMs ?? Infinity) < DUMP_FRESH_MS
        ? `；本次启动有插件激活失败转储：${f.startupDump.failedPlugins.join("、") || "见日志"}`
        : "";
      return [
        finding("runtime.proc-no-http", "error", "服务进程活着，但界面访问不了", {
          cause: cause + dumpHint,
          impact: "浏览器打不开 DSH 界面，插件与设置全部用不了",
          action: "查看最新启动日志定位报错；若日志正常，重启服务",
          evidence: [
            ...f.pids.map((p) => `PID ${p}`),
            ...(f.port !== null ? [`端口 ${f.port}`] : []),
            ...(f.http?.error ? [f.http.error] : []),
            ...f.startupDump.lines.slice(0, 3),
          ],
        }),
      ];
    },
  },
  {
    id: "runtime.plugins-not-ready",
    title: "服务起来了但插件树没加载完（AC-R1 态B）",
    test: (f) => {
      if (f.procCount === 0 || !f.http?.reachable) return [];
      const d = f.startupDump;
      if (!d.failed) return [];
      if (d.ageMs === null || d.ageMs > DUMP_FRESH_MS) return []; // 历史现场由 boot-failed 规则报 info
      return [
        finding("runtime.plugins-not-ready", "error", "界面能打开，但插件树没有加载完", {
          cause:
            `HTTP 正常（${f.http.status}）而最新启动失败转储（${Math.round(d.ageMs / 1000)} 秒前）显示 ` +
            `${d.failedPlugins.length} 个插件激活失败：${d.failedPlugins.join("、") || "见日志"}`,
          impact: "页面能开但功能缺失：插件面板为空、保存报错、remote 服务 waiting —— 用户会以为「能打开就是好的」",
          action: "按转储里列出的失败插件逐个排查（多为包缺失或构建产物过期），修完重启服务",
          evidence: [d.path ?? "", ...d.lines.slice(0, 5)].filter(Boolean),
        }),
      ];
    },
  },
  {
    id: "runtime.duplicate-processes",
    title: "多个 DSH 服务进程同时在跑",
    test: (f) =>
      f.procCount <= 1
        ? []
        : [
            finding("runtime.duplicate-processes", "warn", `检测到 ${f.procCount} 个 DSH 服务进程`, {
              cause: "可能有多次启动没有正确结束（重复点启动 / 端口冲突后换了端口再起一个）",
              impact: "插件树可能被两个进程同时改写，出现「改了不生效」或莫名冲突",
              action: "保留所需端口上的那一个，结束其余进程后重启服务",
              evidence: f.pids.map((p) => `PID ${p}`),
            }),
          ],
  },
  {
    id: "runtime.port-foreign",
    title: "DSH 没在跑，但候选端口被别的程序占着",
    test: (f) =>
      f.procCount > 0 || f.foreignPorts.length === 0
        ? []
        : [
            finding("runtime.port-foreign", "warn", `端口被非 DSH 进程占用：${f.foreignPorts.map((x) => x.port).join("、")}`, {
              cause: `DSH 服务未运行，但候选端口有他人在监听：${f.foreignPorts.map((x) => `${x.port} → ${x.owners.join("、")}`).join("；")}`,
              impact: "下次启动 DSH 会端口冲突（旧版常见后果：换个端口又起一个，形成双进程）",
              action: "确认占用程序是否需要保留；冲突时改 DSH 端口配置或停掉占用程序",
            }),
          ],
  },
  {
    id: "runtime.stale-lock",
    title: "僵尸写锁（类型 AH / 事故 #48）",
    test: (f) => {
      const bad = f.locks.filter((l) => l.verdict === "stale" || l.verdict === "recycled");
      if (bad.length === 0) return [];
      return [
        finding("runtime.stale-lock", "warn", `发现 ${bad.length} 个失效写锁`, {
          cause: "持有者进程已不存在、或 PID 已被别的程序复用（多为程序被强杀/崩溃时留下）",
          impact: "DSH 的 atomic-write 只等 2 秒就超时且绝不自行移除别人的锁 → 之后所有配置写入失败，界面反复提示「保存失败，请重试」",
          action: "清理这些失效锁（只改名留证，绝不删；持有者是活 node 进程的锁本规则不会报）",
          evidence: bad.map((l) => `${l.path}（${l.verdict}）`),
        }),
      ];
    },
  },
  {
    id: "runtime.boot-failed",
    title: "启动失败转储（没起来时的根因现场）",
    test: (f) => {
      const d = f.startupDump;
      if (f.procCount > 0 || !d.failed) return [];
      const fresh = d.ageMs !== null && d.ageMs <= DUMP_FRESH_MS;
      return [
        finding("runtime.boot-failed", fresh ? "error" : "info", fresh
          ? `DSH 启动失败：${d.failedPlugins.length || "有"} 个插件激活失败`
          : `历史启动失败现场（${staleNote()}）`, {
          cause: d.lines[0] ?? "startup-*.log 记录了启动失败转储",
          impact: fresh
            ? "服务当前起不来，界面无法访问"
            : "这是过去某次失败启动的现场，未必代表现在还有问题",
          action: fresh
            ? `按失败清单修复：${d.failedPlugins.join("、") || "见日志"}，修完重启`
            : "若当前服务正常，可忽略；否则参考证据行排查",
          evidence: [d.path ?? "", ...d.lines.slice(0, 5), ...d.failedPlugins.map((p) => `插件：${p}`)].filter(Boolean),
        }),
      ];
    },
  },
  {
    id: "runtime.remote-hang",
    title: "remote 服务永久挂起（类型 X）",
    test: (f) => {
      const fresh = hits(f, "remoteHang", true);
      const stale = hits(f, "remoteHang", false);
      if (fresh.length > 0) {
        return [
          finding("runtime.remote-hang", "error", "客户端服务永久挂起：waiting for service: remote.*", {
            cause: "remote 命名空间的服务没有注册成功，依赖它的功能会一直 pending（静态快照缺失时整类远端调用永不返回）",
            impact: "相关面板永远转圈、命令无响应，且没有任何弹窗提示",
            action: "重启服务；若复发，检查 typert.remote-client.js 与 api/remotes/lib/client.js 是否与本体同步（client 面需整套重建）",
            evidence: fresh.slice(0, 3),
          }),
        ];
      }
      if (stale.length > 0) {
        return [
          finding("runtime.remote-hang", "info", `历史日志里出现过 remote 服务挂起（${staleNote()}）`, {
            cause: "非 fresh 命中：可能是过去一次失败启动留下的",
            impact: "若当前功能正常，无需处理",
            action: "观察即可；复发时按现场故障处理",
            evidence: stale.slice(0, 3),
          }),
        ];
      }
      return [];
    },
  },
  {
    id: "runtime.double-registration",
    title: "插件双重注册（类型 S / aigc-canvas 事故）",
    test: (f) => {
      const fresh = hits(f, "doubleReg", true);
      const stale = hits(f, "doubleReg", false);
      if (fresh.length > 0) {
        return [
          finding("runtime.double-registration", "error", "同一插件被注册了两次", {
            cause: "日志出现 `has been registered at` —— 同一 entry 经两条路径进入插件树（bundles + profile patch 双写，或跨层重复 insert）",
            impact: "服务冲突，对应功能行为错乱或启动即报错",
            action: "二选一保留：从 bundles 名单或 cordis.patch.yml 里去掉重复的那份（与 plugin.diagnose 的重复注册规则互相印证）",
            evidence: fresh.slice(0, 3),
          }),
        ];
      }
      if (stale.length > 0) {
        return [
          finding("runtime.double-registration", "info", `历史日志里出现过插件双重注册（${staleNote()}）`, {
            cause: "非 fresh 命中",
            impact: "若当前功能正常，无需处理",
            action: "观察即可",
            evidence: stale.slice(0, 3),
          }),
        ];
      }
      return [];
    },
  },
  {
    id: "runtime.dep-unresolved",
    title: "依赖解析失败：Cannot find package/module（类型 A1/E/AG）",
    test: (f) => {
      const fresh = hits(f, "depUnresolved", true);
      const stale = hits(f, "depUnresolved", false);
      if (fresh.length > 0) {
        return [
          finding("runtime.dep-unresolved", "error", "依赖包解析失败", {
            cause: "日志出现 Cannot find package/module —— 包被移除、安装中断（自动更新连坐挪空兄弟插件）或主包升级后依赖没跟上",
            impact: "相关插件 import 失败，插件树缺枝",
            action: "重装受影响的插件包；若源于自动更新连坐，按隔离区恢复被挪空的兄弟插件",
            evidence: fresh.slice(0, 3),
          }),
        ];
      }
      if (stale.length > 0) {
        return [
          finding("runtime.dep-unresolved", "info", `历史日志里出现过依赖解析失败（${staleNote()}）`, {
            cause: "非 fresh 命中",
            impact: "若当前功能正常，无需处理",
            action: "观察即可",
            evidence: stale.slice(0, 3),
          }),
        ];
      }
      return [];
    },
  },
  {
    id: "runtime.module-table-miss",
    title: "客户端模块表缺包 / 导出名缺失（类型 W/AG）",
    test: (f) => {
      const fresh = hits(f, "moduleTable", true);
      const stale = hits(f, "moduleTable", false);
      if (fresh.length > 0) {
        return [
          finding("runtime.module-table-miss", "error", "客户端模块表缺包或导出名对不上", {
            cause: "日志出现 missed the module table / does not provide an export named —— 插件 require 了没进模块表的包，或产物版本与声明不一致",
            impact: "客户端插件「已加载但功能无反应」或直接 import 失败",
            action: "重建客户端产物（client 面只能整套重建，不许按包增量）；核对包版本与导出名",
            evidence: fresh.slice(0, 3),
          }),
        ];
      }
      if (stale.length > 0) {
        return [
          finding("runtime.module-table-miss", "info", `历史日志里出现过模块表缺包（${staleNote()}）`, {
            cause: "非 fresh 命中",
            impact: "若当前功能正常，无需处理",
            action: "观察即可",
            evidence: stale.slice(0, 3),
          }),
        ];
      }
      return [];
    },
  },
  {
    id: "runtime.strict-codec",
    title: "strict codec 缺 create() 工厂（类型 V）",
    test: (f) => {
      const fresh = hits(f, "strictCodec", true);
      const stale = hits(f, "strictCodec", false);
      if (fresh.length > 0) {
        return [
          finding("runtime.strict-codec", "error", "远程调用编解码器缺 create() 工厂", {
            cause: "日志出现 `strict codec has no create() factory` —— 客户端远程快照与服务端 API 版本错配",
            impact: "对应 remote 调用全部失败，功能不可用",
            action: "重启服务让客户端快照刷新；复发则整套重建 client 面（typert.remote-client.js 快照过期）",
            evidence: fresh.slice(0, 3),
          }),
        ];
      }
      if (stale.length > 0) {
        return [
          finding("runtime.strict-codec", "info", `历史日志里出现过 codec 报错（${staleNote()}）`, {
            cause: "非 fresh 命中",
            impact: "若当前功能正常，无需处理",
            action: "观察即可",
            evidence: stale.slice(0, 3),
          }),
        ];
      }
      return [];
    },
  },
  {
    id: "runtime.preset-unmount",
    title: "session resume 的 preset 挂载失败（类型 C/Z）",
    test: (f) => {
      const fresh = hits(f, "presetUnmount", true);
      const stale = hits(f, "presetUnmount", false);
      if (fresh.length > 0) {
        return [
          finding("runtime.preset-unmount", "error", "会话恢复失败：preset 挂载不了", {
            cause: "日志出现 failed to mount / resume failed for session —— preset 目录丢失，或预设引用了上游已改名/删除的插件",
            impact: "历史会话打不开（resume 失败），用户以为数据丢了",
            action: "恢复 preset 目录（类型 C）或把预设里的旧插件名改成现行名（类型 Z）",
            evidence: fresh.slice(0, 3),
          }),
        ];
      }
      if (stale.length > 0) {
        return [
          finding("runtime.preset-unmount", "info", `历史日志里出现过会话恢复失败（${staleNote()}）`, {
            cause: "非 fresh 命中",
            impact: "若当前会话能正常打开，无需处理",
            action: "观察即可",
            evidence: stale.slice(0, 3),
          }),
        ];
      }
      return [];
    },
  },
  {
    id: "runtime.save-fail",
    title: "「保存失败」（类型 P/AH —— 分两支定位）",
    test: (f) => {
      if (!anyFresh(f, "saveFail")) return [];
      const badLocks = f.locks.filter((l) => l.verdict === "stale" || l.verdict === "recycled");
      if (badLocks.length > 0) {
        return [
          finding("runtime.save-fail", "warn", "保存失败 —— 现场有僵尸写锁", {
            cause: `日志出现「保存失败」且同时发现 ${badLocks.length} 个僵尸写锁：写入被锁住等超时（AH 的典型现场）`,
            impact: "所有配置修改都存不下去",
            action: "清理失效锁后重试保存",
            fixAction: "runtime.repair",
            evidence: badLocks.map((l) => l.path),
          }),
        ];
      }
      return [
        finding("runtime.save-fail", "warn", "保存失败 —— 锁正常，多半是宿主旧 / 客户端新", {
          cause: "日志出现「保存失败」但没有僵尸锁：多半是宿主旧 / 客户端新 —— 更新插件后没重启服务器（类型 P）",
          impact: "保存类操作持续失败，界面只提示「请重试」",
          action: "重启 DSH 服务让宿主与客户端版本对齐",
        }),
      ];
    },
  },
];

/** 跑全部规则，按声明顺序输出。 */
export function runRules(facts: RuntimeFacts): Finding[] {
  return RULES.flatMap((r) => r.test(facts));
}

export const RULE_COUNT = RULES.length;

/** 全部规则 id（回归映射测试用来断言「历史故障 → 规则」的规则真实存在）。 */
export const RULE_IDS: readonly string[] = RULES.map((r) => r.id);
