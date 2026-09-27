/**
 * 「从 DSH 导入通道」的解析与安全边界测试。
 *
 * 这里钉三件事：
 *   1) 真机那两种 YAML 形状都要能认（profile 补丁的列表形式 / 导入设置的映射形式）；
 *   2) 多份配置合并时，当前 profile 说了算，缺的字段才由后面的补；
 *   3) 送到界面之前密钥必须只剩掩码 —— 这条写错了就是"把用户的密钥发到页面上"。
 */

import { assertEquals } from "@std/assert";
import {
  buildChannels,
  type ChannelSource,
  parseCredRefs,
  parseDefaultModel,
  parseProviders,
  publicChannel,
  resolveKeyRef,
} from "./dsh_channels.ts";

/** 真机 profiles/web/cordis.patch.yml 的形状（列表形式）。 */
const PATCH = `# 注释行要跳过
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      xiaomi:
        models:
          - id: mimo-v2.6-flash
            name: mimo-v2.6-flash
            input:
              - text
        baseURL: https://api.xiaomimimo.com/v1
        apiKeyEnv: XIAOMI_API_KEY
      agnes:
        displayName: agnes-3.0
        apiKeyEnv: AGNES_API_KEY
        baseURL: https://api.agnes-ai.cn/v1
        models:
          - id: agnes-2.5-flash
          - id: agnes-3.0-flash
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: xiaomi
    model: mimo-v2.6-flash
`;

/** 真机 settings.yaml.imported 的形状（映射形式 + 有通道没写 baseURL）。 */
const IMPORTED = `llm-pi-ai:
  providers:
    zai:
      models:
        - id: glm-5.3-flash
          name: GLM-5.3-Flash
      apiKeyEnv: ZAI_API_KEY
agent-default-model:
  provider: deepseek-official
  model: deepseek-flash
`;

const CREDS = `version: 1
records:
  x:
    kind: grant
refs:
  DEEPSEEK_API_KEY: sk-deepseek-key
  ZAI_API_KEY: ebcd1234.hxkp
  MIMO_COOKIE: 'api-platform_serviceToken="xx"
    userId=1'
`;

Deno.test("通道解析：profile 补丁（列表形式）能认出通道 / 地址 / 密钥引用 / 模型", () => {
  const ps = parseProviders(PATCH);
  assertEquals(ps.map((p) => p.key), ["xiaomi", "agnes"]);
  assertEquals(ps[0]!.baseUrl, "https://api.xiaomimimo.com/v1");
  assertEquals(ps[0]!.apiKeyEnv, "XIAOMI_API_KEY");
  assertEquals(ps[0]!.models, ["mimo-v2.6-flash"]);
  assertEquals(ps[1]!.displayName, "agnes-3.0");
  assertEquals(ps[1]!.models, ["agnes-2.5-flash", "agnes-3.0-flash"], "同通道的模型要全收");
});

Deno.test("通道解析：导入设置（映射形式）与「没写 baseURL」也认", () => {
  const ps = parseProviders(IMPORTED);
  assertEquals(ps.length, 1);
  assertEquals(ps[0]!.key, "zai");
  assertEquals(ps[0]!.baseUrl, "", "DSH 里没写地址就必须是空，不能瞎猜");
  assertEquals(ps[0]!.apiKeyEnv, "ZAI_API_KEY");
  assertEquals(ps[0]!.models, ["glm-5.3-flash"]);
});

Deno.test("通道解析：注释与空行不干扰，providers 块结束就收手", () => {
  const text = "providers:\n  a:\n    baseURL: https://a.example/v1\nother:\n  providers: []\n  b:\n    baseURL: https://b.example/v1\n";
  const ps = parseProviders(text);
  assertEquals(ps.map((p) => p.key), ["a"], "第二个 providers 是其它 id 的配置，不该混进来");
});

Deno.test("密钥引用：只从 refs: 段取，多行值只取第一行", () => {
  const refs = parseCredRefs(CREDS);
  assertEquals(refs.DEEPSEEK_API_KEY, "sk-deepseek-key");
  assertEquals(refs.ZAI_API_KEY, "ebcd1234.hxkp");
  assertEquals(Object.keys(refs).includes("x"), false, "records: 段里的东西不是密钥");
  assertEquals(refs.MIMO_COOKIE!.startsWith("api-platform_serviceToken"), true);
});

