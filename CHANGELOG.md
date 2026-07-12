# Changelog

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
