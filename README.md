# Workbuddian

> **Workbuddian** — an independent rework based on BuddyBridge v1.0.13 (MIT). Adds: a
> main-pane large panel command, real stop-generation, conversation rename/export/
> search, an `@`-note reference picker, and full macOS support (auto-detection of
> `WorkBuddy.app` and Homebrew-installed Node.js). Not affiliated with the upstream
> author; see https://github.com/ben4202121/buddybridge for the original.

> Connect Obsidian to WorkBuddy/CodeBuddy CLI for AI chat.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **⚠️ Windows and macOS are supported.** Linux is not supported yet.
> **Requires Obsidian 1.7.2+.**

Workbuddian is an unofficial Obsidian plugin that bridges your vault with the local WorkBuddy / CodeBuddy CLI. It opens a chat panel inside Obsidian, streams AI responses, displays thinking steps and tool calls, and keeps your conversation history across sessions.

---

## Requirements

- **Obsidian 1.7.2 or later** (desktop).
- **Windows or macOS** (Linux is not supported yet).
- **WorkBuddy desktop app** (≥ 5.0.5) with CodeBuddy CLI installed, or a custom CodeBuddy path configured in settings.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/ben4202121/buddybridge/releases/latest).
2. Copy the three files into `.obsidian/plugins/workbuddian/` inside your vault.
3. Restart Obsidian.
4. Go to **Settings → Community plugins → Turn off Safe Mode → Enable Workbuddian**.

### First-time setup

If Workbuddian cannot find CodeBuddy or Node.js automatically, follow the environment setup prompt once (see the Chinese section below or open `提示词-发给workbuddy让它给buddybridge授权.md`).

## Usage

1. Click the **robot ribbon icon** or run the command **"Workbuddian: Open chat panel"** from the command palette.
2. A chat panel opens in the right sidebar, joining the existing tab group (like Outline or Backlinks) so it takes the full sidebar height when active. To open it as a full-width tab in the main editor area instead, run the command **"Workbuddian: Open chat panel in main editor area"**.
3. Type your message and press **Enter** to send. Use **Shift + Enter** to insert a new line.
4. Switch between conversations using the tabs at the top, or click **+** to start a new one.
5. Open **Settings → Workbuddian** to configure the CodeBuddy CLI path manually if needed.

## Features

- Chat panel in Obsidian sidebar with multi-turn conversations
- Streaming responses in real time
- Collapsible thinking blocks and tool-call cards
- Markdown rendering for assistant messages (code, tables, lists, quotes)
- Vault-aware context injection
- Conversation persistence across Obsidian restarts
- Automatic CodeBuddy / Node.js path discovery on Windows and macOS
- Configurable CLI path in settings
- Real stop-generation button to interrupt long-running LLM responses
- Conversation rename via double-click on tab titles
- Export conversations to notes or copy to clipboard via right-click menu
- Full-text search across conversation titles and message content
- @-note reference picker to insert and contextualize vault notes
- Chat opens in the sidebar as a proper tab (not stacked with other panels) by default; a separate command opens it as a full-width tab in the main editor area instead

## Troubleshooting

| Symptom | Cause | Solution |
|---|---|---|
| `Cannot find codebuddy CLI` | Auto-detection failed | Fill the **CodeBuddy path** in plugin settings. Default location: `WorkBuddyInstallDir\resources\app.asar.unpacked\cli\bin\codebuddy` |
| `Cannot find Node.js` | Node.js is not configured | Run the first-time environment setup prompt (Chinese section below) |
| Stuck on "Thinking..." | Streaming ended without text chunks | Fixed in v1.0.11 |

---

# 中文说明

> 将 Obsidian 连接到 WorkBuddy/CodeBuddy CLI，实现侧边栏 AI 聊天。

## 安装