Deno.test("默认模型：两种形状都能读出来", () => {
  assertEquals(parseDefaultModel(PATCH), { provider: "xiaomi", model: "mimo-v2.6-flash" });
  assertEquals(parseDefaultModel(IMPORTED), { provider: "deepseek-official", model: "deepseek-flash" });
  assertEquals(parseDefaultModel("nothing: here"), null);
});

Deno.test("密钥查找：写明的优先；deepseek-official 这种命名要退回去找 DEEPSEEK_API_KEY", () => {
  const creds = parseCredRefs(CREDS);
  assertEquals(resolveKeyRef("zai", "ZAI_API_KEY", creds).key, "ebcd1234.hxkp");
  assertEquals(resolveKeyRef("deepseek-official", "", creds), { env: "DEEPSEEK_API_KEY", key: "sk-deepseek-key" });
  assertEquals(resolveKeyRef("unknown", "", creds).key, "", "找不到就是空，别拿别的通道的密钥顶上");
});

Deno.test("通道合并：当前 profile 说了算，缺的字段由后面的来源补", () => {
  const srcs: ChannelSource[] = [
    { path: "active/cordis.patch.yml", text: "providers:\n  xiaomi:\n    apiKeyEnv: XIAOMI_API_KEY\n" },
    { path: "other/cordis.patch.yml", text: "providers:\n  xiaomi:\n    baseURL: https://api.xiaomimimo.com/v1\n    models:\n      - id: mimo-v2.6-flash\n" },
  ];
  const ch = buildChannels(srcs, { XIAOMI_API_KEY: "sk-x" });
  assertEquals(ch.length, 1);
  assertEquals(ch[0]!.baseUrl, "https://api.xiaomimimo.com/v1", "地址由后面的来源补上");
  assertEquals(ch[0]!.apiKeyEnv, "XIAOMI_API_KEY");
  assertEquals(ch[0]!.model, "mimo-v2.6-flash");
});

Deno.test("通道合并：只有密钥引用、DSH 里没声明的通道也能用（地址走内置默认值）", () => {
  const ch = buildChannels([], { DEEPSEEK_API_KEY: "sk-d" });
  assertEquals(ch.map((c) => c.key), ["deepseek"]);
  assertEquals(ch[0]!.baseUrl, "https://api.deepseek.com");
  assertEquals(ch[0]!.baseUrlFromDefaults, true, "界面要能提示这是内置默认地址");
  assertEquals(ch[0]!.model, "deepseek-chat");
  assertEquals(ch[0]!.apiKey.length > 0, true);
});

Deno.test("通道合并：地址说不准的通道不列（宁可让用户自己填）", () => {
  const srcs: ChannelSource[] = [{ path: "x.yml", text: "providers:\n  mystery:\n    apiKeyEnv: MYSTERY_API_KEY\n" }];
  assertEquals(buildChannels(srcs, { MYSTERY_API_KEY: "sk-m" }), []);
});

Deno.test("通道合并：默认通道排最前，其次是有密钥的", () => {
  const srcs: ChannelSource[] = [{ path: "x.yml", text: PATCH }];
  const ch = buildChannels(srcs, parseCredRefs(CREDS));
  assertEquals(ch[0]!.key, "xiaomi", "DSH 当前默认通道排第一");
  assertEquals(ch[0]!.isDefault, true);
  assertEquals(ch[0]!.apiKey, "", "这台的凭据里没有 XIAOMI_API_KEY");
  const zai = ch.find((c) => c.key === "zai");
  assertEquals(zai?.apiKey, "ebcd1234.hxkp");
});

Deno.test("安全：送到界面的形状里没有 apiKey，只有掩码", () => {
  const ch = buildChannels([{ path: "x.yml", text: PATCH }], parseCredRefs(CREDS));
  const pub = publicChannel(ch.find((c) => c.key === "zai")!);
  assertEquals("apiKey" in pub, false, "真密钥绝不能出现在给界面的对象里");
  assertEquals(pub.hasKey, true);
  assertEquals(pub.keyMasked, "ebcd••••hxkp");
  assertEquals(JSON.stringify(pub).includes("ebcd1234.hxkp"), false, "整个对象序列化后也不许有明文");
});
