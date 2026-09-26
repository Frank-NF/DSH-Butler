/**
 * 配置与状态（只写管家自己的目录，绝不碰 DSH）。
 *
 * 迁移原则：对旧配置【只读】—— 旧文件原地保留，新配置写在新目录。
 * 迁移失败时删掉新目录即可回到迁移前，用户数据零风险。
 */

import type { LogLevel } from "../../util/log.ts";
import { log } from "../../util/log.ts";
import {
  butlerConfigPath,
  dshProfileDir,
  legacyConfigPath,
  stampOf,
} from "../../util/paths.ts";
import { pathExists, readJson, writeJsonAtomic } from "../../host/fs.ts";
import { DSH_PORT_DEFAULT } from "../../version.ts";

export const CONFIG_SCHEMA_VERSION = 1;

/**
 * 定时任务配置。
 * everyHours = 0 表示不做这件事；enabled = false 则全部停。
 */
export interface ScheduleConfig {
  enabled: boolean;
  /** 每隔多少小时体检一次。 */
  healthEveryHours: number;
  /** 每隔多少小时备份一次。 */
  backupEveryHours: number;
  /** 每隔多少小时查一次插件更新。 */
  checkUpdatesEveryHours: number;
  /** 发现错误级问题、可更新插件等，是否提示。 */
  notify: boolean;
}

export interface AppConfig {
  schemaVersion: number;
  /** 手动指定的 DSH 源码目录（覆盖自动探测）。 */
  dshSourceRootOverride: string | null;
  /** 手动指定的 profile 目录。 */
  dshProfileDir: string | null;
  /** DSH 服务端口。 */
  dshPort: number;
  /** 下载镜像（留空 = 只用官方源）。 */
  mirrorUrl: string;
  /** 网络代理（留空 = 直连）。 */
  proxyUrl: string;
  /** npm 安装源。 */
  npmRegistry: string;
  autoCheckUpdates: boolean;
  backupBeforeUpdate: boolean;
  telemetryEnabled: boolean;
  logLevel: LogLevel;
  theme: "light" | "dark" | "auto";
  /** 备份保留策略。 */
  retention: { maxBackups: number; maxBackupBytes: number };
  /** 定时任务（体检 / 备份 / 查更新）。 */
  schedule: ScheduleConfig;
  /**
   * 与官方桌面端共存的模式：
   *   auto —— 检测到官方桌面端在跑就自动退成「运维模式」（不抢窗口与托盘）
   *   full —— 永远完整模式（检测误判时用这个一句话关掉）
   */
  coexistMode: "auto" | "full";
  /** 实例标识（沿用旧版，保持统计连续性）。 */
  installId: string | null;
  /** 首次部署引导是否已完成。 */
  onboardingDone: boolean;
  /** 点窗口关闭按钮时：true = 收进托盘继续跑，false = 真退出。 */
  closeToTray: boolean;
  /** 是否在 DSH 页面右下角注入管家悬浮条。 */
  dockEnabled: boolean;
  /** 悬浮条展开后多久没动作就自动收起（毫秒）。 */
  dockIdleMs: number;
  /** 市场目录缓存多久（毫秒）。 */
  marketCatalogTtlMs: number;
  /** 是否自动检查本体（DSH）有没有新版本。 */
  autoCheckCoreUpdate: boolean;
  /** 是否自动检查管家自己有没有新版本。 */
  autoCheckButlerUpdate: boolean;
  /** 开机自动启动管家（写用户级 Run 注册表项）。 */
  autostart: boolean;
  /** 迁移痕迹。 */
  migratedFrom: string | null;
  migratedAt: string | null;
}

function defaults(): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    dshSourceRootOverride: null,
    dshProfileDir: null,
    dshPort: DSH_PORT_DEFAULT,
    mirrorUrl: "",
    proxyUrl: "",
    npmRegistry: "https://registry.npmmirror.com",
    autoCheckUpdates: true,
    backupBeforeUpdate: true,
    telemetryEnabled: false,
    logLevel: "info",
    theme: "light",
    retention: { maxBackups: 10, maxBackupBytes: 2 * 1024 ** 3 },
    coexistMode: "auto",
    schedule: {
      enabled: true,
      healthEveryHours: 12,
      backupEveryHours: 24,
      checkUpdatesEveryHours: 6,
      notify: true,
    },
    installId: null,
    onboardingDone: false,
    closeToTray: true,
    dockEnabled: true,
    dockIdleMs: 3000,
    marketCatalogTtlMs: 6 * 60 * 60 * 1000,
    autoCheckCoreUpdate: true,
    autoCheckButlerUpdate: true,
    autostart: false,
    migratedFrom: null,
    migratedAt: null,
  };
}

/** 旧版配置（DSH插件管家 1.18.x）的结构，只用于读取。 */
interface LegacyConfig {
  proxy_base_url?: string;
  plugin_directory?: string;
  auto_check_updates?: boolean;
  backup_before_update?: boolean;
  install_registry?: string;
  install_id?: string;
  telemetry_enabled?: boolean;
  dsh_mirror_url?: string;
  /** 服务器同步相关字段：本次改版【有意淘汰】，不迁移。 */
  server_host?: string;
  server_port?: number;
  server_user?: string;
  server_key?: string;
  server_remote_dir?: string;
  server_dsh_dir?: string;
  server_update_cmd?: string;
}

