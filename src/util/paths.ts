/**
 * 路径解析与探测。
 *
 * 设计要点：
 * 1) 全部路径集中在此，别处不许拼字符串。
 * 2) DSH 源码树探测沿用旧版管家已验证的顺序（环境变量 > 缓存 > 候选 > 盘符扫描）。
 * 3) 隔离区必须与 DSH 本体【同盘同级】—— 跨盘 rename 在 Windows 上必失败
 *    （winerror=17），而 Node/Deno 的 rename 会自动降级成功，
 *    所以【绝不能用 Node 原型验证跨盘行为】。见 quarantineRootFor()。
 */

import { DSH_CLI_SUBDIR, DSH_PROFILE_DEFAULT } from "../version.ts";

export const isWindows = Deno.build.os === "windows";
const SEP = isWindows ? "\\" : "/";

/** 拼路径（统一分隔符，不依赖第三方库）。 */
export function p(...parts: string[]): string {
  const cleaned = parts
    .filter((s) => s !== "" && s != null)
    .map((s, i) => {
      let t = s;
      if (i > 0) t = t.replace(/^[/\\]+/, "");
      if (i < parts.length - 1) t = t.replace(/[/\\]+$/, "");
      return t;
    });
  return cleaned.join(SEP);
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i < 0) return ".";
  if (i === 0) return path.slice(0, 1);
  // 保留盘符根 c:\
  if (i === 2 && /^[A-Za-z]:/.test(path)) return path.slice(0, 3);
  return path.slice(0, i);
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? path : path.slice(i + 1);
}

/** 归一化：统一分隔符、去掉多余的 . 与尾部斜杠（不做完整解析，够用即可）。 */
export function normalize(path: string): string {
  const win = path.replace(/\//g, "\\");
  // UNC（\\server\share…）要保留前缀；盘符（C:）单独取出 —— 若直接拼回去，
  // 盘符与首段之间会丢掉分隔符（G:\X → G:X），后面所有基于路径的判断都会静默失效。
  const unc = win.startsWith("\\\\");
  const body0 = unc ? win.slice(2) : win;
  const drive = unc ? "" : (/^([A-Za-z]:)/.exec(body0)?.[1] ?? "");
  const rest = body0.slice(drive.length);

  const segs: string[] = [];
  for (const seg of rest.split("\\")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") segs.pop();
    else segs.push(seg);
  }
  const body = segs.join("\\");

  let joined: string;
  if (unc) joined = `\\\\${body}`;
  else if (drive) joined = `${drive}\\${body}`;
  else joined = (isWindows ? "" : "\\") + body;

  return isWindows ? joined : joined.replace(/\\/g, "/");
}

export function homeDir(): string {
  const h = Deno.env.get(isWindows ? "USERPROFILE" : "HOME") ??
    Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!h) throw new Error("无法确定用户主目录（USERPROFILE / HOME 均未设置）");
  return h.replace(/[/\\]+$/, "");
}

// ── 管家自己的目录 ────────────────────────────────────────────────

export function butlerRoot(): string {
  return p(homeDir(), ".dsh-butler");
}
export function butlerConfigPath(): string {
  return p(butlerRoot(), "config.json");
}
export function butlerLogsDir(): string {
  return p(butlerRoot(), "logs");
}
export function butlerJobsDir(): string {
  return p(butlerRoot(), "jobs");
}
export function butlerAuditDir(): string {
  return p(butlerRoot(), "audit");
}
export function butlerBackupsDir(): string {
  return p(butlerRoot(), "backups");
}
export function butlerReportDir(): string {
  return p(butlerRoot(), "report");
}
export function butlerLogFile(): string {
  return p(butlerLogsDir(), `butler-${new Date().toISOString().slice(0, 10)}.log`);
}

// ── DSH 相关目录 ─────────────────────────────────────────────────

export function dshRoot(): string {
  return p(homeDir(), ".dsh");
}
export function dshWebDirCacheFile(): string {
  return p(dshRoot(), "web-dir");
}
export function dshLogsDir(): string {
  return p(dshRoot(), "logs");
}
export function dshProfileDir(profile = DSH_PROFILE_DEFAULT): string {
  // 测试隔离的第 5 件套（与 DSH_WEB_DIR / BUTLER_ROLLBACK_DIR / BUTLER_SKIP_SERVICE_OPS /
  // BUTLER_TXN_DIR 并列）：插件写操作直接改真实 ~/.dsh/profiles/<profile> 的双名单，
  // 测试必须有整体覆盖的逃生口 —— 生产环境绝不设它。
  const override = Deno.env.get("BUTLER_PROFILE_DIR");
  if (override) return override;
  return p(dshRoot(), "profiles", profile);
}
export function dshSessionsDir(): string {
  return p(dshRoot(), "sessions");
}
/** 旧版管家的配置文件（迁移来源，只读）。 */
export function legacyConfigPath(): string {
  return p(dshRoot(), "plugin-updater-config.json");
}

