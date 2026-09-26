/**
 * 错误翻译器：把 npm / pnpm / git / 系统层面的原始报错，翻成「怎么回事 / 为什么 / 影响 / 怎么办」。
 *
 * 【为什么值得单独做一块】管家失败时用户看到的是几十行英文堆栈。实测（2026-09-25）一次依赖冲突
 * 刷了一屏 npm error，真实原因只有一句「两个插件要的 peer 版本对不上」；用户既看不懂，也不知道下一步点哪。
 *
 * 设计约束：
 *   - 纯函数，零副作用、零网络 —— 任何失败路径都能用它，测试也好写（喂真实报错文本断言结论）；
 *   - **认不出来就什么都不说**（返回 null），绝不硬凑一句可能误导人的解释；
 *   - 建议必须落在管家真有的入口上（换安装源、停服重试、清缓存、卸载并安装…），不写空话。
 */

import { type Finding, finding } from "./result.ts";

export interface ErrRule {
  /** 稳定标识，便于统计哪类错最常发生。 */
  id: string;
  /** 命中判据（不区分大小写）。 */
  re: RegExp;
  /** 一句话人话结论。 */
  title: string;
  /** 为什么。 */
  cause: string;
  /** 不处理会怎样。 */
  impact: string;
  /** 怎么办（必须是管家真能点的动作）。 */
  action: string;
  /**
   * 判据重叠时的优先级：**数字越小越先判**，不标注按 100。
   * 为什么要有它：靠数组位置维护「具体的在前」实测踩过两次坑 ——
   * EPERM 改名失败被「没有权限」抢走、git 的 Permission denied (publickey) 也被它抢走。
   */
  priority?: number;
}

/**
 * 规则表。顺序有意义：**具体的在前、笼统的在后**（首个命中即返回）。
 * 每条都来自真实踩过的坑，不是凭空写的错误码表。
 */
