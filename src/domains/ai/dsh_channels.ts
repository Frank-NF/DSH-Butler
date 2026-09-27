/**
 * 从 DSH 自己的配置里读「模型通道」—— AI 助手的地址 / 密钥 / 模型不必让用户手抄一遍。
 *
 * 数据来源（全部只读，绝不修改 DSH 的任何文件）：
 *   ~/.dsh/profiles/<当前 profile>/cordis.patch.yml   ← 最高优先（DSH 真正在用的那份）
 *   ~/.dsh/profiles/<其它 profile>/cordis.patch.yml   ← 同 key 只补缺的字段
 *   ~/.dsh/settings.yaml[.imported]                   ← 旧版导入的设置，垫底
 *   ~/.dsh/.credentials.yaml                          ← refs: 里的密钥（apiKeyEnv → 真密钥）
 *
 * 安全边界：密钥只在管家进程内流转 —— 送到界面之前必须过 publicChannel()，
 * 那里把 apiKey 换成掩码。这条有测试钉着（dsh_channels_test.ts）。
 *
 * 为什么不用 YAML 库：这里只需要认「providers: → 通道名 → baseURL/apiKeyEnv/models」
 * 这一种形状，几十行就够，还省掉一个依赖与其版本风险。解析器是纯函数，可单测。
 */

import { listDir } from "../../host/fs.ts";
import { dshRoot, p } from "../../util/paths.ts";
import { effectiveProfileDir, loadConfig } from "../state/config.ts";
import { maskKey } from "./ai.ts";

/** 从 YAML 里认出来的一个 provider 声明。 */
export interface ParsedProvider {
  key: string;
  baseUrl: string;
  apiKeyEnv: string;
  displayName: string;
  models: string[];
}

/** 一份配置来源（路径只用于在界面上说清「这条是从哪读来的」）。 */
export interface ChannelSource {
  path: string;
  text: string;
}

export interface DshChannel {
  key: string;
  label: string;
  baseUrl: string;
  /** 地址来自内置默认值（DSH 配置里没写）—— 界面要提示"不对就自己改"。 */
  baseUrlFromDefaults: boolean;
  /** 推荐用的模型名（DSH 当前默认 > 配置里第一个模型 > 内置默认）。 */
  model: string;
  models: string[];
  apiKeyEnv: string;
  /** 真密钥：只在服务端用，送到界面之前必须过 publicChannel()。 */
  apiKey: string;
  /** 是不是 DSH 当前 agent-default-model 指向的通道。 */
  isDefault: boolean;
  /** 从哪个文件读到的（人话路径）。 */
  source: string;
}

/** 给界面的形状：没有 apiKey，只有掩码。 */
export interface PublicChannel {
  key: string;
  label: string;
  baseUrl: string;
  baseUrlFromDefaults: boolean;
  model: string;
  models: string[];
  apiKeyEnv: string;
  hasKey: boolean;
  keyMasked: string;
  isDefault: boolean;
  source: string;
}

/**
 * DSH 里没写 baseURL 时的兜底地址。
 *
 * 【为什么只放这几个】这些是公开且稳定的 OpenAI 兼容根地址；
 * 拿不准的一律不猜 —— 宁可让用户自己填，也不能把一个错地址装进配置里。
 */
export const KNOWN_BASE_URLS: Record<string, string> = {
  "deepseek": "https://api.deepseek.com",
  "deepseek-official": "https://api.deepseek.com",
  "xiaomi": "https://api.xiaomimimo.com/v1",
  "agnes": "https://api.agnes-ai.cn/v1",
  "tokenriver": "https://api.tokenriver.cn/v1",
  "zai": "https://api.z.ai/api/paas/v4",
  "openai": "https://api.openai.com/v1",
  "moonshot": "https://api.moonshot.cn/v1",
};

/** 同理：只有 DSH 完全没说模型名时才用。 */
export const KNOWN_MODELS: Record<string, string> = {
  "deepseek": "deepseek-chat",
  "deepseek-official": "deepseek-chat",
  "xiaomi": "mimo-v2.6-flash",
  "openai": "gpt-4o-mini",
  "moonshot": "moonshot-v1-8k",
};

const LABELS: Record<string, string> = {
  "deepseek": "DeepSeek",
  "deepseek-official": "DeepSeek（官方）",
  "xiaomi": "小米 MiMo",
  "agnes": "agnes",
  "zai": "智谱 GLM",
  "tokenriver": "词源之河",
  "openai": "OpenAI",
  "moonshot": "Moonshot Kimi",
};

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