export interface DshRootProbe {
  path: string;
  /** 发现方式，用于在界面上解释"为什么我认为 DSH 在这里"。 */
  source: "env" | "cache" | "home-candidate" | "drive-scan";
}

/**
 * 探测 DSH 源码树根目录。
 * 判据：该目录下存在 apps/cli（DSH_CLI_SUBDIR）。
 */
export function resolveDshSourceRoot(): DshRootProbe | null {
  const isRoot = (dir: string): boolean => {
    try {
      return Deno.statSync(p(dir, DSH_CLI_SUBDIR)).isDirectory;
    } catch {
      return false;
    }
  };

  // 1. 环境变量精确指定
  const envDir = Deno.env.get("DSH_WEB_DIR");
  if (envDir && isRoot(envDir)) return { path: normalize(envDir), source: "env" };

  // 2. 上次探测缓存（用户通过界面确认过的路径）
  try {
    const cached = Deno.readTextFileSync(dshWebDirCacheFile()).trim();
    if (cached && isRoot(cached)) return { path: normalize(cached), source: "cache" };
  } catch { /* 无缓存 */ }

  const home = homeDir();

  // 3. 常见位置
  const candidates = [
    p(home, "DeepSeek_Harness"),
    p(home, "Documents", "DeepSeek_Harness"),
    ...(isWindows ? ["G:\\DeepSeek_Harness", "D:\\DeepSeek_Harness", "E:\\DeepSeek_Harness"] : []),
  ];
  for (const c of candidates) {
    if (isRoot(c)) return { path: normalize(c), source: "home-candidate" };
  }

  // 4. Windows 盘符浅扫描（只扫一层，避免卡死）
  if (isWindows) {
    for (const drive of "CDEFG".split("")) {
      const c = `${drive}:\\DeepSeek_Harness`;
      if (isRoot(c)) return { path: normalize(c), source: "drive-scan" };
    }
  }
  return null;
}

/**
 * 把探测结果写入缓存，供下次启动秒开。
 *
 * 这是**管家自己的数据**（旧版 Tauri 版遗留的缓存位置，DSH 官方并不读它），
 * 不是对用户 DSH 环境的修改。但内容没变时绝不写盘 ——
 * 否则每次体检都刷新一次 mtime，既浪费 I/O 又会让「零副作用」检测全部失焦。
 */
export function rememberDshRoot(root: string): void {
  try {
    const file = dshWebDirCacheFile();
    const want = normalize(root);
    if (want.length === 0) return;
    try {
      if (Deno.readTextFileSync(file).trim() === want) return; // 内容一致，不碰磁盘
    } catch { /* 无旧缓存，继续写 */ }
    Deno.mkdirSync(dshRoot(), { recursive: true });
    Deno.writeTextFileSync(file, want);
  } catch { /* 缓存失败不致命 */ }
}

/** Windows 下取卷标识（盘符或 UNC 前缀），用于同盘断言。 */
export function volumeOf(path: string): string {
  const n = normalize(path);
  const m = /^([A-Za-z]):/.exec(n);
  if (m?.[1]) return m[1].toUpperCase() + ":";
  if (n.startsWith("\\\\")) return n.split("\\").slice(0, 4).join("\\").toUpperCase();
  return "/";
}

export function sameVolume(a: string, b: string): boolean {
  return volumeOf(a) === volumeOf(b);
}

/**
 * 隔离区根目录。
 *
 * 【铁律】必须与 DSH 本体同盘同级：放在本体父目录下的 dsh-quarantine。
 * 若跨盘，移动会整体失败并被静默跳过 —— 界面看不出异常，但构建照旧挂。
 */
export function quarantineRootFor(dshSourceRoot: string): string {
  return p(dirname(normalize(dshSourceRoot)), "dsh-quarantine");
}

/** 带时间戳的隔离区子目录。 */
export function quarantineStampDir(dshSourceRoot: string, stamp = stampOf()): string {
  return p(quarantineRootFor(dshSourceRoot), stamp);
}

/** 形如 20260924-115030 的时间戳，用于各类归档目录命名。 */
export function stampOf(d: Date = new Date()): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${
    z(d.getMinutes())
  }${z(d.getSeconds())}`;
}
