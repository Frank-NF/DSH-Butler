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

/** 品牌标语（官网、窗口标题、界面品牌位统一用它）。 */
export const APP_TAGLINE = "让 DSH 始终好用";

/** 窗口标题：产品名（纯 ASCII，进产物）+ 标语（只在界面显示）。 */
export const WINDOW_TITLE = `${APP_NAME} · ${APP_TAGLINE}`;

/** 旧产品名，仅用于识别历史数据目录。 */
export const APP_NAME_LEGACY = "DSH插件管家";
export const APP_ID = "com.dsh.plugin-updater";
export const APP_VERSION = "2.0.1";

/** 官网地址（界面「官网」入口与更新日志下载页共用）。 */
export const OFFICIAL_SITE = "https://dsh.huilinsh.cn";

/**
 * 阶段标识（方案 §10.2：S1 只读 / S2 诊断 / S3 写操作接管 / S4 一键部署 / S5 跨平台）。
 *
 * 【为什么必须只写一处】这三个字曾经被三处各写一份 —— 启动日志说 S3、总览接口说 S1、
 * 界面导航说「只读版本（S1）」，同一个程序自相矛盾。阶段只允许有这一个来源。
 */
export const STAGE = "S3";
export const STAGE_TITLE = "S3 写操作接管";

/**
 * 界面是否已经接管写操作。
 *
 * 这个开关就是「界面该说自己是什么」的唯一判据：翻成 true 时，导航提示与总览接口的文案
 * 自动跟着改，不会再出现「界面写着只读、日志写着 S3」这种分裂。
 *
 * 已翻 true（2026-09-24）：插件 / 本体 / 运行 / 回滚点四类共 11 个写动作全部接进界面，
 * 一律走「计划弹窗 + 勾选确认」才执行（见 docs/UI-DESIGN-SYSTEM.md §5）。
 */
export const UI_WRITE_ENABLED = true;

/** 给人看的阶段标签（含界面视图状态）。 */
export const STAGE_LABEL = `${STAGE_TITLE}${UI_WRITE_ENABLED ? "" : " · 界面只读视图"}`;

/**
 * 侧栏底部给普通用户看的小技巧（不是开发阶段说明 —— 阶段标识只进日志与总览接口）。
 * 写操作接进界面后，这里展示的是"怎么少点几下就达到目的"的实用提示。
 */
export const NAV_TIPS = [
  "写操作都会先摊开计划、你确认才动手；想看细节就点顶栏「刷新」重看一遍状态。",
  "装/卸插件前可以先建个回滚点：点「回滚点」→「创建回滚点」，出问题一键还原。",
  "DSH 服务起不来时先看「运行状态」页的端口与进程，再点「重启服务」多数情况就好。",
  "插件市场里勾选多个未安装插件可以一次装完；已装的插件在行内直接更新/卸载。",
  "右下角那条悬浮工具条在 DSH 和管家界面都有：回管家、看状态、启停与重启服务。",
];

/** 配置 schema 版本。每次结构变更必须 +1 并补迁移函数。 */
export const CONFIG_SCHEMA_VERSION = 1;

/** DSH 服务端口：用户实际使用 3081；官方默认 3080；8787 为历史遗留（仅作兼容探测）。 */
export const DSH_PORT_DEFAULT = 3081;
export const DSH_PORT_CANDIDATES = [3081, 3080, 8787] as const;

/**
 * 管家自己的本地服务端口。
 * - --headless：固定用这个端口，脚本/其它程序才找得到我们
 * （桌面态以前是"不指定、由运行时随机决定"，2026-09-29 起改为同样首选这个端口、被占才顺延，
 *   详见下面的 BUTLER_PORT_PREFERRED）
 * 选 8731 是为了避开 DSH 自己用的 3080/3081/8787，以及官网上站的 8072/8073。
 */
export const BUTLER_PORT_HEADLESS = 8731;

/**
 * 桌面态首选端口。
 *
 * 【2026-09-29 改动】桌面态以前**故意不指定端口** —— 好处是永远不会因端口冲突开不了窗，
 * 代价是每次启动端口都不一样（日志里 54606 / 59672 / 53324 一路飘），用户想存个书签、
 * 或让别的工具连过来都用不了。
 * 现在改成：先试这个端口，被别的软件占了就往后顺延（见 BUTLER_PORT_FALLBACK_SPAN），
 * 全都占着才回退随机 —— 稳定地址和"永远打得开"两头都要。
 */
export const BUTLER_PORT_PREFERRED = 8731;

/** 首选端口被占用时，最多再往后顺延多少个端口。占满则回退为随机端口。 */
export const BUTLER_PORT_FALLBACK_SPAN = 16;

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
