/**
 * 安装源切换的纯逻辑测试（P1-4）。
 *
 * 这里最该钉住的是两件事：① 地址校验（它会进命令行，脏字符必须挡住）；
 * ② .npmrc 改写（用户文件里可能有按包覆盖源这类宝贵配置，只能动 registry 一行）。
 */
import { assertEquals } from "@std/assert";
import { isSafeRegistryUrl, pickFastest, upsertRegistryLine, type SourceProbe } from "./sources.ts";

Deno.test("安装源：地址校验", () => {
  assertEquals(isSafeRegistryUrl("https://registry.npmmirror.com"), true);
  assertEquals(isSafeRegistryUrl("http://127.0.0.1:4873/"), true);
  assertEquals(isSafeRegistryUrl("registry.npmmirror.com"), false, "缺协议头必须拒绝");
  assertEquals(isSafeRegistryUrl("https://a b.com"), false, "空白必须拒绝");
  assertEquals(isSafeRegistryUrl("https://x.com/\"y"), false, "引号必须拒绝");
  assertEquals(isSafeRegistryUrl("file:///tmp/x"), false);
  assertEquals(isSafeRegistryUrl(""), false);
  assertEquals(isSafeRegistryUrl("https://" + "a".repeat(400) + ".com"), false, "过长拒绝");
});

Deno.test("安装源：.npmrc 只动 registry 一行，其它原样保留", () => {
  const existing = [
    "# 注释：某个包镜像没同步，单独直连",
    "dsh-sidenote:registry=https://registry.npmjs.org/",
    "registry=https://old.example.com",
    "registry=https://dup.example.com",
    "fund=false",
  ].join("\n");
  const next = upsertRegistryLine(existing, "https://registry.npmmirror.com");
  const lines = next.trim().split("\n");
  assertEquals(lines.includes("# 注释：某个包镜像没同步，单独直连"), true, "注释要留着");
  assertEquals(lines.includes("dsh-sidenote:registry=https://registry.npmjs.org/"), true, "按包覆盖源要留着");
  assertEquals(lines.includes("registry=https://registry.npmmirror.com"), true);
  assertEquals(lines.includes("registry=https://old.example.com"), false, "旧 registry 行要被替换");
  assertEquals(lines.includes("registry=https://dup.example.com"), false, "重复的 registry 行要清掉");
  assertEquals(lines.includes("fund=false"), true);
  assertEquals(lines.filter((l) => l.startsWith("registry=")).length, 1);
  // 原本没有 registry 行时追加一行
  const added = upsertRegistryLine("fund=false\n", "https://registry.npmjs.org");
  assertEquals(added.includes("registry=https://registry.npmjs.org"), true);
  assertEquals(upsertRegistryLine("", "https://x.com"), "registry=https://x.com\n");
});

Deno.test("安装源：挑最快只认成功的、平的", () => {
  const mk = (label: string, ok: boolean, ms: number | null): SourceProbe => ({ label, url: "https://" + label, ok, ms, status: ok ? 200 : null });
  assertEquals(pickFastest([]), null);
  assertEquals(pickFastest([mk("a", false, 10), mk("b", false, 20)]), null, "全失败时不给建议");
  const best = pickFastest([mk("slow", true, 900), mk("fast", true, 120), mk("dead", false, 5)]);
  assertEquals(best!.label, "fast");
});
