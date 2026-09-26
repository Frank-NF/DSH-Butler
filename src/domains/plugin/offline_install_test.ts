/**
 * 离线安装的判据测试（P1-4）。
 *
 * 路径会被拼进 npm 命令行（cmd.exe 会二次解析），所以白名单必须严：
 * 只认 .tgz、挡掉 & | < > % ^ 引号与换行（SEC-02 的教训：left-pad@1.0.0&whoami 真的执行了）。
 */
import { assertEquals } from "@std/assert";
import { collectTgz, isSafeTgzPath } from "./offline_install.ts";

Deno.test("离线安装：路径白名单", () => {
  assertEquals(isSafeTgzPath("C:\\Users\\a\\Downloads\\dsh-x-1.0.0.tgz"), true);
  assertEquals(isSafeTgzPath("/tmp/x.tgz"), true);
  assertEquals(isSafeTgzPath("C:\\x\\dsh-y-1.0.0.tgz&whoami"), false, "& 必须拒绝");
  assertEquals(isSafeTgzPath("C:\\x\\a|b.tgz"), false);
  assertEquals(isSafeTgzPath('C:\\x\\a"b.tgz'), false);
  assertEquals(isSafeTgzPath("C:\\x\\a.tgz\nb"), false, "换行必须拒绝");
  assertEquals(isSafeTgzPath("C:\\x\\a.zip"), false, "只认 .tgz");
  assertEquals(isSafeTgzPath("C:\\x\\a.tar.gz"), false);
  assertEquals(isSafeTgzPath(""), false);
});

Deno.test("离线安装：从文件或目录收集 .tgz", async () => {
  const dir = await Deno.makeTempDir({ prefix: "butler-offline-" });
  try {
    await Deno.writeTextFile(dir + "/b-1.0.0.tgz", "x");
    await Deno.writeTextFile(dir + "/a-2.0.0.tgz", "x");
    await Deno.writeTextFile(dir + "/notes.txt", "x");
    await Deno.writeTextFile(dir + "/evil.tgz&whoami", "x");
    const fromDir = collectTgz(dir);
    assertEquals(fromDir.error, undefined);
    assertEquals(fromDir.files.map((f) => f.split(/[\\\\/]/).pop()), ["a-2.0.0.tgz", "b-1.0.0.tgz"], "按名排序、只收 .tgz、挡掉带 & 的");
    const oneFile = collectTgz(dir + "/a-2.0.0.tgz");
    assertEquals(oneFile.files.length, 1);
    assertEquals(collectTgz(dir + "/notes.txt").error !== undefined, true, "非 .tgz 必须报错");
    assertEquals(collectTgz(dir + "/nope.tgz").error !== undefined, true, "不存在的文件必须报错");
    assertEquals(collectTgz("").error !== undefined, true);
    await Deno.mkdir(dir + "/empty");
    assertEquals(collectTgz(dir + "/empty").error !== undefined, true, "空目录必须报错而不是假装能装");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
