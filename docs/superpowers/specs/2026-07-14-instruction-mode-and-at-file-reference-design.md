# 指令模式 `#` + @ 引用扩展 — 设计文档

日期：2026-07-14
状态：已确认，待写实现计划

## 目标

补齐两处 Claudian 差距，均为纯前端（不依赖 CLI 新能力）：

1. **指令模式 `#`**：全局常驻自定义指令（AI 人设/规则），注入到每条消息的最前置块。
2. **@ 引用扩展**：`@` 从「仅 markdown 笔记」扩到「任意 vault 文件」。

## 非目标（YAGNI）

- 不做每对话独立指令、不做指令模板库。
- 不做文件夹 `@`、不做外部目录。
- 不改 Plan Mode / MCP（依赖 CLI，另议）。

## 核心决策（brainstorm 结论）

- 指令**全局持久**（存 settings，所有对话通用）。
- 交互：聊天框输 `#...` → 回车 → **弹窗**预填（现有指令 + 刚输文字）→ 编辑/确认 → 保存；弹窗取消**非破坏**（输入保留可正常发）。工具栏加 `#` 指示按钮（有指令时高亮、点击可改/清）。
- 指令作为 `assembleContextText` 的**最前置块**注入**每条**消息（改指令即时生效）。
- `@` 扩到任意文件：**md → 读正文嵌入（照旧）**；**非 md → 加进 `view.attachments`（附件路径，CLI 读）**，显示附件 chip，不插 `@[[]]` 文本。

## 架构与分层

遵循仓库约定：纯逻辑放 `src/shared/` / `src/core/`（可单测、不 import `obsidian`）；DOM/弹窗在 `features/chat/`（不写测试）。

### 新增 `src/shared/instruction.ts`（纯逻辑，可单测）

- `parseInstructionInput(text: string): string | null` —— `text` 去空白后以 `#` 开头则返回其后的指令文本（trim；可能为空串表示"打开弹窗但无预填新增"）；否则 `null`。
- `buildInstructionBlock(instruction: string): string` —— 指令非空 → 返回带标识的前置块（如 `[用户常驻指令]\n<instruction>`）；空 → `''`。

### 修改 `src/core/context/assembleContext.ts`

- `assembleContextText(...)` 增参数 `customInstruction: string`，把 `buildInstructionBlock(customInstruction)` 作为**最前面**的块拼接（在 vault 前缀之前），用 `---` 分隔。

### 修改 `src/types/index.ts`

- `WorkbuddianSettings` 加 `customInstruction: string`（默认 `''`）。
- `migrateSettings` 补默认值，`CURRENT_SETTINGS_VERSION` +1。

### 视图层（不写测试）

- **新增 `src/features/chat/instructionModal.ts`**：一个 Obsidian `Modal`，多行文本框预填当前/待加指令，Save / Cancel；Save → 写 `settings.customInstruction` + `saveSettings` + 刷新指示。
- **修改 `src/features/chat/input.ts`**：
  - `sendMessage`：若 `parseInstructionInput(text)` 非 null → 打开 instructionModal（预填「现有指令 + 新文字」）、**不发送**、不清输入；取消则原样保留。
  - `updateAtSuggest`：`getMarkdownFiles()` → `getFiles()`；候选显示文件名（带扩展名/路径提示）。
  - `insertAtReference`：按 `file.extension === 'md'` 分流——md 插 `@[[basename]]`（照旧）；非 md → 绝对路径 `push` 进 `view.attachments`、`renderAttachmentChips`、清 `@` 输入残留、不插 `@[[]]`。
- **修改 `src/features/chat/view.ts`**：`buildUI()` 工具栏加 `#` 指示按钮（`hash` 图标）；`settings.customInstruction` 非空时加高亮类；点击打开 instructionModal。

## 数据流

### 指令模式 `#`

1. 输 `#定个规则` → 回车 → `sendMessage` 检测 → 打开 modal（预填 `现有指令 + "定个规则"`）。
2. 编辑 → Save → `settings.customInstruction = 值` → `saveSettingsCallback()` → 指示按钮高亮。
3. 之后每条消息：`sendText` 里 `assembleContextText(..., view.settings.customInstruction)` 把指令作为最前置块注入。

### @ 引用扩展

1. 输 `@` → 下拉列全部 vault 文件（按 query 过滤）。
2. 选中：md → 插 `@[[名]]`（`buildReferenceBlock` 读正文）；非 md → 路径进 `attachments`（`buildAttachmentBlock`/`attachmentDirs` 照旧）。
3. 发送链路不变。

## 错误处理 / 边界

- `#` 后为空（只输 `#` 回车）→ 打开弹窗、预填现有指令，供纯编辑/清空。
- 弹窗 Cancel → settings 不变、输入框内容保留。
- 指令存空串 → 视为清除，指示按钮熄灭，`buildInstructionBlock` 返回 `''`（不注入）。
- @ 非 md 去重按绝对路径（沿用 `view.attachments.includes`）。
- 用户确实想发 `#` 开头的消息：因弹窗非破坏，取消后可编辑规避（已接受此边缘情况）。

## 测试

- 新增 `tests/instruction.test.ts`：`parseInstructionInput`（`#foo`→`foo`、`# foo `→`foo`、`#`→`''`、`foo`→`null`、前导空白）、`buildInstructionBlock`（空→`''`、非空→含指令文本的块）。
- 更新 `assembleContext` 测试：带 `customInstruction` 时前置注入、空时不变。
- 视图层（#弹窗 / @分流 / 指示按钮）不写测试，`npm run build` + 手动验证。

## i18n

新增文案走 `STRINGS` + `t()`：指令弹窗标题/占位/Save/Clear、`#` 指示按钮 tooltip（有/无指令两态）。

## 涉及文件

- 新增：`src/shared/instruction.ts`、`tests/instruction.test.ts`、`src/features/chat/instructionModal.ts`
- 修改：`src/core/context/assembleContext.ts`（+ 其测试）、`src/types/index.ts`、`src/features/chat/input.ts`、`src/features/chat/view.ts`、`src/i18n/index.ts`、`styles.css`
