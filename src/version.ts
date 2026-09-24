/**
 * 全局常量。
 *
 * 铁律：APP_ID 绝不能改 —— 改了会挪数据目录、丢配置、断掉自更新链。
 * 该值与 src-tauri/tauri.conf.json 的 identifier 必须保持一致。
 */

/**
 * 软件产品名 —— 【必须纯 ASCII，不许出现中文】。
 *
 * 这个串会进到打包元数据、安装包、窗口标题、进程名，以及将来的自更新链路里。
 * 中文会在这里踩雷：旧项目用「DSH插件管家」时，WiX 因 en-US codepage 1252 写不进中文，
 * 直接报 LGHT0311，表层只显示 "failed to run light.exe"，极难定位。
 * 所以产品名一律英文；中文只出现在**面向用户的界面文案**里（那是 UTF-8 的 HTML，安全）。
 *
 * 项目对外的中文称呼是「DSH管家」，只用于沟通与文档，不进产物。
 */
export const APP_NAME = "DSH Butler";
/** 旧产品名，仅用于识别历史数据目录。 */
export const APP_NAME_LEGACY = "DSH插件管家";
export const APP_ID = "com.dsh.plugin-updater";
export const APP_VERSION = "2.0.0-alpha.1";

/** 配置 schema 版本。每次结构变更必须 +1 并补迁移函数。 */
export const CONFIG_SCHEMA_VERSION = 1;

/** DSH 服务端口：用户实际使用 3081；官方默认 3080；8787 为历史遗留（仅作兼容探测）。 */
export const DSH_PORT_DEFAULT = 3081;
export const DSH_PORT_CANDIDATES = [3081, 3080, 8787] as const;

/**
 * 管家自己的本地服务端口。
 * - 桌面态：不指定端口，由 deno desktop 运行时决定（webview 会打开那个地址）
 * - --headless：固定用这个端口，脚本/其它程序才找得到我们
 * 选 8731 是为了避开 DSH 自己用的 3080/3081/8787，以及官网上站的 8072/8073。
 */
export const BUTLER_PORT_HEADLESS = 8731;

/** DSH 源码树里 CLI 的相对子目录。 */
export const DSH_CLI_SUBDIR = "apps/cli";

/** 默认 profile 名。 */
export const DSH_PROFILE_DEFAULT = "web";

/** 各类超时（毫秒）。可按需在配置里覆盖。 */
export const TIMEOUTS = {
  probe: 10_000,
  net: 120_000,
  install: 900_000,
  build: 1_800_000,
  jobTotal: 3_600_000,
} as const;
