#!/usr/bin/env bash
# DSH 管家官网运营统计：按【路径】统计下载与活跃装机（nginx 日志里没有 host 字段，只能按路径）
# 排除爬虫与工具类 UA；输出 stats.json 供官网展示，同时打印人看的摘要。
set -euo pipefail
OUT=/var/www/dsh-butler-site/stats.json
BOTS='bot|spider|crawl|Censys|curl|wget|python-requests|Go-http|zgrab|masscan|nmap|semrush|ahrefs|facebookexternalhit|monitor|UptimeRobot|PetalBot|YandexBot|Baiduspider|Sogou'

all_logs() {
  for f in /var/log/nginx/access.log /var/log/nginx/access.log.[0-9] /var/log/nginx/access.log.[0-9][0-9].gz; do
    [ -f "$f" ] || continue
    case "$f" in
      *.gz) zcat "$f" 2>/dev/null || true ;;
      *) cat "$f" 2>/dev/null || true ;;
    esac
  done
}

TMP=$(mktemp)
all_logs | grep -viE "$BOTS" > "$TMP" || true

# 下载：程序包与源码包（GET 才算，HEAD 是探测）
zip_dl=$(grep -cE 'GET /butler/[^ ]*win-x64\.zip' "$TMP" || true)
src_dl=$(grep -cE 'GET /butler/[^ ]*source\.zip' "$TMP" || true)
hb=$(grep -cE 'GET /butler/version\.json' "$TMP" || true)
hb_ips=$(grep -E 'GET /butler/version\.json' "$TMP" | awk '{print $1}' | sort -u | wc -l || true)
dl_ips=$(grep -E 'GET /butler/[^ ]*\.zip' "$TMP" | awk '{print $1}' | sort -u | wc -l || true)
page_views=$(grep -cE 'GET /(index\.html)? HTTP' "$TMP" || true)
today=$(date +%F)
today_dl=$(grep -E 'GET /butler/[^ ]*\.zip' "$TMP" | grep -c "$today" || true)

cat > "$OUT" <<JSON
{
  "generatedAt": "$(date -Iseconds)",
  "downloads": { "total": $((zip_dl + src_dl)), "app": $zip_dl, "source": $src_dl, "today": $today_dl, "uniqueIps": $dl_ips },
  "activeInstalls": { "heartbeats": $hb, "uniqueIps": $hb_ips },
  "pageViews": $page_views
}
JSON
chmod 644 "$OUT"
rm -f "$TMP"
echo "程序包下载 $zip_dl ｜ 源码包下载 $src_dl ｜ 今日下载 $today_dl"
echo "活跃装机心跳 $hb 次，独立 IP $hb_ips 个（≈在跑的实例）"
echo "下载独立 IP $dl_ips 个 ｜ 首页访问（去爬虫）$page_views 次"
echo "已写入 $OUT"
