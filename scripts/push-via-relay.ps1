# git push via relay server (dynamic socks tunnel)
# 用法: .\scripts\push-via-relay.ps1 [-Remote <name>] [-Refspec <refspec...>]
# 默认: origin main --tags
#
# 中转服务器地址**不写死**：本仓库可能被分享/公开，硬编码服务器 IP 与用户名属信息暴露
# （见 AUDIT-2026-09-03.md P2-5）。请通过以下任一方式提供：
#   · 环境变量：$env:DSH_RELAY_HOST = "root@your-relay-host"
#   · 参数：    -Host "root@your-relay-host"
#   · 或写进 ~/.ssh/config 用别名，把别名传给 -Host
param(
  [string]$Remote = "origin",
  [string[]]$Refspec = @("main", "--tags"),
  [int]$Port = 1789,
  [string]$Host = $env:DSH_RELAY_HOST
)
$ErrorActionPreference = "Stop"

if (-not $Host) {
  throw "未指定中转服务器：请设置环境变量 DSH_RELAY_HOST 或用 -Host 传入（例：-Host root@relay.example.com）。本脚本刻意不内置默认地址。"
}

# 隧道若未在跑则隐藏启动（ssh -D 动态转发，经中转服务器出网）
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -WindowStyle Hidden ssh -ArgumentList "-D", "127.0.0.1:$Port", "-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-i", "$env:USERPROFILE\.ssh\id_ed25519", $Host
  Start-Sleep -Seconds 3
  $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) { Write-Error "relay tunnel failed to start on port $Port" }
}
Write-Host "relay tunnel up on 127.0.0.1:$Port -> $Host"

git -c http.proxy="socks5h://127.0.0.1:$Port" -c https.proxy="socks5h://127.0.0.1:$Port" push $Remote @Refspec
Write-Host "push_exit=$LASTEXITCODE"
exit $LASTEXITCODE
