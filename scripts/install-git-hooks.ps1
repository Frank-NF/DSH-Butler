# 安装 git hooks（一次性，克隆仓库后运行）
# 支持 Windows (PowerShell / Git Bash) 与 Unix (bash)
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$hooksDir = Join-Path $root '..\.git\hooks'
$srcHooks = Join-Path $root '..\scripts\git-hooks'

if (-not (Test-Path $hooksDir)) {
    Write-Host "Creating hooks dir: $hooksDir"
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
}

$mapping = @{
    'pre-commit.bat' = 'pre-commit'
    'pre-push.sh'    = 'pre-push'
}

foreach ($srcName in $mapping.Keys) {
    $src = Join-Path $srcHooks $srcName
    $dstName = $mapping[$srcName]
    $dst = Join-Path $hooksDir $dstName

    if ((Test-Path $dst) -and -not $Force) {
        Write-Host "SKIP (exists): $dstName"
        continue
    }

    Copy-Item -Path $src -Destination $dst -Force
    if ($dstName -eq 'pre-push') {
        # .sh hook 需要可执行权限（Git for Windows 自带 chmod）
        $null = git config core.hooksPath $hooksDir
        Write-Host "Set core.hooksPath=$hooksDir"
    }
    Write-Host "Installed: $dstName"
}

Write-Host 'Done. Hooks installed to .git/hooks/'
