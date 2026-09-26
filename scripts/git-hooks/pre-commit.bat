@echo off
REM pre-commit hook: reject commits containing Ed25519 private key material
REM Deploy via: scripts\install-git-hooks.ps1

set STAGED=$(git diff --cached --name-only --diff-filter=ACM)
set REJECTED=0

for %%f in (%STAGED%) do (
    echo %%f | findstr /I "ed25519-private ed25519-public.pem key-info.json dsh-proxy" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [pre-commit] REJECT: %%f matches sensitive pattern
        set REJECTED=1
    )
)

if %REJECTED% equ 1 (
    echo.
    echo ERROR: 私钥/密钥清单文件禁止提交。
    echo   - 桌面端公钥 ed25519-public.bin 由仓库自动维护（编译期 include_bytes!）
    echo   - 服务端私钥通过 DSH_SIGNING_KEY_PATH 环境变量部署，不入仓库
    echo   - 密钥轮换请使用 scripts/rotate-key.ps1
    echo.
    exit /b 1
)
exit /b 0
