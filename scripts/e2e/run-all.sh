#!/bin/bash
# 一键:构建 → 同步 main.js 到 demo-vault → 启动 Obsidian 调试 → 跑 e2e
#
# 用法:
#   bash scripts/e2e/run-all.sh [port]     # 默认 9222
#
# 依赖:
#   - npm run build 可用(tsc 类型检查 + esbuild)
#   - playwright-core 已装(scripts/e2e/README.md)
#   - 本机 WorkBuddy CLI 已登录(聊天测试要真调)
#
# 注意:
#   - 会退出当前 Obsidian 并用调试模式重启(同 start-obsidian-debug.sh)
#   - e2e 的"发消息"测试依赖 data.json 的 settings.e2e=true(见 README)

set -euo pipefail
PORT="${1:-9222}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/demo-vault/.obsidian/plugins/workbuddian"

echo "==== 1/4 构建 ===="
cd "$REPO_ROOT"
npm run build

echo "==== 2/4 同步 main.js/manifest.json/styles.css 到 demo-vault ===="
cp main.js manifest.json styles.css "$PLUGIN_DIR/"
ls -la "$PLUGIN_DIR/main.js" "$PLUGIN_DIR/manifest.json" "$PLUGIN_DIR/styles.css"

echo "==== 3/4 启动 Obsidian 调试模式 ===="
bash "$REPO_ROOT/scripts/e2e/start-obsidian-debug.sh" "$PORT"

echo "==== 4/4 跑 e2e ===="
cd "$REPO_ROOT"
node scripts/e2e/run.mjs "$PORT"

echo ""
echo "✔ 全部完成。e2e 截图: chat-open.png / chat-final.png(已在 .gitignore)"
