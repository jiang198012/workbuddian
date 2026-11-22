# Workbuddian 文档全面更新与搜索增强：设计

日期：2026-11-22（基于 2.6.22 / 提交 `d6a2cb7` 的代码）

## 1. 为什么做

- **文档陈旧，多处与现有功能不符。** README 是按版本逐次追加的，「快速开始」前面堆着 2.6.12–2.6.22 的版本说明和 Issue #10 的历史，「What's New」列了 40 多个版本。有几处描述和代码相反（见第 6 节），会把用户引到错误方向。
- **插件市场搜「Hermes」找不到我们。** 搜「workbuddy」能找到，只是因为插件名 Workbuddian 包含这个词。Obsidian 插件目录的描述来自 community.obsidian.md 开发者后台，当前是提交时填的英文功能列表，没有 Hermes；`manifest.json` 的描述也没有 Hermes，而且发新版本不会同步到目录描述（2.6.x 多次发版后目录描述仍是旧文本）。

## 2. 目标

1. **准确**：README 中英文里的每一条功能、设置、默认值、路径和命令都与当前代码一致。
2. **好用**：README 回到「产品介绍 + 上手指南 + 使用参考」，新用户读完前一屏就知道它是什么、支持哪些后端、怎么开始。
3. **双语完整**：英文 README 与中文内容对等，不再是「精简入口页」。
4. **好找**：在 Obsidian 插件目录、GitHub、搜索引擎里搜 Hermes、Hermes Agent、CodeBuddy、WorkBuddy、AI agent、AI chat 等词时能找到本插件。

## 3. 非目标

- 不改 `docs/` 下的测试报告、排查记录、设计文档（内部资料）。
- 不改 CHANGELOG 已有条目的内容（只在需要时补入 README 独有、CHANGELOG 缺失的事实）。
- 不改功能代码。除文档外，仓库里只改 `manifest.json` 与 `package.json` 的 `description`。
- 不删除、不改写 `提示词-授予Vault读写权限.md`。
- 不重录 GIF、不重拍截图（截图是否过时另行判断，见第 8 节）。
- 不改用户正在编辑的 `CLAUDE.md`，不提交 `docs/issue-10-native-async-contract-2026-10-09.md`。
- 不改 GitHub 仓库简介和 topics（已包含 `hermes`、`hermes-agent`）。

## 4. 反目标（做到了也算失败）

- 把未验证的说成已验证（例如 Windows 上的 Hermes、黑窗口、`gateway.pid`）。
- 为了搜索堆砌关键词，读起来像广告或垃圾内容。
- 删掉版本历史时丢信息：README 里独有、CHANGELOG 没有的事实，必须先补进 CHANGELOG 或对应的 `docs/` 报告再删。
- 中英文内容不一致，或文案里的界面名称和实际界面不一致。
- 在用户确认最终文本之前，改动插件目录的公开描述。

## 5. 已定下的部分（用户的决定）

- 方向：README 回到「产品介绍 + 上手指南」；版本历史全部挪到 CHANGELOG；英文 README 补成和中文一样完整。
- 搜索增强要覆盖插件目录描述，Hermes 必须出现在里面。
- 范围：中英文 README、插件目录描述（及后台标签）、`manifest.json` 描述；另含 `llms.txt`、`package.json` 的 `description`、`docs/images/README.md`（2026-11-22 用户确认扩大范围）。
- 「快速开始」里「把 `提示词-授予Vault读写权限.md` 发给 WorkBuddy/CodeBuddy 执行」这一步从 README 删除；该文件本身不动（用户确认）。
- 插件目录描述用 B 版（用户确认，见 7.2）。

## 6. 已核对出的不符与缺失（以代码为准）

### 6.1 与现有功能不符

