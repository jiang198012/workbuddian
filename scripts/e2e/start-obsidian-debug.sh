#!/bin/bash
# 以 Chromium 远程调试端口启动 Obsidian 并打开 demo-vault(e2e 测试专用,macOS)
#
# 原理:Obsidian 是 Electron 应用,`--remote-debugging-port` 开启 DevTools 协议端口,
# Playwright 通过 connectOverCDP 连接后即可驱动真实 Obsidian UI。
#
# 为什么直接执行二进制而不是 `open -a`:
#   open -a 走 LaunchServices,若旧实例还在退出中会被复用,命令行参数被静默忽略,
#   --remote-debugging-port 根本没生效(端口就绪前的第一版脚本踩的就是这个坑)。
#   直接 exec 二进制,参数传递确定;另加 --remote-allow-origins 兼容 Chromium 111+
#   对非 DevTools 客户端的 WebSocket 源校验(Playwright connectOverCDP 必需)。
#
# 注意:会弹出一个真实 Obsidian 窗口(测试对象),测完 Cmd+Q 关闭即可,日常不受影响。
#
# 用法:
#   bash scripts/e2e/start-obsidian-debug.sh [port]    默认 9222
#   可用环境变量 OBSIDIAN_BIN 覆盖二进制路径

set -euo pipefail
PORT="${1:-9222}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VAULT="$REPO_ROOT/demo-vault"
OBSIDIAN="${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/Obsidian}"

if [ ! -x "$OBSIDIAN" ]; then
    echo "✗ 找不到 Obsidian 二进制: $OBSIDIAN" >&2
    echo "  请安装 Obsidian 或用 OBSIDIAN_BIN=/path/to/Obsidian 指定" >&2
    exit 1
fi
if [ ! -f "$VAULT/.obsidian/plugins/workbuddian/manifest.json" ]; then
    echo "✗ 插件未安装到 demo-vault: $VAULT/.obsidian/plugins/workbuddian/" >&2
    exit 1
fi

echo "1/3 退出已运行的 Obsidian ..."
# 临时把 demo-vault 设为唯一 open(否则 Obsidian 恢复上次打开的正式 vault,测试会加载旧插件)
PIN_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/obsidian-vault-pin.py"
python3 "$PIN_SCRIPT" pin "$VAULT"
# 无论启动成功/失败,退出时恢复 obsidian.json(不破坏正式 vault 的打开状态)
restore_obsidian() { python3 "$PIN_SCRIPT" restore >/dev/null 2>&1 || true; }
trap restore_obsidian EXIT
osascript -e 'quit app "Obsidian"' 2>/dev/null || true
for _ in $(seq 1 10); do
    pgrep -x Obsidian >/dev/null 2>&1 || break
    sleep 1
done
if pgrep -x Obsidian >/dev/null 2>&1; then
    echo "  优雅退出超时,强制结束旧实例 ..."
    pkill -x Obsidian 2>/dev/null || true
    sleep 2
fi

echo "2/3 直接以调试参数启动 Obsidian(端口 $PORT)..."
rm -f /tmp/obsidian-e2e.log
nohup "$OBSIDIAN" \
    --remote-debugging-port="$PORT" \
    --remote-allow-origins='*' \
    "$VAULT" \
    >/tmp/obsidian-e2e.log 2>&1 &
OBS_PID=$!

echo "3/3 等待调试端口就绪(最多 30s)..."
for _ in $(seq 1 30); do
    # 先试 127.0.0.1,再试 localhost(有些环境只绑 IPv6 ::1)
    if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
        || curl -sf "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
        echo "✔ 调试端口 $PORT 已就绪"
        echo "  下一步: node scripts/e2e/probe-cdp.mjs $PORT"
        exit 0
    fi
    # 进程已死 = 启动即失败,提前诊断
    if ! kill -0 "$OBS_PID" 2>/dev/null; then
        echo "✗ Obsidian 进程($OBS_PID)已退出,启动失败!" >&2
        echo "  ---- /tmp/obsidian-e2e.log 日志 ----" >&2
        tail -30 /tmp/obsidian-e2e.log >&2 || echo "  (日志为空)" >&2
        exit 1
    fi
    sleep 1
done

echo "✗ 30s 内调试端口未就绪。现场快照:" >&2
echo "  ---- Obsidian 进程 ----" >&2
pgrep -fl Obsidian >&2 || echo "  (无 Obsidian 进程!)" >&2
echo "  ---- 9222 端口监听 ----" >&2
lsof -nP -iTCP:$PORT -sTCP:LISTEN >&2 || echo "  (端口无监听)" >&2
echo "  ---- /tmp/obsidian-e2e.log 末尾 ----" >&2
tail -30 /tmp/obsidian-e2e.log >&2 || echo "  (日志为空)" >&2
exit 1
