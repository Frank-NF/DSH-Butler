/**
 * 搬家包：打包 → 检查 → 还原 的往返测试（P1-2）。
 *
 * 全部在临时目录里做，绝不碰真实的 ~/.dsh 与 ~/.dsh-butler。
 * 重点覆盖两件事：① 相对位置能不能原样落位；② 恶意/越界路径必须被拦住。
 */
import { assertEquals } from "@std/assert";
import { measureEntries, selectEntries, sizeText } from "./manifest.ts";
import {
  exportPackage,
  inspectPackage,
  isSafeRel,
  listBackups,
  resolveTarget,
  restorePackage,
  splitRel,
  underRoot,
} from "./pack.ts";

async function makeHome(root: string): Promise<void> {
  await Deno.mkdir(root + "/.dsh/profiles/web", { recursive: true });
  await Deno.mkdir(root + "/.dsh/skills/skill-a", { recursive: true });
  await Deno.writeTextFile(root + "/.dsh/config.json", '{"mcpServers":{}}');
  await Deno.writeTextFile(root + "/.dsh/profiles/web/package.json", '{"dependencies":{"a":"1.0.0"}}');
  await Deno.writeTextFile(root + "/.dsh/skills/skill-a/SKILL.md", "# skill A");
}

Deno.test("搬家包：路径拆解与安全判据", () => {
  const home = "C:/Users/u";
  const butler = "C:/Users/u/.dsh-butler";
  assertEquals(splitRel("C:\\Users\\u\\.dsh\\config.json", home, butler), { relTo: "home", rel: ".dsh/config.json" });
  assertEquals(splitRel("C:\\Users\\u\\.dsh-butler\\config.json", home, butler), { relTo: "butler", rel: "config.json" });
  assertEquals(splitRel("C:\\Windows\\System32\\evil.dll", home, butler), null, "两个根之外的路径必须拒绝打包");
  assertEquals(underRoot("C:\\Users\\u\\.dsh\\a", home), true);
  assertEquals(underRoot("C:\\Users\\uu\\.dsh\\a", home), false, "前缀相似但不同目录，不许算在内");
  assertEquals(isSafeRel(".dsh/config.json"), true);
  assertEquals(isSafeRel("../../Windows/System32/evil.dll"), false, ".. 必须拒绝");
  assertEquals(isSafeRel("C:/Windows/evil.dll"), false, "盘符必须拒绝");
  assertEquals(isSafeRel("/etc/passwd"), false);
  assertEquals(resolveTarget({ relTo: "home", rel: "../../x" }, home, butler), null);
  // 期望值统一分隔符再比：真正使用时 home 来自 homeDir()，本身就是本机分隔符
  const norm = (s: string | null) => (s ?? "").replace(/\//g, "\\");
  assertEquals(norm(resolveTarget({ relTo: "home", rel: ".dsh/config.json" }, home, butler)), "C:\\Users\\u\\.dsh\\config.json");
});

Deno.test("搬家包：空集合与体积说法", () => {
  const ents = [
    { label: "配置", path: "不存在的路径-x", subset: "config" as const, kind: "file" as const },
    { label: "技能", path: "不存在的路径-y", subset: "skills" as const, kind: "dir" as const },
  ];
  assertEquals(selectEntries(ents, "config"), [], "路径不存在就不选（不假装能打包）");
  assertEquals(measureEntries([], 10), []);
  const twoMb = [{ label: "a", path: "p", subset: "config" as const, kind: "dir" as const, bytes: 2 * 1024 * 1024, complete: true }];
  assertEquals(sizeText(twoMb), "约 2.0 MB");
  const partial = [{ label: "a", path: "p", subset: "config" as const, kind: "dir" as const, bytes: 20 * 1024 * 1024, complete: false }];
  assertEquals(sizeText(partial), "至少 20 MB");
});

Deno.test("搬家包：打包 → 检查 → 还原（往返）", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "butler-pack-" });
  try {
    const srcHome = tmp + "/srchome";
    const dstHome = tmp + "/dsthome";
    const srcButler = srcHome + "/.dsh-butler";
    await makeHome(srcHome);
    await Deno.mkdir(srcButler, { recursive: true });
    await Deno.writeTextFile(srcButler + "/config.json", '{"npmRegistry":"https://registry.npmmirror.com"}');

    const out = exportPackage({ preset: "config", destDir: tmp + "/packs", stamp: "TEST", home: srcHome, butlerRootDir: srcButler });
    assertEquals(out.failed, [], "不该有失败项");
    assertEquals(out.manifest.items.length > 0, true, "至少要打包到配置类条目");
    const labels = out.manifest.items.map((i) => i.label);
    assertEquals(labels.includes("DSH 技能（~/.dsh/skills）"), false, "config 预设不带技能");
    assertEquals(Deno.statSync(out.dir + "/MANIFEST.json").size > 0, true);
    assertEquals(Deno.statSync(out.dir + "/读我.txt").size > 0, true, "包里要有给人看的说明");

    // 目标机器：同样的结构，但内容改过（模拟「新机器上已有旧配置」）
    await makeHome(dstHome);
    await Deno.writeTextFile(dstHome + "/.dsh/config.json", '{"mcpServers":{"old":1}}');

    const insp = inspectPackage(out.dir, dstHome, dstHome + "/.dsh-butler");
    assertEquals("error" in insp, false, "检查不该失败");
    if ("error" in insp) return;
    assertEquals(insp.summary.total, out.manifest.items.length);
    assertEquals(insp.summary.blocked, 0);
    assertEquals(insp.summary.overwrites >= 2, true, "DSH 主配置与插件清单都该是「会覆盖」");

    const dry = restorePackage(out.dir, { home: dstHome, butlerRootDir: dstHome + "/.dsh-butler", dryRun: true });
    assertEquals("error" in dry, false);
    if ("error" in dry) return;
    assertEquals(dry.restored, insp.items.length, "dryRun 只算不做");
    assertEquals(Deno.readTextFileSync(dstHome + "/.dsh/config.json").includes("old"), true, "dryRun 不许真的改动");

    const real = restorePackage(out.dir, { home: dstHome, butlerRootDir: dstHome + "/.dsh-butler" });
    assertEquals("error" in real, false);
    if ("error" in real) return;
    assertEquals(real.failed, []);
    const cfg = Deno.readTextFileSync(dstHome + "/.dsh/config.json");
    assertEquals(cfg.includes("mcpServers"), true);
    assertEquals(cfg.includes("old"), false, "恢复应覆盖成包里的版本");
    assertEquals(Deno.readTextFileSync(dstHome + "/.dsh/profiles/web/package.json").includes("dependencies"), true);

    const list = listBackups(tmp + "/packs");
    assertEquals(list.length, 1);
    assertEquals(list[0]!.stamp, "TEST");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("搬家包：清单里的越界路径会被拦住", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "butler-pack-evil-" });
  try {
    const dir = tmp + "/pack";
    await Deno.mkdir(dir + "/data/home/sub", { recursive: true });
    await Deno.writeTextFile(dir + "/data/home/sub/ok.txt", "x");
    const manifest = {
      schemaVersion: 1,
      kind: "dsh-butler-migration",
      createdAt: new Date().toISOString(),
      appVersion: "t",
      preset: "config",
      hostname: "h",
      items: [
        { label: "越界", relTo: "home", rel: "../../evil.txt", source: "", kind: "file", bytes: 1 },
        { label: "正常", relTo: "home", rel: "sub/ok.txt", source: "", kind: "file", bytes: 1 },
      ],
      fileCount: 2,
      bytes: 2,
      skipped: [],
    };
    await Deno.writeTextFile(dir + "/MANIFEST.json", JSON.stringify(manifest));

    const insp = inspectPackage(dir, tmp, tmp + "/butler");
    assertEquals("error" in insp, false);
    if ("error" in insp) return;
    assertEquals(insp.blocked.length, 1, "越界那条必须被拦");
    assertEquals(insp.blocked[0]!.label, "越界");
    assertEquals(insp.items.length, 1);

    const res = restorePackage(dir, { home: tmp, butlerRootDir: tmp + "/butler" });
    assertEquals("error" in res, false);
    if ("error" in res) return;
    assertEquals(res.failed, []);
    assertEquals(Deno.statSync(tmp + "/sub/ok.txt").size, 1, "安全的那条要真的落位");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