export const ERROR_RULES: ErrRule[] = [
  {
    id: "err.eresolve",
    priority: 5,
    re: /ERESOLVE|could not resolve dependency|Conflicting peer dependency/i,
    title: "插件之间的依赖版本对不上（peer 依赖冲突）",
    cause: "两个插件各自要求同一个包的不同版本，npm 默认严格校验就会拒绝整棵树",
    impact: "装不上/卸不掉；管家会回滚到操作前状态，不会留下半成品",
    action: "管家已经默认用宽松解析（--legacy-peer-deps）重试；若仍失败，先在市场里把冲突的那个插件升级或降级，再重试",
  },
  {
    id: "err.pnpm-nomatch",
    priority: 13,
    re: /ERR_PNPM_NO_MATCHING_VERSION|ERR_PNPM_META_FETCH_FAIL/i,
    title: "pnpm 在源上找不到匹配的版本",
    cause: "版本区间写得太窄，或镜像没同步到这个版本",
    impact: "安装无法开始",
    action: "放宽版本要求，或把安装源换成官方源重试",
  },
  {
    id: "err.pnpm-lockfile",
    priority: 14,
    re: /ERR_PNPM_OUTDATED_LOCKFILE|ERR_PNPM_LOCKFILE_BREAKING_CHANGE|frozen-lockfile/i,
    title: "锁文件和依赖清单对不上了",
    cause: "package.json 被改过，而锁文件没同步更新",
    impact: "pnpm 拒绝安装（frozen-lockfile 模式）",
    action: "让管家重新同步依赖锁（卸载/安装动作里会自动做），或删除锁文件后重装",
  },
  {
    id: "err.etarget",
    re: /ETARGET|notarget/i,
    title: "要装的那个版本不存在",
    cause: "版本号写错了，或者你用的镜像还没同步到这个版本",
    impact: "安装无法开始",
    action: "核一下版本号；或在设置里把「npm 安装源」换成官方源 registry.npmjs.org 再试",
  },
  {
    id: "err.e404",
    re: /\bE404\b|404 Not Found|is not in this registry|not found in this registry/i,
    title: "这个包名在安装源里找不到",
    cause: "包名拼错了，或者当前镜像没收录这个包（镜像同步有延迟）",
    impact: "安装无法开始",
    action: "核对包名；或把「npm 安装源」临时切到官方源重试",
  },
  {
    id: "err.filelock",
    priority: 12,
    re: /EPERM: operation not permitted, rename|resource busy|\.tmp.*rename|EBUSY/i,
    title: "文件被正在运行的程序占着，改不动",
    cause: "DSH 桌面端/本体进程还开着，Windows 锁住了目录（本机踩过：pnpm 改名 tmp 目录失败）",
    impact: "更新会半途失败并回滚",
    action: "先在管家总览里停掉 DSH 服务（或退出 DSH 桌面端），再重试",
  },
  {
    id: "err.eacces",
    re: /EACCES|EPERM|access is denied|permission denied|拒绝访问/i,
    title: "没有权限写这个文件（或被安全软件拦下）",
    cause: "目标目录被占用/只读，杀毒或系统安全策略（本机曾出现过 Smart App Control 拦截）挡了一下",
    impact: "安装或替换文件失败，操作会回滚",
    action: "先关掉正在占用该目录的程序（尤其 DSH 本体）再重试；仍失败就看杀软拦截记录",
  },
  {
    id: "err.enotempty",
    re: /ENOTEMPTY|directory not empty/i,
    title: "目标目录里还有东西，删不干净",
    cause: "上一次安装中断留下的残留文件",
    impact: "本次安装无法继续",
    action: "到「诊断」跑一次体检，用「清理安装残留」把残留移进隔离区后重试",
  },
  {
    id: "err.enospc",
    re: /ENOSPC|no space left on device|磁盘空间不足/i,
    title: "磁盘满了",
    cause: "目标盘剩余空间不够（插件目录与缓存都在这块盘上）",
    impact: "写入中断，可能留下半成品（管家会回滚）",
    action: "清出空间再试；「诊断」里能看到 DSH 目录与缓存占用了多少",
  },
  {
    id: "err.timeout",
    re: /ETIMEDOUT|ESOCKETTIMEDOUT|timed out|timeout|超时/i,
    title: "网络太慢或请求超时了",
    cause: "安装源不通、代理没配好，或当前网络抖动",
    impact: "下载中断，操作回滚",
    action: "设置里把「npm 安装源」换成 npmmirror（国内镜像）并填好「网络代理」后重试",
  },
  {
    id: "err.connreset",
    re: /ECONNRESET|ECONNREFUSED|socket hang up|连接被重置/i,
    title: "连接被中途掐断了",
    cause: "代理/防火墙/镜像服务不稳定，或需要走代理才能出去",
    impact: "下载失败，操作回滚",
    action: "在设置里确认代理；然后把安装源切到镜像站重试",
  },
  {
    id: "err.dns",
    re: /ENOTFOUND|EAI_AGAIN|getaddrinfo|Could not resolve host/i,
    title: "域名解析不出来（DNS 问题）",
    cause: "DNS 解析失败或代理把域名解析挡住了",
    impact: "连不上任何安装源",
    action: "检查网络/DNS；用了代理的话确认代理在跑",
  },
  {
    id: "err.eintegrity",
    re: /EINTEGRITY|integrity checksum failed|sha512-/i,
    title: "本地缓存里的包损坏了",
    cause: "下载中断导致 npm 缓存里的内容与校验和不一致",
    impact: "同一个包反复装不上",
    action: "清一次 npm 缓存（npm cache verify / npm cache clean --force）后重试",
  },
  {
    id: "err.badengine",
    re: /EBADENGINE|Unsupported engine|is incompatible with this module/i,
    title: "Node.js 版本不满足这个插件的要求",
    cause: "插件声明了 engines.node 区间，本机 Node 版本不在其中",
    impact: "装上也跑不起来",
    action: "装一个满足要求的 Node.js（建议 22 LTS），或在「环境与配置」里核对当前版本",
  },
  {
    id: "err.badjson",
    re: /Unexpected token .* in JSON|is not valid JSON|JSON\.parse|package\.json.*(parse|Unexpected)/i,
    title: "某个配置文件坏了（JSON 解析不了）",
    cause: "文件被写坏：手动编辑出错、或上次写入被中断",
    impact: "依赖清单读不出来，安装/卸载/诊断都会失败",
    action: "「诊断」里会点名是哪个文件；管家对坏掉的配置会先留一份 .corrupt-<时间戳> 备份再回退默认值",
  },
  {
    id: "err.script",
    re: /(postinstall|preinstall|install) script .*failed|npm error command failed|lifecycle|run-script/i,
    title: "插件的安装脚本跑失败了",
    cause: "该插件自带的 postinstall 脚本在本机执行失败（依赖缺失、需要编译工具等）",
    impact: "包装上了但脚本没跑成，可能启动时报错",
    action: "看「任务」详情里的原始输出定位是哪一步；必要时联系插件作者，或换一个同类插件",
  },
  {
    id: "err.git-auth",
    priority: 10,
    re: /Permission denied \(publickey\)|Authentication failed|could not read Username/i,
    title: "Git 认证没通过",
    cause: "仓库是私有的，或本机没有配置对应的密钥/凭据",
    impact: "拉不到源码",
    action: "配置 SSH key 或凭据后重试；内网仓库记得先连上 VPN",
  },
  {
    id: "err.git-repo",
    priority: 11,
    re: /Repository not found|does not appear to be a git repository|remote: Not Found/i,
    title: "Git 仓库地址不对或没权限",
    cause: "地址写错、仓库改名/删除，或账号没有访问权限",
    impact: "拉不到源码",
    action: "核对仓库地址（管家只允许 https:// 与 git@ 形式，防止参数注入）",
  },
  {
    id: "err.win-sac",
    priority: 9,
    re: /os error 4551|应用程序控制策略|Smart App Control/i,
    title: "被 Windows 的应用程序控制策略拦下了",
    cause: "Smart App Control 会拦截未签名的本地编译产物与脚本",
    impact: "编译/安装脚本无法执行",
    action: "这是系统安全策略，需要在系统设置里调整；管家不会替你改系统策略",
  },
  {
    id: "err.port-in-use",
    re: /EADDRINUSE|os error 10048|address already in use|端口.*(被占用|占用)/i,
    title: "端口被别的程序占用了",
    cause: "目标端口已有进程在监听（Windows 的保留端口区间也会报同样的错）",
    impact: "服务起不来",
    action: "换一个端口，或先在管家总览里停掉占用它的服务再启动",
  },
  {
    id: "err.enoent",
    re: /ENOENT|no such file or directory|cannot find the path/i,
    title: "要操作的路径不存在了",
    cause: "文件/目录被删掉或挪走（也可能是上一次操作未完成留下的空引用）",
    impact: "当前操作失败并回滚",
    action: "在「诊断」里跑一次体检确认现状，再重试",
  },
];

