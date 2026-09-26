#!/usr/bin/env python3
"""同步 DSH 官方发布说明 → /var/www/dsh-updater/dsh-releases.json

为什么要在服务器上做这层缓存：
用户机器在国内连不上 GitHub（curl 超时 / git 502），拿不到 Release 说明；
香港服务器有外网，由它定时抓取并落成静态 JSON，客户端只读这个 JSON。

数据源：https://api.github.com/repos/deepseek-ai/deepseek-harness/releases
输出给客户端的字段：version / tag / prerelease / published_at / html_url /
                   summary / sections[{title,items}] / cautions[]
"""
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

REPO = "deepseek-ai/deepseek-harness"
API = f"https://api.github.com/repos/{REPO}/releases?per_page=100"
OUT = "/var/www/dsh-updater/dsh-releases.json"

# 中文发布说明里，这几节属于「变更说明」而非「注意事项」；
# 「其他变更」通常是行为/接口调整（破坏性变更），单独抽出来当作注意事项。
CAUTION_SECTIONS = {"其他变更", "注意事项", "升级注意", "Breaking Changes", "Chores"}


def fetch_releases():
    req = urllib.request.Request(
        API,
        headers={
            "User-Agent": "dsh-butler-release-sync",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def clean_line(line: str) -> str:
    """去掉 markdown 标记与 @提及，只留人能读的短句"""
    line = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", line)  # [text](url) -> text
    line = line.replace("**", "").replace("`", "").replace("~~", "")
    line = re.sub(r"@[A-Za-z0-9_-]+", "", line)  # 去掉 @贡献者
    line = re.sub(r"\s+", " ", line)
    # 去掉 @提及后留下的孤立分隔符（"……操作。 — " / "……操作。 ,"）
    line = re.sub(r"\s+([,，、;；:：])", r"\1", line)
    line = re.sub(r"[\s\-—–·,，、;；:：]+$", "", line)
    line = re.sub(r"^\s*[\-—–·]+\s*", "", line)
    return line.strip()


# 各版本发布说明的排版并不统一，历史上出现过这几种写法：
#   <h3 id="cn-0.1.5-rc.1">新增功能</h3>   （新）
#   <h3>新增功能</h3>                      （0.1.2~0.1.3 期，无 id）
#   <h2 id="chinese">0.1.3-alpha.2 · 中文</h2>（更早，语言标记）
#   ### 体验优化 / ## 其他变更              （markdown 标题）
# 所以标题判定必须宽松，语言区判定必须能同时认 id 和标题文字。
HTML_HEADING_RE = re.compile(r"^<h([1-4])([^>]*)>(.*?)</h\1>\s*$", re.I)
MD_HEADING_RE = re.compile(r"^(#{1,4})\s+(.*)$")
ID_RE = re.compile(r'id\s*=\s*"([^"]*)"', re.I)

# 英文分节标题（出现即说明进入英文区，中文部分到此为止）
EN_TITLES = {
    "new features", "improvements", "bug fixes", "chores", "features", "fixes",
    "breaking changes", "other changes", "documentation", "dependencies", "tests",
    "performance", "refactor", "internal changes",
}
# 纯语言标记（不是分节标题，要跳过）
LANG_MARKERS = {"cn", "chinese", "en", "english", "zh", "zh-cn"}


def parse_body(body: str):
    """把双语发布说明切成「中文分节 + 注意事项」。

    结构：语言切换行 → 中文概述 → 中文各节 → 英文区（直接丢弃）。
    """
    sections = []
    summary_lines = []
    current = None
    in_en = False
    seen_section = False

    for raw in (body or "").splitlines():
        line = raw.strip()
        if not line or line in ("---", "***", "___"):
            continue
        if line.startswith("[中文]") or line.startswith("[English]"):
            continue
        if line.startswith(">"):  # 引用块（外部链接提示），不进正文
            continue
        if line.lower().startswith("full changelog"):
            continue

        # ---- 标题判定 ----
        title = None
        hid = ""
        m = HTML_HEADING_RE.match(line)
        if m:
            attrs, title = m.group(2), clean_line(m.group(3))
            mid = ID_RE.search(attrs)
            hid = (mid.group(1) if mid else "").lower()
        else:
            m2 = MD_HEADING_RE.match(line)
            if m2:
                title = clean_line(m2.group(2))

        if title is not None:
            # 语言标记（如 <h2 id="chinese">0.1.3-alpha.2 · 中文</h2>）：只用来切语言
            if hid in LANG_MARKERS:
                if hid in ("en", "english"):
                    in_en = True
                    current = None
                continue
            # 进入英文区：id 含 en/english，或标题是已知英文节名
            is_en_heading = (
                in_en
                or hid.startswith(("en-", "english"))
                or title.lower() in EN_TITLES
            )
            if is_en_heading:
                in_en = True
                current = None
                continue
            current = {"title": title, "items": []}
            sections.append(current)
            seen_section = True
            continue

        if in_en:
            continue

        # ---- 列表项 ----
        if line.startswith(("- ", "* ", "+ ")):
            text = clean_line(line[2:])
            if text and current is not None:
                current["items"].append(text)
            continue

        # ---- 普通段落 ----
        text = clean_line(line)
        if text and current is None and not seen_section:
            summary_lines.append(text)

    summary = " ".join(summary_lines)
    if len(summary) > 300:
        summary = summary[:300].rstrip() + "…"

    cautions = []
    for sec in sections:
        if sec["title"] in CAUTION_SECTIONS:
            cautions.extend(sec["items"])

    return summary, sections, cautions


def main():
    try:
        releases = fetch_releases()
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        print(f"[dsh-releases-sync] 拉取失败，保留旧文件: {exc}", file=sys.stderr)
        return 1

    out = []
    for r in releases:
        tag = r.get("tag_name") or ""
        version = re.sub(r"^dsh-v", "", tag)
        if not version:
            continue
        summary, sections, cautions = parse_body(r.get("body") or "")
        # 双保险：GitHub 的 prerelease 标志 + semver 是否带预发布段
        prerelease = bool(r.get("prerelease")) or bool(
            re.search(r"-[A-Za-z]", version)
        )
        out.append(
            {
                "version": version,
                "tag": tag,
                "prerelease": prerelease,
                "published_at": r.get("published_at"),
                "html_url": r.get("html_url"),
                "summary": summary,
                "sections": [s for s in sections if s["items"]],
                "cautions": cautions,
            }
        )

    out.sort(key=lambda x: x["published_at"] or "", reverse=True)

    payload = {
        "synced_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": f"github:{REPO}",
        "stable_exists": any(not r["prerelease"] for r in out),
        "releases": out,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    import os

    os.replace(tmp, OUT)
    os.chmod(OUT, 0o644)
    print(
        f"[dsh-releases-sync] ok: {len(out)} 个版本, "
        f"存在稳定版={payload['stable_exists']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
