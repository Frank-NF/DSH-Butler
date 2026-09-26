<#
.SYNOPSIS
    构建可分发的发行版（剥离编译期嵌入的本机路径）。

.DESCRIPTION
    Rust 默认把 panic 位置与依赖源码的绝对路径写进二进制，于是每个 cargo 依赖都
    带着构建机的用户名与目录结构（实测未处理时 exe 内有 957 处
    `C:\Users\<用户名>\.cargo\registry\src\...`）。这会随安装包分发给每个使用者，
    属于隐私指纹。

    本脚本用 `--remap-path-prefix` 在编译期统一改写这些前缀：
      · 用户主目录（含 .cargo 注册表）→ /build
      · 项目根目录                     → /src
    前缀从当前环境变量推导，**不写死任何用户名**，换机器照样可用。

    注意：RUSTFLAGS 变化会使 cargo 重建全部依赖，首次约 5–10 分钟属正常。

.EXAMPLE
    .\scripts\build-release.ps1                 # 默认 --bundles nsis
    .\scripts\build-release.ps1 -Bundles msi    # 只出 MSI（需先跑 fix-msi-codepage.ps1 收尾）
#>
[CmdletBinding()]
param(
    [string]$Bundles = 'nsis',
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$home_dir = $env:USERPROFILE
if (-not $home_dir) { $home_dir = $env:HOME }
if (-not $home_dir) { throw '无法定位用户主目录（USERPROFILE / HOME 均为空）' }

# 正斜杠形式对 rustc 更稳；同时给出反斜杠变体，覆盖两种写法
$remaps = @(
    "--remap-path-prefix=$home_dir=/build",
    "--remap-path-prefix=$($home_dir -replace '\\','/')=/build",
    "--remap-path-prefix=$root=/src",
    "--remap-path-prefix=$($root -replace '\\','/')=/src"
)
$env:RUSTFLAGS = ($remaps -join ' ')

# C/C++ 依赖（如 lzma-sys）由 cc crate 调本机 C 编译器编译，RUSTFLAGS 管不到它们，
# 需要单独给 C 编译器传路径映射，否则仍会残留少量 `<用户名>` 路径（实测 2 处，UTF-16）。
$hostTriple = (& rustc -vV | Select-String '^host:' | ForEach-Object { $_.Line -replace '^host:\s*', '' }).Trim()
if ($hostTriple -like '*msvc*') {
    # MSVC：/pathmap:"<源前缀>=<替换>"（路径含冒号，必须加引号，否则解析歧义）
    # /DNDEBUG：release 关闭 C 断言——断言里的 __FILE__ 是以 UTF-16 硬编码进二进制的，
    #           光靠 /pathmap 去不掉（实测仍残留 2 处），关断言才是根治手段。
    $cflag = "/DNDEBUG /pathmap:`"$home_dir=/build`" /pathmap:`"$root=/src`""
    $env:CFLAGS = "$($env:CFLAGS) $cflag".Trim()
    $env:CXXFLAGS = "$($env:CXXFLAGS) $cflag".Trim()
    Write-Host "C 编译器（MSVC）路径映射与断言关闭：$cflag"
}
else {
    # GCC/Clang：-ffile-prefix-map + -DNDEBUG
    $cflag = "-DNDEBUG -ffile-prefix-map=$home_dir=/build -ffile-prefix-map=$root=/src"
    $env:CFLAGS = "$($env:CFLAGS) $cflag".Trim()
    $env:CXXFLAGS = "$($env:CXXFLAGS) $cflag".Trim()
    Write-Host "C 编译器（GCC/Clang）路径映射与断言关闭：$cflag"
}

Write-Host "RUSTFLAGS 已设置（剥离本机路径）：" -ForegroundColor Cyan
$remaps | ForEach-Object { Write-Host "  $_" }
Write-Host ""

$tauri = Join-Path $root 'src-vue\node_modules\.bin\tauri.cmd'
if (-not (Test-Path $tauri)) { throw "未找到 tauri CLI：$tauri" }

Push-Location $root
try {
    & $tauri build --bundles $Bundles
    if ($LASTEXITCODE -ne 0) { throw "tauri build 失败（exit $LASTEXITCODE）" }
}
finally {
    Pop-Location
}

$exe = Join-Path $root 'src-tauri\target\release\dsh-plugin-updater.exe'
if (-not (Test-Path $exe)) { throw "未找到产物：$exe" }

# 自检：确认产物里不再含构建机用户名
if (-not $SkipVerify) {
    $user = Split-Path $home_dir -Leaf
    $bytes = [System.IO.File]::ReadAllBytes($exe)
    $hits = 0
    foreach ($enc in @([System.Text.Encoding]::UTF8, [System.Text.Encoding]::Unicode)) {
        $nb = $enc.GetBytes($user)
        for ($i = 0; $i -le $bytes.Length - $nb.Length; $i++) {
            $ok = $true
            for ($j = 0; $j -lt $nb.Length; $j++) { if ($bytes[$i + $j] -ne $nb[$j]) { $ok = $false; break } }
            if ($ok) { $hits++ }
        }
    }
    Write-Host ""
    if ($hits -eq 0) {
        Write-Host "自检通过：产物中不含构建机用户名「$user」" -ForegroundColor Green
    }
    else {
        Write-Warning "产物中仍检出 $hits 处「$user」——请检查 RUSTFLAGS 是否生效（依赖需重建）"
    }
}

$size = [math]::Round((Get-Item $exe).Length / 1MB, 2)
Write-Host "产物：$exe ($size MB)" -ForegroundColor Cyan