function unquote(v: string): string {
  return v.trim().replace(/^["']/, "").replace(/["']$/, "").trim();
}

/**
 * 抽出文本里所有 `providers:` 块下的 provider（纯函数）。
 *
 * 两种形状都要认：
 *   profile 补丁   - id: llm-pi-ai / config: / providers: / xiaomi: ...
 *   导入的设置     llm-pi-ai: / providers: / agnes: ...
 */
export function parseProviders(text: string): ParsedProvider[] {
  const out: ParsedProvider[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const decl = lines[i]!;
    if (!/^providers:\s*$/.test(decl.trim())) continue;
    const base = indentOf(decl);
    let providerIndent = -1;
    let cur: ParsedProvider | null = null;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const raw = lines[j]!;
      const t = raw.trim();
      if (!t || t.startsWith("#")) continue;
      const ind = indentOf(raw);
      if (ind <= base) break;
      const head = /^([A-Za-z0-9_.-]+):\s*$/.exec(t);
      if (head) {
        if (providerIndent === -1) providerIndent = ind;
        if (ind === providerIndent) {
          if (cur) out.push(cur);
          cur = { key: head[1]!, baseUrl: "", apiKeyEnv: "", displayName: "", models: [] };
          continue;
        }
      }
      if (!cur) continue;
      // 缩进比通道名还浅 → 这个 providers 块结束了
      if (providerIndent !== -1 && ind < providerIndent) break;
      const field = /^(baseURL|apiKeyEnv|displayName):\s*(.+)$/.exec(t);
      if (field) {
        const v = unquote(field[2]!);
        if (field[1] === "baseURL") cur.baseUrl = v;
        else if (field[1] === "apiKeyEnv") cur.apiKeyEnv = v;
        else cur.displayName = v;
        continue;
      }
      // 模型在列表里：- id: xxx（其余字段不关心）
      const model = /^-\s*id:\s*(.+)$/.exec(t);
      if (model) cur.models.push(unquote(model[1]!));
    }
    if (cur) out.push(cur);
    i = j - 1;
  }
  return out;
}

/** `.credentials.yaml` 的 refs: 段 → { DEEPSEEK_API_KEY: "sk-..." }（纯函数）。 */
export function parseCredRefs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^refs:\s*$/.test(l.trim()));
  if (start < 0) return out;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    if (/^\S/.test(raw)) break; // 回到顶层 → refs 段结束
    const m = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    if (!m) continue;
    const v = unquote(m[2]!);
    if (v) out[m[1]!] = v;
  }
  return out;
}

/** `agent-default-model` 里 DSH 当前用的通道与模型（纯函数）。 */
export function parseDefaultModel(text: string): { provider: string; model: string } | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    const isEntry = /^-\s*id:\s*agent-default-model\s*$/.test(t) ||
      /^agent-default-model:\s*$/.test(t);
    if (!isEntry) continue;
    const base = indentOf(raw);
    let provider = "";
    let model = "";
    for (let j = i + 1; j < lines.length; j++) {
      const r2 = lines[j]!;
      const t2 = r2.trim();
      if (!t2 || t2.startsWith("#")) continue;
      if (indentOf(r2) <= base) break;
      const mp = /^provider:\s*(.+)$/.exec(t2);
      if (mp) provider = unquote(mp[1]!);
      const mm = /^model:\s*(.+)$/.exec(t2);
      if (mm) model = unquote(mm[1]!);
    }
    if (provider || model) return { provider, model };
  }
  return null;
}

/**
 * 按通道名找密钥引用（纯函数）。
 *
 * 顺序：配置里写明的 apiKeyEnv → 通道名大写下划线 + _API_KEY → 去掉后缀再试一次。
 * 最后那条是为了 deepseek-official 这种命名（真密钥挂在 DEEPSEEK_API_KEY 上）。
 */
export function resolveKeyRef(
  providerKey: string,
  declaredEnv: string,
  creds: Record<string, string>,
): { env: string; key: string } {
  const upper = providerKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const candidates = [declaredEnv, upper + "_API_KEY", upper.split("_")[0] + "_API_KEY"]
    .map((s) => (s ?? "").trim())
    .filter((s) => s !== "");
  for (const env of candidates) {
    const key = creds[env];
    if (key) return { env, key };
  }
  return { env: candidates[0] ?? "", key: "" };
}