| # | README 现状 | 实际（依据） |
|---|---|---|
| 1 | 「自动发现」「快速开始」写自动检测只选 WorkBuddy 内置 CLI，不会选独立 npm CLI | 2.6.19 起优先官方 CodeBuddy CLI，未找到才回退 WorkBuddy 内置 CLI（`src/utils/cliPath.ts` `resolveCodebuddyPath`） |
| 2 | 功能表写 Hermes 是「gateway 纯对话」；发现只写 `~/.hermes` | 2.6.0 起 Hermes 走 ACP 全能力（工具、批准卡、思考、用量、分叉），HTTP 轻量模式只在本机 CLI 不可用或填了远程 gateway 时兜底（`src/providers/hermes/index.ts`）；配置目录依次 `HERMES_HOME` → `%LOCALAPPDATA%\hermes` → `~/.hermes`（`src/shared/hermesDiscover.ts`）；Hermes CLI 查找见 `resolveHermesPath` |
| 3 | 设置表缺项、分组不对 | 实际分组与项目见 6.3 |
| 4 | 盾牌按钮切「默认 / 完全访问」 | 三种：默认 / 计划 / 完全访问（`PERMISSION_MODE_CHOICES`，`src/shared/cliOptions.ts`） |
| 5 | 快速开始只讲 WorkBuddy 原生通路 | 三条路：官方 CodeBuddy CLI（设置页/命令面板「登录 CodeBuddy」浏览器一键登录）、WorkBuddy 桌面端内置 CLI（桌面端保持登录运行，不支持一键登录）、Hermes Agent |
| 6 | FAQ：「找不到 Node.js 就跑环境初始化提示词」；「重启后对话丢失？已修复」；「按路径总是允许」 | 官方 CodeBuddy CLI 用 `npm i -g @tencent-ai/codebuddy-code` 安装，插件也用找到的 Node 启动它，所以这条路需要 Node.js；只有 WorkBuddy 桌面端内置 CLI 用它自带的运行时。对话本来就持久化；批准卡按钮叫「总是允许」，「始终允许此路径」是 vault 外附件的确认 |
| 7 | 「jest，617 项」 | 807 项（2.6.22） |
| 8 | 英文 README 的 Obsidian 徽章参数 `Obsidian-plugin-market-blue` 错误 | 需修正；市场链接 `https://obsidian.md/plugins?id=workbuddian` 在新目录下是否仍有效需核实，失效则换成 community.obsidian.md 的条目地址 |

### 6.2 现有但未写进 README 的功能

- 内联编辑：选中文字后 `Ctrl/Cmd+Shift+E` 或右键「Workbuddian编辑」，选区上方浮动工具条（`inline-edit-floating`）；另有「用 CodeBuddy 编辑选区」命令。
- 会话模板：新建对话可选写作助手 / 翻译助手 / 代码审查 / 笔记整理（`src/shared/chatTemplates.ts`）。
- 消息操作：用户消息「编辑并重发」，助手回复「重新生成」、插入当前笔记、保存为新笔记；代码块复制 / 插入 / 存为笔记。
- 会话管理：标签 × 只关闭不删除、`/resume` 找回、搜索、置顶、重命名、分叉、右键删除（带条数与不可撤销提示）、导出当前/全部会话为笔记、自动标题。
- 斜杠命令：`/clear` `/compact` `/context` `/cost` `/effort` `/resume` `/status`，Skills，`.codebuddy/commands` 自定义命令，CLI 透传命令。
- 上下文用量环、「CodeBuddy 插件」管理（设置页底部）、12 个命令面板命令（`src/main.ts`）。
- 「安装 WorkBuddy 本地连接扩展」命令仍注册、仍可用，但 2.6.14 起不再必需；它在用户确认后写入 `<WorkBuddy 配置目录>/extensions/workbuddian-warmup`（`src/providers/codebuddy/workbuddyWarmup.ts`）。
- 输入框高度自动调整与上下限。

### 6.3 设置页实际结构（`src/features/settings/tab.ts`，按显示顺序）

- **通用**：界面语言（Auto 跟随 Obsidian，Obsidian 未设语言时跟随系统 / 中文 / English）
- **后端连接**：后端（CodeBuddy / Hermes）；Hermes 时：运行模式、Hermes CLI 路径、Gateway 地址、API Key（高级）；CodeBuddy 时：CodeBuddy 路径、CodeBuddy 登录、手动指定 Node.js 路径；CLI 超时时长（默认 5 分钟）、思考力度（默认 enabled）、MCP 服务器（列表 + JSON）、子代理（JSON）
- **上下文注入**：注入 Vault 上下文（开）、注入当前笔记链接（关）、自动生成会话标题（开）、粘贴图保留数量（20）、输入框自动调整高度（开）、最小 / 最大高度
- **外观**：聊天主色调、上下文窗口上限（200000）
- **重置**、**导入 / 导出设置**、**日志**（查看日志）、**CodeBuddy 插件**
- 模型、权限模式、附件、模板、`#` 常驻指令、用量环在聊天输入框工具栏。

具体默认值以 `DEFAULT_SETTINGS`（`src/types/index.ts`）为准，写文档时逐项核对；Hermes 相关项只在后端为 Hermes 时显示，CodeBuddy 专属项同理。

## 7. 目标形态

### 7.1 README（中英文同构）

建议章节顺序（builder 可微调，但前一屏必须包含第 1–3 项）：

1. 标题、徽章（修正）、语言切换
2. 一段话介绍：把本地 AI agent——**Hermes Agent** 或 **CodeBuddy CLI**（含 **WorkBuddy** 桌面端内置 CLI）——接进 Obsidian，在 vault 里对话、`@` 引用笔记、批准工具调用、行级 diff 与撤销。仅桌面端（Windows / macOS）。
3. 演示 GIF 与截图
4. 功能亮点（按第 6 节更新）
5. 安装（插件目录 / BRAT / 手动）
6. 快速开始：先选后端，三条路各自几步即可发第一条消息
   - 官方 CodeBuddy CLI：前置 Node.js；安装命令、「登录 CodeBuddy」一键登录
   - WorkBuddy 桌面端：保持登录运行，路径留空自动检测；已知限制（若保留，须注明测得的 WorkBuddy 版本）
   - Hermes Agent：本机安装后留空自动发现；ACP 完整版与 HTTP 轻量模式的区别
