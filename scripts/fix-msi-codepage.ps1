<#
.SYNOPSIS
    修复中文产品名导致的 WiX MSI 打包失败，并链接出 zh-CN MSI。

.DESCRIPTION
    tauri build --bundles msi 会以 en-US (codepage 1252) 生成 WiX 中间产物，
    中文产品名「DSH插件管家」无法写入该代码页，light.exe 报 LGHT0311；
    tauri 表层错误只显示 "failed to run light.exe"，极易误判。

    本脚本在 tauri 打包失败后运行：
      1. 把 target/release/wix/x64/locale.wxl 改为 zh-CN / codepage 936 / 语言 2052
      2. 把 main.wxs 的 Codepage 1252→936、Language 1033→2052
      3. 重新 candle 编译，再 light 链接出 MSI

    先跑一次 `tauri build --bundles msi`（让它失败并生成中间产物），再跑本脚本。

.EXAMPLE
    .\scripts\fix-msi-codepage.ps1
#>
[CmdletBinding()]
param(
    [string]$WixTools = "$env:LOCALAPPDATA\tauri\WixTools314"
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$wixDir = Join-Path $root 'src-tauri\target\release\wix\x64'
$bundleMsi = Join-Path $root 'src-tauri\target\release\bundle\msi'
$confPath = Join-Path $root 'src-tauri\tauri.conf.json'

if (-not (Test-Path $wixDir)) {
    throw "未找到 WiX 中间产物目录：$wixDir`n请先运行 tauri build --bundles msi（会失败，但会生成中间产物）。"
}
foreach ($tool in 'candle.exe', 'light.exe') {
    if (-not (Test-Path (Join-Path $WixTools $tool))) { throw "未找到 $tool：$WixTools" }
}

# 版本号取自 tauri.conf.json（唯一权威源）
$version = (Get-Content $confPath -Raw | ConvertFrom-Json).version
$productName = (Get-Content $confPath -Raw | ConvertFrom-Json).productName
$outMsi = Join-Path $bundleMsi ("{0}_{1}_x64_zh-CN.msi" -f $productName, $version)

Push-Location $wixDir
try {
    # --- 1. locale.wxl：zh-CN + codepage 936 ---
    $wxlPath = Join-Path $wixDir 'locale.wxl'
    $wxl = Get-Content $wxlPath -Raw
    $wxl = $wxl -replace 'Culture="en-us"', 'Culture="zh-cn" Codepage="936"'
    $wxl = $wxl -replace '<String Id="TauriLanguage">1033</String>', '<String Id="TauriLanguage">2052</String>'
    $wxl = $wxl -replace '<String Id="TauriCodepage">1252</String>', '<String Id="TauriCodepage">936</String>'
    Set-Content $wxlPath $wxl -Encoding UTF8
    Write-Host "[1/3] locale.wxl -> zh-CN / codepage 936" -ForegroundColor Green

    # --- 2. main.wxs：Codepage / Language 同步 ---
    $wxsPath = Join-Path $wixDir 'main.wxs'
    $wxs = Get-Content $wxsPath -Raw
    $wxs = $wxs -replace 'Codepage="1252"', 'Codepage="936"'
    $wxs = $wxs -replace 'Language="1033"', 'Language="2052"'
    Set-Content $wxsPath $wxs -Encoding UTF8
    Write-Host "[2/3] main.wxs -> Codepage 936 / Language 2052" -ForegroundColor Green

    # --- 3. candle 重编 + light 链接 ---
    & (Join-Path $WixTools 'candle.exe') -arch x64 'main.wxs' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "candle 失败（exit $LASTEXITCODE）" }

    New-Item -ItemType Directory -Force -Path $bundleMsi | Out-Null
    & (Join-Path $WixTools 'light.exe') `
        -ext WixUIExtension -ext WixUtilExtension `
        -loc 'locale.wxl' -out $outMsi 'main.wixobj' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "light 失败（exit $LASTEXITCODE）" }

    Write-Host "[3/3] candle + light 完成" -ForegroundColor Green
}
finally {
    Pop-Location
}

if (Test-Path $outMsi) {
    $mb = [math]::Round((Get-Item $outMsi).Length / 1MB, 2)
    Write-Host ""
    Write-Host "MSI 产出：$outMsi ($mb MB)" -ForegroundColor Cyan
} else {
    throw "MSI 未生成：$outMsi"
}