/** 把多份配置来源合成一份通道清单（纯函数：给文本，给结果）。 */
export function buildChannels(srcs: ChannelSource[], creds: Record<string, string>): DshChannel[] {
  const merged = new Map<string, { p: ParsedProvider; source: string }>();
  let def: { provider: string; model: string } | null = null;
  for (const s of srcs) {
    for (const p of parseProviders(s.text)) {
      if (!p.key) continue;
      const prev = merged.get(p.key);
      merged.set(p.key, {
        p: {
          key: p.key,
          baseUrl: prev?.p.baseUrl || p.baseUrl,
          apiKeyEnv: prev?.p.apiKeyEnv || p.apiKeyEnv,
          displayName: prev?.p.displayName || p.displayName,
          models: (prev?.p.models.length ?? 0) > 0 ? prev!.p.models : p.models,
        },
        source: prev?.source ?? s.path,
      });
    }
    if (!def) {
      const d = parseDefaultModel(s.text);
      if (d && (d.provider || d.model)) def = d;
    }
  }
  // 凭据里有、配置里没声明的通道（例如 deepseek）：地址说得准的才补一条
  for (const env of Object.keys(creds)) {
    const m = /^([A-Z0-9_]+)_API_KEY$/.exec(env);
    if (!m) continue;
    const key = m[1]!.toLowerCase().replace(/_/g, "-");
    if (merged.has(key) || !KNOWN_BASE_URLS[key]) continue;
    merged.set(key, {
      p: { key, baseUrl: "", apiKeyEnv: env, displayName: "", models: [] },
      source: p(dshRoot(), ".credentials.yaml"),
    });
  }

  const out: DshChannel[] = [];
  for (const { p: prov, source } of merged.values()) {
    const slug = prov.key.toLowerCase();
    const declared = prov.baseUrl.trim();
    const baseUrl = declared || (KNOWN_BASE_URLS[slug] ?? "");
    if (!baseUrl) continue; // 地址都说不准的通道列出来只会让人误点
    const isDefault = def !== null && (def.provider === prov.key || def.provider === slug);
    const models = prov.models.filter((x) => x !== "");
    const fallbackModel = def?.model && isDefault ? def.model : (KNOWN_MODELS[slug] ?? "");
    const ref = resolveKeyRef(prov.key, prov.apiKeyEnv, creds);
    out.push({
      key: prov.key,
      label: prov.displayName || LABELS[slug] || prov.key,
      baseUrl,
      baseUrlFromDefaults: declared === "",
      model: models[0] ?? fallbackModel,
      models,
      apiKeyEnv: ref.env,
      apiKey: ref.key,
      isDefault,
      source,
    });
  }
  // 默认通道最前 → 有密钥的靠前 → 剩下的按名字
  out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if ((a.apiKey !== "") !== (b.apiKey !== "")) return a.apiKey !== "" ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
  return out;
}

/** 送到界面之前必须过这里：真密钥换成掩码，形状固定。 */
export function publicChannel(c: DshChannel): PublicChannel {
  return {
    key: c.key,
    label: c.label,
    baseUrl: c.baseUrl,
    baseUrlFromDefaults: c.baseUrlFromDefaults,
    model: c.model,
    models: c.models,
    apiKeyEnv: c.apiKeyEnv,
    hasKey: c.apiKey.length > 0,
    keyMasked: maskKey(c.apiKey),
    isDefault: c.isDefault,
    source: c.source,
  };
}

function readTextIfAny(path: string): string | null {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return null;
  }
}

/**
 * 要读的配置文件，按优先级排列（当前 profile 最前）。
 *
 * 当前 profile 那一条必然也在 profiles/ 里，去重按真实路径做。
 */
export function dshChannelSources(activeProfileDir?: string): ChannelSource[] {
  const active = activeProfileDir ?? effectiveProfileDir(loadConfig());
  const candidates: string[] = [
    p(active, "cordis.patch.yml"),
    ...listDir(p(dshRoot(), "profiles")).filter((e) => e.dir).map((e) =>
      p(dshRoot(), "profiles", e.name, "cordis.patch.yml")
    ),
    p(dshRoot(), "settings.yaml"),
    p(dshRoot(), "settings.yaml.imported"),
  ];
  const out: ChannelSource[] = [];
  const seen = new Set<string>();
  for (const path of candidates) {
    const norm = path.replace(/[\\/]+/g, "/").toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    const text = readTextIfAny(path);
    if (text !== null) out.push({ path, text });
  }
  return out;
}

/** 读磁盘版：DSH 里现在有哪些通道能用。 */
export function collectDshChannels(): DshChannel[] {
  const credsText = readTextIfAny(p(dshRoot(), ".credentials.yaml")) ?? "";
  return buildChannels(dshChannelSources(), parseCredRefs(credsText));
}