/** 按优先级排好的规则表（稳定排序：同优先级保持数组顺序）。 */
const SORTED_RULES: ErrRule[] = [...ERROR_RULES].sort(
  (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
);

/** 只有认得出才说话：认不出来返回 null（宁可不解释，也不误导）。 */
export function translateError(raw: string): Finding | null {
  if (!raw || typeof raw !== "string") return null;
  for (const rule of SORTED_RULES) {
    if (!rule.re.test(raw)) continue;
    const hit = raw.split(/\r?\n/).find((l) => rule.re.test(l))?.trim();
    return finding(rule.id, "error", rule.title, {
      cause: rule.cause,
      impact: rule.impact,
      action: rule.action,
      evidence: hit ? [hit.slice(0, 300)] : [],
    });
  }
  return null;
}

/** 追加解释时用的分隔标记（也用来避免重复追加）。 */
export const EXPLAIN_MARK = "———————— 管家解读 ————————";

/** 把一条原始报错整理成给用户看的多行说明；认不出来返回 null。 */
export function explainErrorText(raw: string): string | null {
  const a = translateError(raw);
  if (!a) return null;
  const out = [
    EXPLAIN_MARK,
    "【怎么回事】" + a.title,
    "【为什么】" + (a.cause ?? ""),
    "【影响】" + (a.impact ?? ""),
    "【怎么办】" + (a.action ?? ""),
  ];
  return out.join("\n");
}

/**
 * 把解释拼到原始报错后面：任务失败时统一走这里，用户看到的就是人话。
 * 认不出来原样返回；已经带过解释的不重复追加。
 */
export function appendExplanation(message: string): string {
  if (!message || message.includes(EXPLAIN_MARK)) return message;
  const block = explainErrorText(message);
  return block ? message + "\n" + block : message;
}
