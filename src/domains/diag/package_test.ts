/**
 * 诊断包的脱敏与自检测试（P2-2）。
 *
 * 这是「发出去的东西」的最后一道闸：脱敏漏一个就是隐私泄露，自检失灵就是白设。
 * 所以这里既测「替换对不对」，也测「自检抓不抓得住漏网的」。
 */
import { assertEquals } from "@std/assert";
import { diagnoseDirName, isDiagnoseDir, redactDeep, scanForLeaks, writeDiagnosePackage, type RedactionContext } from "./package.ts";

const ctx: RedactionContext = { home: "C:\\Users\\tester", user: "tester" };

Deno.test("脱敏：家目录 / 用户名 / 令牌 / 邮箱", () => {
  const raw = [
    "路径：C:\\Users\\tester\\.dsh\\profiles\\web\\package.json",
    "正斜杠也来一遍：C:/Users/tester/.dsh",
    "用户名出现在别处：tester 的机器",
    "key sk-abcdefghijklmnop",
    "github ghp_abcdefghijklmnopqrstuvwxyz01",
    "header: Bearer abcdefghijklmnop",
    "email: someone@example.com",
    "token=supersecretvalue",
  ].join("\n");
  const out = redactDeep(raw, ctx);
  assertEquals(out.includes("tester"), false, "用户名不许残留");
  assertEquals(out.includes("C:\\Users"), false, "家目录不许残留");
  assertEquals(out.includes("C:/Users"), false, "正斜杠写法也不许残留");
  assertEquals(out.includes("sk-abcdefghijklmnop"), false);
  assertEquals(out.includes("ghp_abcdefghijklmnopqrstuvwxyz01"), false);
  assertEquals(out.includes("Bearer abcdefghijklmnop"), false);
  assertEquals(out.includes("someone@example.com"), false, "邮箱不许残留");
  assertEquals(out.includes("supersecretvalue"), false, "token= 的值不许残留");
  assertEquals(out.includes("~"), true, "家目录应被替换成 ~");
});

Deno.test("自检：干净的文本不报，漏网的必须报出来", () => {
  assertEquals(scanForLeaks("a.txt", "一切正常：路径 ~、用户 %USER%、令牌 ***", ctx), []);
  const hitHome = scanForLeaks("b.txt", "路径 C:\\Users\\tester\\x", ctx);
  assertEquals(hitHome.length >= 1, true, "残留家目录必须报");
  assertEquals(hitHome[0]!.kind.includes("家目录"), true);
  const hitUser = scanForLeaks("c.txt", "这台机器叫 tester", ctx);
  assertEquals(hitUser.some((h) => h.kind.includes("用户名")), true);
  const hitToken = scanForLeaks("d.txt", "sk-abcdefghijklmnop", ctx);
  assertEquals(hitToken.some((h) => h.kind.includes("密钥")), true);
  const hitMail = scanForLeaks("e.txt", "a@b.com", ctx);
  assertEquals(hitMail.some((h) => h.kind.includes("邮箱")), true);
});

Deno.test("诊断包：写出 → 回读自检通过；漏网时能报出来", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "butler-diag-" });
  try {
    const files = [
      { name: "体检报告.md", content: "# 报告\n生成于 C:\\Users\\tester\\.dsh\n无明显异常" },
      { name: "机器概要.json", content: JSON.stringify({ profileDir: "C:/Users/tester/.dsh/profiles/web" }) },
    ];
    const res = writeDiagnosePackage(files, tmp, ctx);
    assertEquals(res.leaks, [], `不该有残留，实际：${JSON.stringify(res.leaks)}`);
    assertEquals(isDiagnoseDir(res.dir), true, "应被识别为管家诊断包");
    const report = Deno.readTextFileSync(res.dir + "/体检报告.md");
    assertEquals(report.includes("tester"), false, "落盘内容必须已脱敏");
    assertEquals(report.includes("~"), true);
    assertEquals(diagnoseDirName(tmp, "X").endsWith("诊断包-X"), true);

    // 自检失灵测试：绕过脱敏直接写一个漏网文件，扫描必须报出来
    const bad = writeDiagnosePackage([{ name: "x.txt", content: "C:\\Users\\tester" }], tmp, { home: "", user: "" });
    assertEquals(bad.leaks.length, 0, "没给上下文时无从判断（这是预期：上下文缺失=不替换）");
    const scanned = scanForLeaks("x.txt", "C:\\Users\\tester", ctx);
    assertEquals(scanned.length >= 1, true, "给上上下文就必须报出来");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
