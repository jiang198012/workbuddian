#!/bin/bash
# 一键发布 Workbuddian:提交 → 打 tag → 推送 GitHub + 私有 origin → 触发/创建 GitHub Release
#
# 用法:
#   bash scripts/release.sh [version] [commit_msg]
#   默认 version = package.json 当前版本,commit_msg 自动生成 "release: v<version> ..."
#
# 前置:
#   - git 凭据可用(能 push 到 github + origin)
#   - 私有 origin(Harness Gitness)需要 HARNESS_API_KEY(默认读 ~/.claude/.harness_token)
#   - 版本号/CHANGELOG 已改好(本脚本不负责改版本)
#   - tag 不带 v 前缀:release.yml 会校验 tag == manifest.json.version(Obsidian 市场匹配口径)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="${1:-$(grep '"version"' package.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')}"
MSG="${2:-release: v${VERSION} UX 全面改造 + e2e 基建}"

# 私有源凭据:优先环境变量,否则读 ~/.claude/.harness_token(若存在)
if [ -z "${HARNESS_API_KEY:-}" ] && [ -f "$HOME/.claude/.harness_token" ]; then
    export HARNESS_API_KEY="$(cat "$HOME/.claude/.harness_token")"
fi

echo "==== 1/5 检查版本一致 ===="
PV="$(grep '"version"' package.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
MV="$(grep '"version"' manifest.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
if [ "$PV" != "$MV" ]; then
    echo "✗ 版本不一致: package.json=$PV manifest.json=$MV" >&2
    exit 1
fi
echo "  版本一致: $PV"

echo "==== 2/5 提交 ===="
git add -A
git commit -m "$MSG" || echo "  (无改动可提交或已提交)"
# tag 不带 v 前缀(与 manifest.json 的 version 完全一致,Obsidian 市场 + release.yml 校验口径),annotated 与历史惯例一致
git tag -a "$VERSION" -m "Release $VERSION"

echo "==== 3/5 推送 github ===="
git push github main
git push github "$VERSION"

echo "==== 4/5 推送私有 origin ===="
if [ -n "${HARNESS_API_KEY:-}" ]; then
    git -c http.extraHeader="Authorization: Bearer ${HARNESS_API_KEY}" push origin main \
        || echo "  ⚠ origin 推送失败(私有源可能未开),不影响 GitHub 发布"
    git -c http.extraHeader="Authorization: Bearer ${HARNESS_API_KEY}" push origin "$VERSION" \
        || echo "  ⚠ origin tag 推送失败"
else
    echo "  未设置 HARNESS_API_KEY,跳过私有源推送(GitHub 发布不受影响)"
fi

echo "==== 5/5 GitHub Release ===="
if [ -f .github/workflows/release.yml ]; then
    echo "  检测到 release.yml:tag push 后 GitHub Actions 会自动构建并创建 Release(含 artifact attestations)。"
    echo "  不要手动 gh release create(会与 CI 冲突导致 attestations 缺失)。"
    echo "  CI 运行状态: https://github.com/jiang198012/workbuddian/actions"
    echo "  Release 查看: https://github.com/jiang198012/workbuddian/releases"
elif command -v gh >/dev/null 2>&1; then
    gh release create "$VERSION" \
        --title "v$VERSION" \
        --notes "$(sed -n "/## v${VERSION}/,/^## v/p" CHANGELOG.md | head -n -1)" \
        || echo "⚠ gh release 创建失败(可能已存在或未登录 gh)"
    echo "✔ Release 已创建: https://github.com/jiang198012/workbuddian/releases/tag/$VERSION"
else
    echo "  未安装 gh CLI,跳过 Release 创建。"
    echo "  手动创建: https://github.com/jiang198012/workbuddian/releases/new?tag=$VERSION"
fi

echo ""
echo "✔ 发布完成: $VERSION"
