# Workbuddian E2E 测试(真实 Obsidian)

用 Playwright 通过 Chromium DevTools 协议(CDP)驱动**真实运行的 Obsidian**,在 `demo-vault` 里做端到端测试:插件加载、打开聊天面板、发消息、断言流式回复与 UI 状态。

这不是 jest 单测(那层覆盖纯逻辑);e2e 补的是 UI 层,相当于把原来用 codex computer-use 手点的活儿脚本化。

## 原理

Obsidian 是 Electron 应用。以 `--remote-debugging-port` 启动后,渲染进程暴露 DevTools 协议端口,Playwright(`connectOverCDP`)即可像控制 Chrome 一样控制 Obsidian 的 DOM——点击 ribbon 图标、输入、读 DOM、截图。社区同套路:Self-hosted LiveSync 作者 vrtmrz 的 [`@vrtmrz/obsidian-test-session`](https://socket.dev/npm/package/@vrtmrz/obsidian-test-session)(它面向临时 vault + CI;我们直接用现成 demo-vault,更贴近手测场景)。

## 依赖

```bash
npm i -D playwright-core   # 只需要 core:不下载浏览器,连的是 Obsidian 自带的 Chromium
```

要求:macOS、已装 Obsidian、WorkBuddy CLI 可用且已登录(聊天测试要真调 CLI)。

## 完整流程

```bash
# 0. 一键:构建 → 同步 main.js 到 demo-vault → 启动 Obsidian 调试 → 跑 e2e
bash scripts/e2e/run-all.sh [port]

# 分步(等价于上面一键):
# 1. 启动 Obsidian 调试模式并打开 demo-vault
#    (直接 exec 二进制传参;若 9222 被占可换端口,如 9333)
bash scripts/e2e/start-obsidian-debug.sh [port]
# 2. 验证 CDP 端口可达(能看到 Obsidian 页面即成功)
node scripts/e2e/probe-cdp.mjs [port]
# 3. (校准)打印关键 UI 选择器在真 DOM 里是否成立
node scripts/e2e/probe-selectors.mjs [port]
# 4. 跑完整 e2e(插件加载 → 开面板 → 发消息 → 断言流式回复 + 截图)
node scripts/e2e/run.mjs [port]
```

> `run-all.sh` 每次会先 `npm run build`,再把 `main.js/manifest.json/styles.css` 同步到 demo-vault,保证测的是最新构建。

## e2e 发消息测试的安全闸

`run.mjs` 会读插件实例的 `settings.e2e`,为 `true` 才发真消息,避免误发。要启用:在 `demo-vault/.obsidian/plugins/workbuddian/data.json` 的 `settings` 里加 `"e2e": true`,重载插件(设置页或重开 vault)。测完可改回。

聊天测试会真调 WorkBuddy CLI:模型/权限按插件当前设置,可能弹批准卡,需人工配合点一下。

## 常见问题

- **连不上端口**:确认 Obsidian 是用 `start-obsidian-debug.sh` 启动的。该脚本直接 exec 二进制并传参(`open -a` 在旧实例未退干净时会把参数静默丢弃),启动后自带 30s 端口就绪自检。仍失败就看 `/tmp/obsidian-e2e.log` 和 `lsof -nP -iTCP:9222 -sTCP:LISTEN`。
- **弹窗是正常的**:这是真实 Obsidian 窗口,别关掉,测试靠它跑。
- **测完怎么恢复正常**:直接 Cmd+Q 关掉,日常照常打开 Obsidian 即可(调试模式只是命令行参数,不会持久化)。

## 后续

完整 e2e 套件(插件加载断言 → 打开面板 → 发消息 → 断言回复)写在 `run.mjs`,待探针验证后补。
