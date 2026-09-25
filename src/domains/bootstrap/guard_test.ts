/** bootstrap 的地址与目录约束测试。【安全 SEC-03 / SEC-04】 */
import { assertEquals } from "@std/assert";
import { badRootReason, isSafeRepoUrl, looksLikeDshSource } from "./apply.ts";

Deno.test("仓库地址白名单：只放行正常写法", () => {
  for (const u of ["https://github.com/deepseek-ai/deepseek-harness", "ssh://git@host/x.git", "git@github.com:a/b.git"]) {
    assertEquals(isSafeRepoUrl(u), true, `应放行 ${u}`);
  }
  for (const u of ["--upload-pack=calc.exe", "-c core.pager=calc", "file:///C:/x", "ftp://host/x", "https://a b"]) {
    assertEquals(isSafeRepoUrl(u), false, `应拒绝 ${u}`);
  }
});

Deno.test("安装目录约束：挡住 UNC、盘根、系统目录与选项形状", () => {
  assertEquals(badRootReason("\\\\server\\share\\dsh") !== null, true);
  assertEquals(badRootReason("C:\\") !== null, true);
  assertEquals(badRootReason("C:\\Windows") !== null, true);
  assertEquals(badRootReason("C:\\Users") !== null, true);
  assertEquals(badRootReason("relative\\path") !== null, true);
  assertEquals(badRootReason("--upload-pack=x") !== null, true);
  assertEquals(badRootReason("") !== null, true);
  // 正常用法必须放行：装到 D:\\ 或用户目录下都是常见做法
  assertEquals(badRootReason("D:\\DeepSeek_Harness"), null);
  assertEquals(badRootReason("G:\\DeepSeek_Harness"), null);
  assertEquals(badRootReason("C:\\Users\\niufe\\DeepSeek_Harness"), null);
});

Deno.test("强制重装的准入门槛：必须是 DSH 源码目录", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "butler-guard-" });
  try {
    const plain = `${tmp}\\just-a-repo`;
    await Deno.mkdir(plain, { recursive: true });
    assertEquals(looksLikeDshSource(plain), false, "普通仓库不该被当成 DSH 源码");

    const dsh = `${tmp}\\actual-dsh`;
    await Deno.mkdir(`${dsh}\\apps\\cli`, { recursive: true });
    assertEquals(looksLikeDshSource(dsh), true, "含 apps/cli 才算 DSH 源码");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