1. 从 [latest release](https://github.com/ben4202121/buddybridge/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 复制到 Vault 目录下的 `.obsidian/plugins/workbuddian/`。
3. 重启 Obsidian。
4. 进入 **设置 → 第三方插件 → 关闭安全模式 → 开启 Workbuddian**。

## 使用方法

1. 点击左侧的 **机器人图标**，或从命令面板运行 **"Workbuddian: 打开聊天面板"**。
2. 聊天面板会加入右侧栏现有的标签组（和大纲、反向链接一样），激活时占满整个侧边栏高度。如需在主编辑区打开为全宽标签页，请运行 **"Workbuddian: 在主编辑区打开大面板"** 命令。
3. 输入消息后按 **Enter** 发送；**Shift + Enter** 换行。
4. 顶部标签可切换对话，点击 **+** 新建对话。
5. 如需手动指定 CodeBuddy CLI 路径，进入 **设置 → Workbuddian**。

## 前置条件

1. 已安装 **WorkBuddy 桌面版**（≥ 5.0.5）
2. 已安装 **Obsidian**（≥ 1.7.2）

## 首次使用：环境初始化

如果插件无法自动找到 CodeBuddy 或 Node.js，将以下提示词**完整复制**到 WorkBuddy 对话中执行一次即可：

---

请帮我配置 Workbuddian 插件的运行环境，步骤如下：

1. 搜索 WorkBuddy 安装目录下的 `vendor/node.zip`（常见位置：`C:\Program Files\WorkBuddy`、`D:\Program Files\WorkBuddy`、`%LOCALAPPDATA%\Programs\WorkBuddy`）

2. 如果 `~/.workbuddy/binaries/node/versions/` 下还没有可用的 node.exe，将 node.zip 里的 `node-v*-win-x64/` 目录解压，把其中的文件复制到 `~/.workbuddy/binaries/node/versions/{版本号}/`（版本号从目录名提取，如 `22.22.2`）

3. 执行 `~/.workbuddy/binaries/node/versions/{版本号}/node.exe --version` 确认可用

4. 可选：同样处理 `vendor/PortableGit.zip`

完成后告诉我环境是否就绪。

---

执行完毕后，重启 Obsidian，Workbuddian 即可正常使用。

## 功能

- Obsidian 侧边栏聊天面板，支持多轮对话
- 流式输出，实时显示文字
- 可折叠的思考过程与工具调用卡片
- Assistant 消息 Markdown 渲染（代码块、表格、列表、引用）
- Vault 感知的上下文注入
- 会话管理，重启后恢复对话历史
- CodeBuddy CLI 和 Node.js 路径自动发现（Windows 和 macOS）
- 设置中可配置 CLI 路径
- 真实的停止生成按钮，可中断长时间运行的 LLM 回复
- 双击对话标签页标题可快速重命名
- 右键菜单支持导出对话至笔记或复制至剪贴板
- 全文搜索对话标题和消息内容
- @ 笔记引用选择器，快速插入金库笔记并自动作为上下文
- 聊天默认在侧边栏以标准标签形式打开（不再和其他面板堆叠分割）；通过单独的命令可改为在主编辑区打开为全宽标签页

## 自动发现

插件启动时自动搜索以下位置：

| 搜索目标 | Windows 路径 |
|----------|-------------|
| WorkBuddy 安装 | `%LocalAppData%\Programs\WorkBuddy\...`、`%ProgramFiles%\WorkBuddy\...`、C/D/E 盘全覆盖 |
| npm 全局安装 | `%AppData%\npm\codebuddy.cmd`、`%ProgramFiles%\nodejs\...` |
| 系统 PATH | 遍历 `PATH` 中每个目录查找 `codebuddy.cmd` / `codebuddy.exe` |
| WorkBuddy 自带 Node | `~/.workbuddy/binaries/node/versions/*/` |
| 多盘符 Node | `C:\Program Files\nodejs`、D 盘、E 盘 |

## 故障排查

| 现象                          | 原因                       | 解决                         |
| --------------------------- | ------------------------ | -------------------------- |
| `找不到 codebuddy CLI`         | 自动检测未找到（如自定义安装路径） | 在插件设置中手动填写路径。默认路径：`WorkBuddy安装目录\resources\app.asar.unpacked\cli\bin\codebuddy`。右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录 |
| `找不到 Node.js 来运行 codebuddy` | Node.js 未正确配置            | 完成上方的「环境初始化」               |
| 一直显示「思考中」              | 流式结束未清理占位元素           | 已在 v1.0.11 修复                |
| 重启后对话丢失                 | chatView 未正确持有导致无法加载历史 | 已在 v1.0.11 修复                |

## 权限授权

插件需要 CodeBuddy 对 Vault 有读写权限才能正常工作。如果使用时提示权限不足，将 `提示词-发给workbuddy让它给buddybridge授权.md` 的完整内容发送给 WorkBuddy/CodeBuddy 执行一次即可。

完成后**完全退出** WorkBuddy/CodeBuddy（系统托盘右键退出），重新打开即可生效。

## 设置

| 设置项              | 说明                             | 默认值 |
| ------------------ | ------------------------------- | --- |
| CodeBuddy 路径       | CLI 可执行文件路径（留空自动检测）        | 自动  |
| CLI 超时时长（分钟）   | 单次响应最长等待时间，超时强制中断         | 5   |
| 手动指定 Node.js 路径 | 留空自动探测；探测失败时手动指定 node 完整路径 | 自动  |
| 模型                | CodeBuddy CLI 使用的模型            | auto |
| 注入 Vault 上下文     | 每次消息附上当前 Vault 路径             | 开   |
| 注入当前笔记链接        | 每次消息附上当前笔记标题+路径（不含正文）      | 关   |

## 开发

```bash
npm run dev    # 开发构建
npm run build  # 生产构建
npm test       # 运行测试
```

## 许可证

MIT
