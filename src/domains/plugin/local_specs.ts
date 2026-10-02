/**
 * 本地依赖协议改写：pnpm 的 link: / portal: → npm 认得的 file:。
 *
 * 【为什么非有它不可 —— 2026-10-02 用户现场】
 * profile 清单里只要有一条 `"pkg": "link:D:\\…"`，npm 连依赖树都建不起来：
 *   npm error code EUNSUPPORTEDPROTOCOL
 *   npm error Unsupported URL Type "link:"
 * 管家所有写操作都靠 npm 落地（安装 / 卸载 / 定向移除 / 重建锁文件），
 * 于是一条 link: 就能把「卸载任何一个插件」全部堵死：定向移除失败 → 退回全量重算
 * → 同样撞这条错 → 整个卸载回滚。实测用户连卸 3 个插件（billion-context、
 * dsh-cost-meter、…）都栽在这一条上，且报错完全指不到真正原因。
 *
 * link: 是 pnpm 的写法（DSH 自己用 pnpm 装 profile，本地开发中的插件就写成 link:；
 * 装出来的 node_modules 条目是 Junction 指向源码目录）。npm 没有任何开关能接受
 * link:，只能改写清单 —— 这不是绕过，是补上两个包管理器之间缺的那层翻译。
 *
 * 【为什么改写成 file: 而不是别的】
 * 2026-10-02 同机实测（Temp/linkfix-probe.ps1，npm 11.19.0）：
 *   link:file 对照组 → 退出码 1，EUNSUPPORTEDPROTOCOL，node_modules 里什么都没有；
 *   file:实验组     → 退出码 0，"added 1 package in 239ms"，
 *                     node_modules\\@local\\prompt-optimizer 是 **Junction 指向源码目录**（不是拷贝）。
 * 也就是说 file: 与 link: 对本地目录的落地形态一致（都是链接），
 * 「改源码 → 立即生效」的开发流程照旧，用户不会因为管家的改写而失去联动。
 *
 * 【改写时机与安全性】
 *   · 只在「真的要调 npm 之前」触发，且清单里真有要改的协议时才写盘（幂等）；
 *   · 读不到 / JSON 坏 / 写失败一律当无事发生，绝不让规范化自己变成新的失败点
 *     （那种情况让 npm 照常报它自己的错，排查路径不变）；
 *   · 改的是清单原文，写法与管家其它清单写入一致（2 空格缩进 + 末尾换行）；
 *   · 安装 / 卸载都是事务化操作，动手前已有清单回滚点，所以这次改写可被一并还原。
 */

import { writeJsonAtomic } from "../../host/fs.ts";
import { log } from "../../util/log.ts";
import { p } from "../../util/paths.ts";

/** npm 不认、而 pnpm 系（含 DSH 装 profile）会写出来的协议 → npm 的等价写法。 */
const PROTOCOL_MAP: Record<string, string> = { link: "file", portal: "file" };

/** 会真正装包的依赖字段（peerDependencies 不落盘，不动它）。 */
export const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
export type DepField = (typeof DEP_FIELDS)[number];

export interface SpecRewrite {
  /** 依赖名（含 scope）。 */
  name: string;
  field: DepField;
  from: string;
  to: string;
}

/** 把一条依赖串里的本地协议换成 npm 认得的写法；其它串原样返回。 */
export function convertLocalSpec(spec: string): { spec: string; changed: boolean } {
  const s = spec.trim();
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):([\s\S]*)$/);
  if (!m) return { spec: s, changed: false };
  const target = PROTOCOL_MAP[m[1]!.toLowerCase()];
  if (!target) return { spec: s, changed: false };
  return { spec: `${target}:${m[2]}`, changed: true };
}

export interface SpecPlan {
  rewrites: SpecRewrite[];
  /**
   * 改写后的清单；没有要改的（或 JSON 解析不了）时为 null ——
   * 调用方据此决定要不要写盘，避免「没改也重写」把用户清单的排版搅了。
   */
  manifest: Record<string, unknown> | null;
}

/**
 * 纯函数：给定清单原文，算出要改哪几条、给出改写后的清单。
 * 解析不了就返回空计划 —— 不猜、不改，把错误留给真正会读它的人（npm）报。
 */
export function planLocalSpecRewrites(manifestText: string): SpecPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    return { rewrites: [], manifest: null };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { rewrites: [], manifest: null };
  }
  const next = structuredClone(parsed) as Record<string, unknown>;
  const rewrites: SpecRewrite[] = [];
  for (const field of DEP_FIELDS) {
    const deps = next[field];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    const bag = deps as Record<string, unknown>;
    for (const [name, raw] of Object.entries(bag)) {
      if (typeof raw !== "string") continue;
      const { spec, changed } = convertLocalSpec(raw);
      if (!changed) continue;
      bag[name] = spec;
      rewrites.push({ name, field, from: raw, to: spec });
    }
  }
  return { rewrites, manifest: rewrites.length > 0 ? next : null };
}

/** 只读体检用：清单里有哪些 npm 认不出来的本地依赖（不写盘）。 */
export function readLocalSpecRewrites(profileDir: string): SpecRewrite[] {
  try {
    return planLocalSpecRewrites(Deno.readTextFileSync(p(profileDir, "package.json"))).rewrites;
  } catch {
    return [];
  }
}

/**
 * 调 npm 之前把清单里的 link:/portal: 换成 file:，返回实际改了几条。
 *
 * 幂等：没有要改的协议时一个字节都不写。永不抛错 —— 它只是让 npm 有机会跑起来，
 * 不值得自己成为失败原因。
 */
export function normalizeLocalSpecs(profileDir: string): SpecRewrite[] {
  const path = p(profileDir, "package.json");
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return []; // 没有清单 / 读不到：让 npm 自己报它的错
  }
  const { rewrites, manifest } = planLocalSpecRewrites(text);
  if (!manifest || rewrites.length === 0) return [];
  try {
    writeJsonAtomic(path, manifest);
  } catch (e) {
    log.warn("plugin", `本地依赖协议改写失败（不影响别的，继续让 npm 自己报错）：${(e as Error).message}`);
    return [];
  }
  for (const r of rewrites) {
    log.info(
      "plugin",
      `依赖协议已改写：${r.name} ${r.from} → ${r.to}（npm 不认 link:/portal:；file: 同样落成指向源码目录的链接）`,
    );
  }
  return rewrites;
}
