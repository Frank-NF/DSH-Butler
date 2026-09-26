#!/usr/bin/env python3
"""
发布新版本到服务器自更新通道：更新 /var/www/dsh-updater/version.json

用法（在服务器上执行）：
    python3 publish-version.py --version 1.18.3 --sha256 <64位hex> --size <字节数> \
        --changelog "1.18.3 新增：xxx" --changelog "1.18.3 修复：yyy"

说明：
  - 变更摘要按传入顺序 prepend 到 changelog 头部，历史条目保留
  - release_url / platforms.windows.url 由 --version 自动拼出
  - 默认不强制更新；--mandatory 可置为强制
  - 建议先备份：cp version.json version.json.bak-$(date +%Y%m%d%H%M%S)
"""
import argparse
import json
import shutil
from datetime import datetime, timezone

PATH = "/var/www/dsh-updater/version.json"
BASE_URL = "https://dsh.huilinsh.cn/api/dl/dsh-plugin-updater-{ver}.exe"


def main() -> None:
    ap = argparse.ArgumentParser(description="更新 DSH 自更新 version.json")
    ap.add_argument("--version", required=True, help="新版本号，如 1.18.3")
    ap.add_argument("--sha256", required=True, help="新 exe 的 SHA256（64 位小写 hex）")
    ap.add_argument("--size", required=True, type=int, help="新 exe 字节数")
    ap.add_argument("--changelog", action="append", default=[], help="变更摘要，可重复传入")
    ap.add_argument("--mandatory", action="store_true", help="标记为强制更新")
    ap.add_argument("--path", default=PATH, help=f"version.json 路径（默认 {PATH}）")
    ap.add_argument("--no-backup", action="store_true", help="跳过自动备份")
    args = ap.parse_args()

    sha = args.sha256.strip().lower()
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise SystemExit(f"sha256 格式不合法: {args.sha256}")

    if not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        shutil.copy2(args.path, f"{args.path}.bak-{ts}")

    with open(args.path, "r", encoding="utf-8") as f:
        data = json.load(f)

    old_version = data.get("version", "?")
    old_count = len(data.get("changelog", []))
    url = BASE_URL.format(ver=args.version)

    data["version"] = args.version
    data["release_url"] = url
    data["sha256"] = sha
    data["is_mandatory"] = bool(args.mandatory)
    data["published_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    data["changelog"] = list(args.changelog) + data.get("changelog", [])
    # 顶层 size_bytes：桌面端用它算下载进度/剩余时间（与 top-level sha256 同理，
    # 客户端只读顶层字段、不认 platforms.*）。漏掉会出现「进度条按旧包大小算」的错乱。
    data["size_bytes"] = args.size

    platforms = data.get("platforms") or {}
    platforms["windows"] = {
        "version": args.version,
        "url": url,
        "sha256": sha,
        "size_bytes": args.size,
    }
    data["platforms"] = platforms

    with open(args.path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"version  : {old_version} -> {args.version}")
    print(f"url      : {url}")
    print(f"sha256   : {sha}")
    print(f"size     : top-level {data['size_bytes']} / windows {platforms['windows']['size_bytes']}")
    print(f"changelog: {old_count} -> {len(data['changelog'])} 条")
    print(f"mandatory: {data['is_mandatory']}")


if __name__ == "__main__":
    main()
