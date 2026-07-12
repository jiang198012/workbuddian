# 1.3 友好错误卡片 + 重试 — 设计文档

- 日期：2026-07-11
- 阶段：ROADMAP 第一阶段 1.3
- 状态：已确认设计，待实现

## 目标

CLI / 网络错误时，以带图标的错误卡片呈现（而非纯文本 `错误: xxx`），并提供「重试」「打开设置」两个操作。

## 背景与现状

`input.ts` 里错误经 `updateMessage(convId, aiMsg.id, "错误: " + msg)` 存为普通 assistant 消息，`render.ts` 的 `renderMessage` 当作 markdown 渲染——无视觉区分、无操作入口。`ChatMessage` 只有 `id/role/content/timestamp`。

## 非目标

- 不改错误的产生机制（仍来自流式 `error` chunk / catch）。
- 不做自动重试 / 退避；重试仅手动、仅覆盖「最近一次出错的发送」。

## 设计

### ① 数据模型（`src/types/index.ts`）

`ChatMessage` 加可选字段 `isError?: boolean`。可选、且 `messages` 不经 `migrateSettings` → **无需迁移**（旧数据无该字段即普通消息）。

### ② ConversationManager（`src/core/session/manager.ts`）

- `setError(convId, msgId, content): boolean` —— 设 `msg.content = content`、`msg.isError = true`、`updatedAt`、持久化。
- `deleteLastExchange(convId): string | null` —— 当最后两条恰为 `user` + `assistant` 时，`splice` 删除这两条并返回 user 文本；否则（不足两条/顺序不符）返回 `null`。持久化。**纯逻辑，可单测。**

### ③ 错误产生点（`src/features/chat/input.ts`）

现有两处：
- 流式 `chunk.type === 'error'`：`updateMessage(..., "错误: " + chunk.content, true)` → 改为 `view.manager.setError(convId, aiMsg.id, chunk.content)`。
- `catch`：`updateMessage(..., "错误: " + message)` → 改为 `view.manager.setError(convId, aiMsg.id, message)`。

存原始文案（不加「错误:」前缀，标题/图标由卡片提供）。`new Notice(...)` 保留。

### ④ sendMessage 解耦出 sendText（`src/features/chat/input.ts`）

- `sendMessage(view)`：取 `inputEl` 文本、`/clear` 拦截、清空输入框 → 调 `await sendText(view, text)`。
- `sendText(view, text)`：现有发送主体（确保会话、`addMessage` user、占位 assistant、`parseSlashCommand` 决定 `contextText = slash ? text : assembleContextText(...)`、流式循环、错误改用 `setError`）。不碰 `inputEl`（重试时无输入框内容）。

### ⑤ 重试 + 打开设置（`src/features/chat/input.ts`）

- `retryLastMessage(view)`：`isStreaming` 时忽略；`deleteLastExchange` 取回上一条 user 文本 → `renderMessages` → `sendText(view, text)`。
- `openWorkbuddianSettings(view)`：`(view.app as any).setting?.open?.(); (view.app as any).setting?.openTabById?.('workbuddian');`（Obsidian 私有 API）。

### ⑥ 错误卡片渲染（`src/features/chat/render.ts`）

`renderMessage` 在 `isWaiting` 之后、assistant markdown 之前加分支：`msg.isError` → `renderErrorCard(view, bubble, msg)`。

`renderErrorCard`：卡片含 ⚠️ 图标（`alert-triangle`）+ 标题「出错了」+ 错误文案 + 按钮行 `[重试]`（→ `retryLastMessage`）`[打开设置]`（→ `openWorkbuddianSettings`）。`render.ts` 从 `./input` import 这两个函数（bundle 后同文件，循环 import 无碍）。

### ⑦ 样式（`styles.css`）

`.workbuddian-error-card`（`--text-error` 系边框/图标）、`.workbuddian-error-header/title/body/actions`、`.workbuddian-error-btn`。

## 测试

- `tests/manager.test.ts` 加 `deleteLastExchange` 用例：
  - user+assistant → 返回 user 文本，messages 清空。
  - 只有一条 → `null`。
  - 最后两条非 `user,assistant` 顺序 → `null`。
- `setError` 可顺带测（设 isError=true）。
- 渲染 / 重试 / 打开设置 obsidian 耦合，不测。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/types/index.ts` | `ChatMessage.isError?: boolean` |
| `src/core/session/manager.ts` | `setError` + `deleteLastExchange` |
| `tests/manager.test.ts` | 上述单测 |
| `src/features/chat/input.ts` | `sendText` 解耦、错误改 `setError`、`retryLastMessage`、`openWorkbuddianSettings` |
| `src/features/chat/render.ts` | `renderErrorCard` + `isError` 分支 |
| `styles.css` | 错误卡片样式 |

## 验收标准

1. 触发 CLI 错误（如把 CodeBuddy 路径改错再发消息）→ 显示错误卡片（图标 + 「出错了」+ 文案 + 两按钮），不再是纯文本 `错误: xxx`。
2. 点「重试」→ 删除该次出错的 user+assistant，用同一 user 文本重发，正常流式。
3. 点「打开设置」→ 打开 Workbuddian 设置页。
4. 普通成功消息渲染不变。
5. `npx jest` 全量绿（含 `deleteLastExchange` 用例）；`npm run build` 通过。

## 风险与缓解

- **重试语义仅覆盖"最近一次"**：`deleteLastExchange` 只认最后两条；错误若非最后一条，重试按钮仍重发最近一次（已知取舍，YAGNI）。
- **render↔input 循环 import**：esbuild 打成单文件、函数在渲染时才调用，无运行时循环问题。
- **`app.setting` 私有 API**：用可选链 `?.`，缺失时静默不炸。