let cached: AppConfig | null = null;

/** 载入配置；不存在时返回默认值并落盘。 */
export function loadConfig(): AppConfig {
  if (cached) return cached;

  const cfgPath = butlerConfigPath();
  const existing = readJson<AppConfig>(cfgPath);
  // 【2026-09-25 审计 Q-14】文件在、却读不出来 = 损坏。
  // 旧实现把它当「首次运行」，直接用 defaults() 覆盖写回 —— 用户设置静默清零、
  // 无备份、无日志、事后无法追查。现在改成「留证 + 记错误日志」再回退默认值。
  if (!existing && pathExists(cfgPath)) {
    const backup = `${cfgPath}.corrupt-${stampOf()}`;
    try {
      Deno.renameSync(cfgPath, backup);
      log.error("config", `配置文件解析失败，原文件已保留为 ${backup}，本次先按默认值运行`);
    } catch (e) {
      log.error(
        "config",
        `配置文件解析失败，且备份也失败（${(e as Error).message}）：${cfgPath}`,
      );
    }
  }
  if (existing) {
    // 嵌套对象必须逐字段补默认值：浅合并时，老配置里少一个字段就会变成 undefined，
    // 后面用到它的地方（比如保留策略、定时任务）会静默算错。
    const d = defaults();
    const merged = {
      ...d,
      ...existing,
      retention: { ...d.retention, ...(existing.retention ?? {}) },
      schedule: { ...d.schedule, ...(existing.schedule ?? {}) },
    };
    // schema 升级链
    if ((existing.schemaVersion ?? 0) < CONFIG_SCHEMA_VERSION) {
      merged.schemaVersion = CONFIG_SCHEMA_VERSION;
      saveConfig(merged);
      log.info(
        "config",
        `配置已从 schema v${existing.schemaVersion} 升级到 v${CONFIG_SCHEMA_VERSION}`,
      );
    }
    cached = merged;
    return cached;
  }

  // 首次运行：尝试从旧版迁移
  const migrated = migrateFromLegacy();
  cached = migrated ?? defaults();
  saveConfig(cached);
  return cached;
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const current = cached ?? defaults();
  const next: AppConfig = { ...current, ...patch, schemaVersion: CONFIG_SCHEMA_VERSION };
  writeJsonAtomic(butlerConfigPath(), next);
  cached = next;
  return next;
}

/** 手动指定 DSH 源码目录。 */
export function setDshSourceRoot(path: string | null): AppConfig {
  return saveConfig({ dshSourceRootOverride: path });
}

/** 生效的 profile 目录（配置优先，其次默认）。 */
export function effectiveProfileDir(config: AppConfig): string {
  return config.dshProfileDir ?? dshProfileDir();
}

/**
 * 从旧版配置迁移。
 * 返回 null 表示没有可迁移的旧配置。
 */
export function migrateFromLegacy(): AppConfig | null {
  const oldPath = legacyConfigPath();
  const legacy = readJson<LegacyConfig>(oldPath);
  if (!legacy) return null;

  const base = defaults();
  const next: AppConfig = {
    ...base,
    // 有值才覆盖，空字符串保持默认（旧版有意把服务器相关默认清空）
    proxyUrl: legacy.proxy_base_url?.trim() || base.proxyUrl,
    mirrorUrl: legacy.dsh_mirror_url?.trim() || base.mirrorUrl,
    npmRegistry: legacy.install_registry?.trim() || base.npmRegistry,
    autoCheckUpdates: legacy.auto_check_updates ?? base.autoCheckUpdates,
    backupBeforeUpdate: legacy.backup_before_update ?? base.backupBeforeUpdate,
    telemetryEnabled: legacy.telemetry_enabled ?? base.telemetryEnabled,
    dshProfileDir: legacy.plugin_directory?.trim() || base.dshProfileDir,
    installId: legacy.install_id ?? null,
    onboardingDone: false,
    migratedFrom: oldPath,
    migratedAt: new Date().toISOString(),
  };

  const dropped: string[] = [];
  for (
    const k of [
      "server_host",
      "server_port",
      "server_user",
      "server_key",
      "server_remote_dir",
      "server_dsh_dir",
      "server_update_cmd",
    ] as const
  ) {
    if (legacy[k]) dropped.push(k);
  }

  log.info(
    "config",
    `已从旧版配置迁移（来源：${oldPath}）` +
      (dropped.length > 0 ? `；有意丢弃 ${dropped.length} 个服务器同步字段` : ""),
  );

  return next;
}

/** 供界面展示的配置摘要（不含敏感项）。 */
export function configSummary(config: AppConfig): Record<string, unknown> {
  return {
    schemaVersion: config.schemaVersion,
    dshSourceRootOverride: config.dshSourceRootOverride,
    dshProfileDir: config.dshProfileDir,
    dshPort: config.dshPort,
    mirrorUrl: config.mirrorUrl ? "(已设置)" : "(空)",
    proxyUrl: config.proxyUrl ? "(已设置)" : "(空)",
    npmRegistry: config.npmRegistry,
    autoCheckUpdates: config.autoCheckUpdates,
    backupBeforeUpdate: config.backupBeforeUpdate,
    theme: config.theme,
    logLevel: config.logLevel,
    onboardingDone: config.onboardingDone,
    migratedFrom: config.migratedFrom,
    migratedAt: config.migratedAt,
  };
}
