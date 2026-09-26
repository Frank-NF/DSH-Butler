/**
 * AI 助手核心：把用户自带的 OpenAI 兼容接口包成本地对话能力。
 *
 * 安全边界（三条，测试各有一条看着）：
 *   1) 密钥只从本地配置读、只随请求发给用户配置的端点，日志与错误信息里必须脱敏；
 *   2) 现场信息（概览/日志尾部）进提示词前必须过 maskSecrets；
 *   3) 地址归一化只认 OpenAI 兼容的 /chat/completions，不猜其它协议。
 */

import { maskSecrets } from "../../util/redact.ts";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenAI 兼容端点归一化：允许粘贴到域名根、/v1 层或完整路径。 */
export function chatCompletionsUrl(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, "");
  if (!u) throw new Error("API 地址为空");
  if (/\/chat\/completions$/.test(u)) return u;
  return u + "/chat/completions";
}

/** 调用户配置的对话接口；所有错误都翻译成中文人话，且绝不在错误文本里带密钥。 */
export async function aiChat(
  cfg: { baseUrl: string; apiKey: string; model: string },
  messages: AiMessage[],
  timeoutMs = 60_000,
): Promise<string> {
  if (!cfg.baseUrl.trim() || !cfg.model.trim() || !cfg.apiKey.trim()) {
    throw new Error("AI 配置不完整（地址 / 模型 / 密钥）");
  }
  const url = chatCompletionsUrl(cfg.baseUrl);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model.trim(), messages, temperature: 0.3, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|abort/i.test(msg)) throw new Error("AI 接口超时：检查地址与网络，或稍后再试");
    if (/fetch failed|network|econnrefused|enotfound|dns/i.test(msg)) {
      throw new Error("连不上 API 地址：网络不通或地址不可达（检查地址拼写、代理设置）");
    }
    throw new Error("连不上 API 地址：" + maskSecrets(msg));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const brief = maskSecrets(text.slice(0, 300));
    if (res.status === 401 || res.status === 403) throw new Error("API 密钥无效或无权限（" + res.status + "）");
    if (res.status === 404) throw new Error("接口路径不对（404）：确认地址是否到 /v1 这一层");
    if (res.status === 429) throw new Error("触发限流（429）：稍后再试或降低频率");
    throw new Error("AI 接口返回 " + res.status + "：" + brief);
  }
  let j: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  try {
    j = await res.json();
  } catch {
    throw new Error("AI 接口返回的不是 JSON");
  }
  const content = j.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    throw new Error("AI 返回了空内容" + (j.error?.message ? "：" + maskSecrets(j.error.message) : ""));
  }
  return content;
}

/** 系统提示词：维修助手的行为约束（结论先行 / 不虚构 / 危险操作走管家计划确认）。 */
export function buildSystemPrompt(): string {
  return [
    "你是 DSH 管家内置的本地维修助手。用户可能在 DSH 无法启动或行为异常时向你求助。",
    "规则：",
    "1. 结论先行；修复步骤按顺序编号，每步说清「做什么、在哪做、预期看到什么」。",
    "2. 只依据提供的现场信息推理；信息不足就明说还缺什么，并建议用户在管家界面跑哪个只读检查（如「运行全面体检」「运行状态」「环境与配置」）。",
    "3. 不虚构命令与路径；提到管家界面动作时用界面里的原话。",
    "4. 涉及删除、覆盖、更新等写操作时，先提醒风险，并说明管家会先弹计划、确认后才执行。",
    "5. 用简体中文回答，克制篇幅，不寒暄。",
  ].join("\n");
}

/** 把现场信息片段并入系统提示词：逐段脱敏 + 总长限幅。 */
export function assembleSystemPrompt(base: string, parts: string[], maxLen = 6000): string {
  const body = parts
    .filter((p) => p && p.trim())
    .map((p) => maskSecrets(p).trim())
    .join("\n\n");
  const joined = base + (body ? "\n\n现场信息（自动采集，已脱敏）：\n" + body : "");
  return joined.length > maxLen ? joined.slice(0, maxLen) + "\n…（超长部分已截断）" : joined;
}
