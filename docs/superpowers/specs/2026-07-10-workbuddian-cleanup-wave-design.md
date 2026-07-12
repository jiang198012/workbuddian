# workbuddian 净化波（1a 后文件内部拆分）— 设计文档

## 背景与范围

1a（`docs/superpowers/plans/2026-07-10-workbuddian-phase1a.md`，已完成 merge 回 main `bc008e8`）采用「粗搬先行」：8 个文件整体搬进 Claudian 式分层目录 + 改名 Workbuddian，**文件内部未拆**。净化波做这些推后的内部拆分——纯重构、**零行为变化**，与 1a 同性质。

**三项**（原计划有第四项「types 拆设置」，经 spec 自查因循环依赖排除——见「明确不做」）：

1. `chat.ts`（现 `src/features/chat/view.ts`，681 行紧耦合 ItemView）拆 view/render/tabs/input。
2. `api`（`src/providers/codebuddy/index.ts`）拆路径函数到 `utils`。
3. context 抽纯函数到 `core/context`。

**核心原则**：零行为变化。所有拆分只移动/重组代码，不改任何逻辑。验证方式与 1a 相同：`npm test`（100/2 基线）+ `build` + 真机手动回归。

## 关键决策（本轮 brainstorming 用户拍板）

- **chat.ts 彻底拆成职责模块**（非保守抽取）：`view.ts` 保留类 + 所有字段（单一 owner）+ 生命周期；render/tabs/input 各抽成独立函数模块，接受 `view` 实例。
- **types 不拆**：自查发现 `normalizePersistedData`→`migrateSettings`→`DEFAULT_SETTINGS` 依赖链，强拆会重新引入循环（见「明确不做」）。
- **拆分顺序先易后难**：context → api → chat。

## 拆分方案

### ① chat.ts 拆 view/render/tabs/input

**拆法机制**（TS 类不能跨文件拆，故用「主类 + 职责函数模块」）：
- `view.ts` 的 `WorkbuddianChatView` 类**保留所有实例字段**（`manager`/`api`/`settings`/`messageContainer`/`inputEl`/`atSuggestEl`/`sendBtn`/`tabBar`/`searchInput`/`isStreaming`/`streamingMsgId`/`activeRename`/`activeConvId`/`markdownComponent`/`loadDataCallback` + `vaultPath` getter）——字段是单一 owner，避免在多文件间切分共享状态。
- render/tabs/input 各文件导出独立函数，签名形如 `export function renderMessages(view: WorkbuddianChatView): Promise<void>`，函数体里原来的 `this.field` 改成 `view.field`、`this.method()` 改成 `moduleFunc(view)`。
- `view.ts` 里原来的方法调用（如 `this.renderMessages()`）改成模块函数调用（`renderMessages(this)`），并 import 对应模块。
- `onOpen`（生命周期，留 `view.ts`）里搭建 DOM 并绑定的事件回调，改成调用模块函数：如 `this.inputEl.onkeydown = (e) => handleKeydown(this, e)`、`this.sendBtn.onclick` 里读 `this.isStreaming` 决定 `sendMessage(this)` 或 `this.api.cancel()`。
- 模块间按现有调用关系互相 import（esbuild 对函数级循环 import 无碍，实施时按 explore 的实际调用关系接线）。

**方法归属映射**（基于 explore 逐成员分类）：

| 文件 | 方法 |
|---|---|
| `view.ts`（类+字段+生命周期） | `getViewType`/`getDisplayText`/`getIcon`/`onOpen`/`onClose`/`loadConversations`（公开）+ `vaultPath` getter + 构造函数 |
| `render.ts` | `renderMessages`/`renderMessage`/`renderThinkingIndicator`/`renderMarkdownContent`/`scrollToBottom` |
| `tabs.ts` | `renderTabs`/`createNewChat`/`switchToChat`/`deleteChat`/`beginRenameTab`/`showTabContextMenu` |
| `input.ts` | `sendMessage`/`handleKeydown`/`adjustTextareaHeight`/`updateAtSuggest`/`insertAtReference`/`buildReferenceBlock`/`buildCurrentNoteLink` |

`view.ts` 已有的 `VIEW_TYPE_CHAT` 导出保持。CSS class 字符串（`workbuddian-*`）随所在方法移动，不改内容。

### ② api 拆 utils（`providers/codebuddy/index.ts` → 拆出 `utils/cliPath.ts`）

