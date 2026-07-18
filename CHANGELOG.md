# Changelog

## v1.2.2 — 2026-07-17

### 修复
- **中文输入法 Enter 误发送**：输入法组字（有候选）时按 Enter 只确认候选、不再发送消息；候选为空时 Enter 才发送（Shift+Enter 换行不变）。判断抽为纯函数 `shouldSendMessage`（`isComposing || keyCode 229`），含 6 个单测。

### 新增
- **消息复制按钮**：每条消息鼠标悬停时，气泡下方浮出复制按钮，一键复制该消息原文；图标短暂变 ✓ 反馈，中英双语。

## v1.2.1 — 2026-07-17

### 修复
- **`spawn ENAMETOOLONG`（Windows）**：针对大笔记 / 大 `@` 引用提问时，整段 prompt 曾作为命令行位置参数传给 CodeBuddy CLI，超出 Windows 命令行长度上限（cmd.exe 8191 / CreateProcess 32767 字符）导致 spawn 失败、无法提问。改为经 **stdin** 传入 prompt（CLI 默认 `--input-format text` 从标准输入读），命令行只剩固定 flag，彻底消除长度限制，笔记多大都不再报错。(#3)

### 内部
- 品牌命名统一：清理面向用户文档与运行日志前缀里的历史项目名残留（`LICENSE` / `NOTICE` 的 MIT 归属致谢按许可证要求保留），并移除改名重构阶段的历史过程文档。

## v1.2.0 — 2026-07-14

### 新增
- **指令模式 `#`**：聊天框输 `#你的规则` 设一条**全局常驻指令 / 人设**，作为最前置块注入每条消息、对所有对话生效；弹窗可编辑，工具栏 `#` 按钮指示 / 编辑 / 清除。新增纯逻辑 `shared/instruction`（含单测），settings 升 v9。
- **`@` 引用扩展到任意文件**：从「仅 markdown 笔记」扩到任意 vault 文件——md 读正文嵌入，非 md 作附件路径交 CLI 读。
- README 重构：What's New 打头、功能亮点、致谢下沉。全量 253 测试全绿。

## v1.1.0 — 2026-07-13

### 新增
- **图片粘贴 / 拖拽 + 视觉**：聊天输入框支持 `Cmd+V` 粘贴截图、从访达拖拽图片文件。粘贴图落盘到 vault 内 `.obsidian/plugins/workbuddian/pasted/`（保留最近 20 张），以缩略图 chip 展示，交 CodeBuddy CLI 做视觉分析。新增纯逻辑模块 `shared/imageStore`（含单测），全量 241 测试全绿。

## v1.0.0 — 2026-07-13

首个面向 Obsidian 社区插件市场的稳定版：manifest 描述精简（只讲功能、≤250 字）、`authorUrl` 指向作者主页、去掉 console 噪音、README 增补「与同类插件的差异说明」。

## v0.4.0 — 2026-07-12

逐字流式 / 附件外部读取 / i18n 即时切换 / 设置页重构 / 标签右键菜单。

## v0.3.0 — 2026-07-12

输入区工具栏重构 + 选区注入 + 默认配色 + 界面语言；首个对外开源版本。

### 新增
- **输入区重构**：输入框改为带边框容器 + 框内底部工具栏，发送键改小图标（流式时变停止图标）。
- **模型下拉**：工具栏内点击弹出模型菜单，切换即持久化（复用 `MODEL_OPTIONS`）。
- **附件**：系统文件选择器挑任意文件 → 可删 chips → 发送时注入绝对路径，交 CLI 用文件工具读取（`shared/attachments`）。
- **授权模式**：工具栏盾牌菜单「默认 / 完全访问」，透传 `--permission-mode`；完全访问时盾牌带感叹号（`shield-alert`）。
- **4.1 上下文用量**：实测 CLI `result.usage.input_tokens` 提供数据（后因占地移除展示，采集层保留）。
- **选区注入**：追踪 `lastMarkdownView`，笔记选中即实时显示选区 chip，发送时作只读上下文注入（`shared/selection`）。
- **界面语言设置**：外观组下拉 Auto（跟随 Obsidian）/ 中文 / English（`applyLang`）。

### 改进
- **默认配色**：默认强调色改土黄 `#C8B487`（`primaryColor` 为空时的 CSS fallback，仍可自定义覆盖）；强调底文字（用户气泡 / 激活标签）改黑。
- **设置页精简**：模型 / 授权已在工具栏前台，设置页移除重复项。
- 理顺版本：`versions.json` 清理为 0.x 映射，`manifest`/`package.json` 补作者与仓库地址。

### 测试
- 189 项测试全绿（v0.2.0 的 156 → 189），新增 `attachments`/`contextUsage`/`selection`/`cliOptions` 等纯逻辑单测；全程 TDD。

## v0.2.0 — 2026-07-11

第四阶段长任务收官版本。

### 新增
- **3.2 斜杠命令安全透传**：`/clear` 本地新建对话，其余 `/` 命令跳过 context 注入原样透传给 CLI。
- **3.3 输入 `/` 自动补全**：内置命令表 + 扫描 vault `.codebuddy/commands/**/*.md` 自定义命令（`commandNameFromPath` + frontmatter）。
- **1.3 友好错误卡片 + 重试**：错误以卡片呈现（⚠️ + [重试] [打开设置]）；`sendMessage` 解耦出 `sendText`，重试经 `deleteLastExchange` 重发。
- **2.2 导入/导出设置**：`exportSettings` 复制 JSON / 粘贴导入走 `migrateSettings` 容错。
- **4.2 文件引用 chips**：`@[[note]]` 在输入框上方可视化为可删除 chip（`renderReferenceChips` + `removeAtReference`）。
- **4.3 Inline Edit + Diff**：命令「用 CodeBuddy 编辑选区」→ 指令 Modal → 调 CLI → `lineDiff`(LCS) 行级 diff Modal → 接受写回。
- **4.4 i18n 中 / 英**：`src/i18n/index.ts` 98 个中英字典 key + `t()`，`initLang` 跟随 Obsidian 界面语言（发给 CLI 的 prompt 与 `[WB]` 日志保持中文）。

### 决策
- 3.4 交互式命令：暂缓（插件侧再造命令 UI 收益低）。
- 4.5 移动端：砍（`child_process.spawn` 本地 CLI，移动端不可行）。
- 4.1 上下文用量：待 CLI 提供 token 数据再做。

### 测试
- 156 项测试全绿（v0.1.0 的 107 → 156），含 `lineDiff`/`editPrompt`/`slashCommand`/i18n 等纯逻辑单测。

## v0.1.0 — 2026-07-11

首个入库版本。

### 新增
- 品牌小猪图标（原图 base64 内嵌，ribbon 按钮 + 侧边栏 tab）。
- **2.1 自定义主色调**：设置页原生取色器 + 「恢复默认」，`--workbuddian-primary` 经 `document.body` 单点注入，CSS `var(--workbuddian-primary, var(--interactive-accent))` 回退。
- **3.2 斜杠命令安全透传**：`parseSlashCommand`；`/clear` 本地新建对话，其余 `/` 命令跳过 context 注入原样透传给 CLI。
- **3.3 输入 `/` 自动补全**：内置命令表（`BUILTIN_SLASH_COMMANDS`）+ `extractSlashQuery`/`filterSlashCommands`，复用 @ 补全下拉。

### 改进
- **2.2 设置页重构**：按「CodeBuddy 连接 / 上下文注入 / 外观」分组 + 底部「重置为默认」（二次点击确认），`onload` 与重置复用 `applySettingsToApi()`。
- **1.3 友好错误卡片 + 重试**：`ChatMessage.isError` + `renderErrorCard`（⚠️ 图标 + 文案 + `[重试] [打开设置]`）；`sendMessage` 解耦出 `sendText`，重试经 `deleteLastExchange` 重发最近一次出错的消息。

### 测试
- 135 项测试全绿（`parseSlashCommand`/`extractSlashQuery`/`filterSlashCommands`、`ConversationManager` 的 `setError`/`deleteLastExchange` 等纯逻辑）。

### 备注
- ROADMAP 3.4 交互式命令暂缓（评估收益低）；`.codebuddy/commands` 自定义命令扫描 YAGNI 暂缓。