7. 使用方法（对话、`@`、`/` 与 Skills、批准卡与三种权限模式、diff 与撤销、计划模式、分叉与双面板、内联编辑、模板、消息操作与写回笔记、会话管理、用量环）
8. 设置（按 6.3 重写）
9. 自动发现（CodeBuddy CLI 顺序、Hermes CLI 与配置目录、Node）
10. 安全与权限（去掉版本演进的历史叙述，保留「会访问什么、何时触发、怎么授权、怎么控制」；仍注册的「安装 WorkBuddy 本地连接扩展」命令要照实说明写到哪里、只在用户确认后安装、通常不需要）
11. 故障排查（未登录、只装桌面端、WorkBuddy 以管理员身份运行、轻量模式、找不到 CLI、找不到 Node.js、refusal、查看 `[WB]` 日志、Linux）；不再引导用户执行 `提示词-授予Vault读写权限.md`
12. 最新版本：一两行 + CHANGELOG 链接，不再列历史
13. 开发、相关项目、支持、License

README 顶部的 HTML 注释元数据保留并更新（含 Hermes 关键词）。

### 7.2 插件目录描述（community.obsidian.md 后台）

- 英文、以动词开头、句号结尾、250 字符以内（第三方资料的规范，官方文档未写明，按保守值执行）。
- 必须含 Hermes。用户已选 **B**（A 仅留作记录）：
  - **B**（217 字符）：Chat with a local Hermes Agent or the WorkBuddy/CodeBuddy CLI as an AI agent in your vault: streaming replies, tool-call cards, @-note references, attachments, slash commands, inline edit with diff, export and search.
  - **A**（213 字符）：Chat with local AI agents in your vault: WorkBuddy/CodeBuddy CLI or Hermes Agent. Streaming replies, tool-call and approval cards, @-note references, attachments, slash commands, inline edit with diff, and export.
- 后台标签：进入后台查看可选标签，有与 Hermes / AI agent 相关的就加上。
- 由用户登录后台；最终文本须用户确认后才发布。发布后核对 `obsidianmd/obsidian-releases` 的 `community-plugins.json` 条目与站内搜索结果。

### 7.3 其他描述文件

- `llms.txt`：按新 README 重写。标题与首段写明 Hermes Agent 与 CodeBuddy / WorkBuddy 双后端；不再称英文 README 为「精简入口」；删除环境初始化提示词与「WorkBuddy ≥ 5.0.5」等过时前提；链接只指向仍存在的章节与文件。
- `package.json` 的 `description`：改成与目录描述含义一致的一句话（提到 Hermes 与 CodeBuddy / WorkBuddy）。改 `package.json` 后不需要更新 `package-lock.json`（description 不进锁文件）。
- `docs/images/README.md`：按新 README 首屏的图片布局更新说明。

### 7.4 `manifest.json` 描述

改成与目录描述一致的英文文本（提到 Hermes）。只影响 Obsidian「已安装插件」列表里显示的描述，随下一个版本发出，不为此单独发版。

## 8. 约束

- 每一条事实以当前代码为准，写完逐项核对；界面名称取自 `src/i18n/index.ts` 的实际文案。
- 中文为主要读者，英文须与中文对等；英文文案中的界面名称用英文界面的实际文案。
- 未验证项照实写（例如 Windows 上的 Hermes）。
- 链接、锚点不能指向已删除的章节；README 之外指向 README 锚点的链接（如 `README.en.md` 指向 `README.md#快速开始`）要同步修改。
- 推送到 origin / GitHub、修改插件目录、发版均需用户另行同意。

## 9. 交给实现者决定的部分

- 具体措辞、章节内的组织方式、表格还是列表。
- 截图和 GIF 是否仍能代表当前界面：明显过时的在文档中标注为后续项，不在本次重拍。
- 关键词在正文中的自然分布（首段、功能表、快速开始标题）。
- README 中 Issue #10 相关的仍有效信息（如原生通路的时长与容量限制）保留到哪里、如何标注测得版本。

## 10. 设计者已定（供核对）

- 「安装 WorkBuddy 本地连接扩展」按当前可选功能处理：命令列表列出并标注「通常不需要」，安全章节说明写入位置与触发条件。
- 官方 CodeBuddy CLI 这条路的前置条件写「需 Node.js」；「找不到 Node.js」的 FAQ 按此回答。若写作时核实到官方另有不依赖 Node 的安装方式，再补充。