- **移到** `utils/cliPath.ts`：`findNodeExecutable`、`resolveCodebuddyPath`（两个磁盘探测函数）+ 它们用到的模块级常量 `NODE_EXECUTABLE`。
- `providers/codebuddy/index.ts` import 这两个 from `../../utils/cliPath`。
- `tests/api.test.ts` 直接 import 了 `resolveCodebuddyPath`/`findNodeExecutable`——改从 `../src/utils/cliPath` import（其余 `CodebuddyProvider` 等仍 from `../src/providers/codebuddy`）。
- `isWindowsWrapper`/`isBareFallback`/`needsWindowsShell`（纯判断，门控 spawn）留 `providers/codebuddy`（它们是 CLI 调用逻辑的一部分，非磁盘探测）。

### ③ context 抽纯函数（从 `view.ts` sendMessage 抽到 `core/context/assembleContext.ts`）

- 新建 `core/context/assembleContext.ts`，导出纯函数：
  ```
  assembleContextText(text: string, vaultPath: string | undefined,
    injectVaultContext: boolean, currentNoteLink: string, referenceBlock: string): string
  ```
  内容 = view.ts sendMessage 现有 L535-556 的拼装逻辑（vault 路径块 + 当前笔记链接块 + @引用块的条件拼接），**逐字搬**，无行为变化。
- `input.ts` 的 `sendMessage`（chat 拆分后 context 拼装在这里）改为：取数（`buildReferenceBlock`/`buildCurrentNoteLink`/`vaultPath`）后调用 `assembleContextText(...)`。
- **补单测** `tests/assembleContext.test.ts`：锁定当前拼装输出（4 个开关组合 + 空值），确保重构前后一致。这是净化波唯一新增的测试。

## 拆分顺序（先易后难，每步独立可验证）

1. **context**（最独立，纯函数+新单测）→ `npm test` 新测试绿 + 现有 100/2 不变。
2. **api 拆 utils** → `npm test` api 测试绿。
3. **chat 拆 4 块**（最大、最易回归）→ `build` + 真机手动回归（无自动化测试）。

context 必须先于 chat：chat 拆分后 `input.ts` 的 `sendMessage` 要调用已抽出的 `assembleContextText`。

## 验证策略

- **纯逻辑**（context/api）：Jest 兜底，每步跑绿。context 新增单测锁定拼装行为。
- **UI**（chat 4 块）：无自动化测试，靠 `build` 通过 + 真机手动回归（对照 1a 的 16 项清单）。
- **零行为基线**：净化波前后，除文件位置/组织，用户可观察行为逐项一致。
- 独立 tsc 检查用 `./node_modules/.bin/tsc`（本机 rtk hook 会改写 `npx tsc` 掩盖真错）。

## 明确不做

- **types 拆设置到 `features/settings`**（原计划第四项）：spec 自查发现 `normalizePersistedData`（通用持久化 normalize）第 11 行调 `migrateSettings`，而 `migrateSettings` 用 `DEFAULT_SETTINGS`；把 `migrateSettings`/`DEFAULT_SETTINGS` 移到 `features/settings` 会让留在 `types/` 的 `normalizePersistedData` 反向 import → `types → features/settings` 循环。把 `normalizePersistedData`（持久化规整，不只设置）一并移到"设置"模块又语义错位。收益小（设置逻辑不大），故不做，`migrateSettings`/`DEFAULT_SETTINGS`/`CURRENT_SETTINGS_VERSION` 保持在 `types/index.ts`。
- 任何行为改动/增强（净化波只重组，不改逻辑）。
- 步骤 1b（双向流+审批地基）、阶段 2+（Plan Mode/Inline Edit/MCP 等）——后续独立工作。
- `getErrorMessage` 在 `providers/codebuddy` 是 explore 查出的死导入——净化波可顺手删这一行（本波"清理"的自然一部分，零风险），不做其他未列出的清理。

## 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| chat 拆分 `this`→`view` 改写面大、易漏 | 中高 | 逐模块抽、每抽一块 build+grep 验证模块函数里无残留 `this.`；最后完整手动回归 |
| 模块间调用关系接错（render/tabs/input 互调） | 中 | 按 explore 的实际调用关系接线；build 的 tsc 会抓未定义引用 |
| context 抽取不慎改了拼装行为 | 中 | 先写单测锁定当前输出，再抽，比对前后一致 |
| api 拆分漏改某处 import | 低 | 每步 grep 旧路径残留 + build 验证 |
