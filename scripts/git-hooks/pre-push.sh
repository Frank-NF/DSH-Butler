#!/usr/bin/env bash
# pre-push hook: reject pushes containing Ed25519 private key blobs
# Deploy via: scripts/install-git-hooks.ps1

PATTERNS="ed25519-private|key-info\.json|dsh-proxy"

while read local_ref local_sha remote_ref remote_sha; do
    # 仅对 force-push 或新分支做全量扫描（普通 push 走 diff）
    if [ "$local_sha" = "0000000000000000000000000000000000000000" ]; then
        # 删除引用：不扫描
        continue
    fi

    if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
        # 新分支：全量扫描所有 commit 的 blob
        MATCHES=$(git rev-list --objects $local_sha | \
            git cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype)' 2>/dev/null | \
            awk '$2=="blob"' | \
            while read oid; do echo "$oid"; done | \
            xargs -I{} git cat-file -p {} 2>/dev/null | \
            grep -El "BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ed25519-private|key-info\.json|dsh-proxy" 2>/dev/null | \
            wc -l)
    else
        # 常规 push：仅扫描新增/修改
        MATCHES=$(git diff --name-only "$remote_sha" "$local_sha" | \
            grep -E $PATTERNS | wc -l)
    fi

    if [ "$MATCHES" -gt 0 ]; then
        echo ""
        echo "ERROR: 检测到敏感文件被推送到远端仓库。"
        echo "  - 私有 Ed25519 密钥禁止入库或推送"
        echo "  - 已在预推送阶段拦截（pre-push hook）"
        echo "  - 如需部署私钥请通过 DSH_SIGNING_KEY_PATH 环境变量 out-of-band 传递"
        echo ""
        exit 1
    fi
done

exit 0
