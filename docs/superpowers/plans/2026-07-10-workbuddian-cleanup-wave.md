# workbuddian 净化波（1a 后内部拆分）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** 把 1a 粗搬留下的大文件做内部拆分（context 抽纯函数、api 拆 utils、chat 拆 4 块），纯重构、零行为变化。

**Architecture:** 三项独立拆分，顺序 context → api → chat。前两项有 Jest 兜底；chat 拆一个 681 行紧耦合 ItemView，用「主类持字段 + 职责函数模块接受 view」的方式，靠 build + 真机手动回归验证零回归。

**Tech Stack:** TypeScript、esbuild、ts-jest、Obsidian API。

## Global Constraints

- **零行为变化**：只重组代码，不改任何逻辑。
- **明确不做**：types 拆设置（`normalizePersistedData`→`migrateSettings`→`DEFAULT_SETTINGS` 循环依赖，已排除）、任何行为改动/增强、步骤 1b、阶段 2+。
- **chat 拆法**：抽出的方法变 `export function name(view: WorkbuddianChatView, ...args)`，函数体 `this.field`→`view.field`、`this.method()`→`moduleFunc(view)`；`view.ts` 里调用改 `moduleFunc(this)` 并 import 对应模块；`onOpen` 事件回调改调模块函数。`view.ts` 保留类 + 所有实例字段 + 生命周期 + 被多模块共享的纯字段访问 helper（如 `getActiveConversation`）。
- **验证**：纯逻辑（context/api）每步 `npm test`（100/2 基线）跑绿；chat 无自动化测试，`npm run build` + 真机手动回归（对照 1a 的 16 项清单）。独立 tsc 检查用 `./node_modules/.bin/tsc --noEmit --skipLibCheck`（本机 rtk hook 改写 `npx tsc` 会掩盖真错）。
- **顺序**：context → api → chat（context 先，chat 拆分后 `input.ts` 的 `sendMessage` 要调 `assembleContextText`）。频繁 commit。

---

### Task 1: context 抽 assembleContextText 纯函数 + 单测

**Files:**
- Create: `src/core/context/assembleContext.ts`
- Create: `tests/assembleContext.test.ts`
- Modify: `src/features/chat/view.ts`（`sendMessage` L531-556）

**Interfaces:**
- Produces: `export function assembleContextText(text: string, vaultPath: string | undefined, injectVaultContext: boolean, currentNoteLink: string, referenceBlock: string): string`

- [ ] **Step 1: 写锁定当前行为的失败测试** `tests/assembleContext.test.ts`

```typescript
import { assembleContextText } from '../src/core/context/assembleContext';

describe('assembleContextText', () => {
    const VAULT_PREFIX = (vp: string, text: string) =>
        `当前 Obsidian Vault 路径: ${vp}\n工作目录即 vault 根目录，请基于 vault 中的文件回答问题。\n\n---\n\n${text}`;

    it('无 vault 注入时只返回原文', () => {
        expect(assembleContextText('hi', undefined, true, '', '')).toBe('hi');
        expect(assembleContextText('hi', '/v', false, '', '')).toBe('hi');
    });

    it('vault 注入时加前缀块', () => {
        expect(assembleContextText('hi', '/v', true, '', '')).toBe(VAULT_PREFIX('/v', 'hi'));
    });

    it('追加当前笔记链接', () => {
        expect(assembleContextText('hi', undefined, false, '当前：《A》', ''))
            .toBe('hi\n\n---\n\n当前：《A》');
    });

    it('追加引用块', () => {
        expect(assembleContextText('hi', undefined, false, '', 'REF'))
            .toBe('hi\n\n---\n\nREF');
    });

    it('三段齐全按 vault→笔记→引用 顺序拼接', () => {
        expect(assembleContextText('hi', '/v', true, '当前：《A》', 'REF'))
            .toBe(VAULT_PREFIX('/v', 'hi') + '\n\n---\n\n当前：《A》\n\n---\n\nREF');
    });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- assembleContext`
Expected: FAIL（`assembleContextText` 未定义 / 模块不存在）

- [ ] **Step 3: 创建 `src/core/context/assembleContext.ts`（逐字搬 view.ts 现有拼装逻辑）**

```typescript
export function assembleContextText(
    text: string,
    vaultPath: string | undefined,
    injectVaultContext: boolean,
    currentNoteLink: string,
    referenceBlock: string
): string {
    let contextText = (vaultPath && injectVaultContext)
        ? `当前 Obsidian Vault 路径: ${vaultPath}
工作目录即 vault 根目录，请基于 vault 中的文件回答问题。

---

${text}`
        : text;
    if (currentNoteLink) {
        contextText = `${contextText}

---

${currentNoteLink}`;
    }
    if (referenceBlock) {
        contextText = `${contextText}

---

${referenceBlock}`;
    }
    return contextText;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test -- assembleContext`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: `view.ts` sendMessage 改用 assembleContextText**

顶部加 import：
```typescript
import { assembleContextText } from '../../core/context/assembleContext';
```
把 `sendMessage` 里 L534-556 那段（`let contextText = ...` 到三个 `if` 块结束）替换为：
```typescript
            const contextText = assembleContextText(
                text, this.vaultPath, this.settings.injectVaultContext, currentNoteLink, referenceBlock
            );
```
（L531-532 取 `referenceBlock`/`currentNoteLink` 的两行保留不动。）

- [ ] **Step 6: 全量验证**

Run: `npm test` → Expected: 100+5=105 passed / 2 failed（新增 5 个 context 用例）。
Run: `npm run build` → Expected: exit 0。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: extract assembleContextText pure function to core/context"
```

---

### Task 2: api 拆路径函数到 utils/cliPath.ts

**Files:**
- Create: `src/utils/cliPath.ts`
- Modify: `src/providers/codebuddy/index.ts`（删函数 + 加 import）
- Modify: `tests/api.test.ts`（import 改）

**Interfaces:**
- Produces: `utils/cliPath.ts` 导出 `findNodeExecutable(): string | null`、`resolveCodebuddyPath(customPath: string): string`

- [ ] **Step 1: 创建 `src/utils/cliPath.ts`，移入三项**

把 `providers/codebuddy/index.ts` 里的 `const NODE_EXECUTABLE`（L39）、`export function findNodeExecutable`（L41-112）、`export function resolveCodebuddyPath`（L116-202）**整段剪切**到新文件 `src/utils/cliPath.ts`。`cliPath.ts` 顶部加它们实际用到的 Node import（已 grep 确认只用 `path` 和 `fs`，`process` 是全局无需 import）：
```typescript
import * as path from 'path';
import * as fs from 'fs';
```

- [ ] **Step 2: `providers/codebuddy/index.ts` 加 import**

在文件顶部 import 区加：
```typescript
import { findNodeExecutable, resolveCodebuddyPath } from '../../utils/cliPath';
```
删掉剪走的 `NODE_EXECUTABLE`/`findNodeExecutable`/`resolveCodebuddyPath` 定义后，确认 `index.ts` 里对这两个函数的调用（构造函数 `resolveCodebuddyPath('')`、`setCodebuddyPath` 里的 `resolveCodebuddyPath`、`sendMessage` 里的 `findNodeExecutable`）都还能解析到新 import。

- [ ] **Step 3: `tests/api.test.ts` import 改**

原来那条从 `../src/providers/codebuddy` import 的长语句里，`resolveCodebuddyPath`/`findNodeExecutable` 两个名字**移出去**，改成单独一条：
```typescript
import { resolveCodebuddyPath, findNodeExecutable } from '../src/utils/cliPath';
```
其余名字（`CodebuddyProvider`/`parseStreamLine`/...）仍 from `../src/providers/codebuddy`。

- [ ] **Step 4: 验证 + Commit**

Run: `npm test` → Expected: 105 passed / 2 failed（api 与 cliPath 相关测试全绿；2 个 pre-existing 环境失败照旧）。
Run: `npm run build` → Expected: exit 0。
Run: `grep -rn "function findNodeExecutable\|function resolveCodebuddyPath" src/providers` → Expected: 空（已移走）。
```bash
git add -A && git commit -m "refactor: move CLI path resolution to utils/cliPath"
```

---

### Task 3: chat 拆 view/render/tabs/input

**Files:**
- Create: `src/features/chat/render.ts`、`src/features/chat/tabs.ts`、`src/features/chat/input.ts`
- Modify: `src/features/chat/view.ts`（保留类+字段+生命周期，抽走三类方法，改调用为模块函数）

**Interfaces:**
- Consumes: `assembleContextText`（Task 1）、`WorkbuddianChatView` 类型（view.ts）
- Produces: 三个职责模块，各导出接受 `view: WorkbuddianChatView` 的函数

**拆法（对每个抽出的方法机械执行）**：
1. 方法从 `private async renderMessages()` 变成 `export async function renderMessages(view: WorkbuddianChatView)`。
2. 函数体内所有 `this.` → `view.`（字段、其他方法调用都是）。
3. `view.ts` 里原调用点 `this.renderMessages()` → `renderMessages(this)`，并在 view.ts 顶部 import。
4. 模块间互调（如 `input` 里调 `renderMessages`）：在该模块顶部 import 需要的函数（`import { renderMessages } from './render'`）。esbuild 对函数级循环 import 无碍。

- [ ] **Step 1: 建 `render.ts`（抽 5 个渲染方法）**

从 `view.ts` 剪出并按上述规则改写：`renderMessages`、`renderMessage`、`renderThinkingIndicator`、`renderMarkdownContent`、`scrollToBottom`。`render.ts` 顶部 import：`WorkbuddianChatView`（type，from `./view`）、Obsidian 的 `MarkdownRenderer`/`Component`（renderMarkdownContent 用）、`ChatMessage` type（renderMessage 用，from `../../types`）。

- [ ] **Step 2: 建 `tabs.ts`（抽 6 个标签方法）**

抽 `renderTabs`、`createNewChat`、`switchToChat`、`deleteChat`、`beginRenameTab`、`showTabContextMenu`。`tabs.ts` import：`WorkbuddianChatView` type、`formatConversationAsMarkdown`（showTabContextMenu 用，from `../../shared/export`）、Obsidian 的 `Menu`/`Notice`（右键菜单用）、`renderMessages` from `./render`（switchToChat/deleteChat 后重渲用）。

- [ ] **Step 3: 建 `input.ts`（抽 7 个输入方法）**

抽 `sendMessage`、`handleKeydown`、`adjustTextareaHeight`、`updateAtSuggest`、`insertAtReference`、`buildReferenceBlock`、`buildCurrentNoteLink`。`input.ts` import：`WorkbuddianChatView` type、`assembleContextText` from `../../core/context/assembleContext`、`extractAtQuery`/`parseAtReferences` from `../../shared/atReferences`、`renderMessages` from `./render`、`renderTabs` from `./tabs`（sendMessage 里新建对话后调）、Obsidian 的 `Notice`。

- [ ] **Step 4: 改 `view.ts`（保留 + 接线）**

`view.ts` 保留：`WorkbuddianChatView` 类、`VIEW_TYPE_CHAT` 导出、所有实例字段、`vaultPath` getter、构造函数、生命周期 `getViewType`/`getDisplayText`/`getIcon`/`onOpen`/`onClose`/`loadConversations`、以及被多模块用的 `getActiveConversation` helper（读 `activeConvId`+`manager`）。
- 顶部 import 三个模块用到的函数：`import { renderMessages, renderMessage } from './render'`、`import { renderTabs, createNewChat, beginRenameTab } from './tabs'`、`import { sendMessage, handleKeydown, updateAtSuggest, adjustTextareaHeight } from './input'`（按 onOpen/loadConversations 里实际调用的补全）。
- `onOpen`/`loadConversations` 里原来的 `this.renderTabs()`/`this.renderMessages()` → `renderTabs(this)`/`renderMessages(this)`。
- `onOpen` 里绑定的事件回调改调模块函数：
  - `this.inputEl.onkeydown = (e) => handleKeydown(this, e)`
  - `this.inputEl.oninput = () => { updateAtSuggest(this); adjustTextareaHeight(this); }`（按现状回调内容）
  - `this.sendBtn.onclick = () => { if (this.isStreaming) this.api.cancel(); else sendMessage(this); }`（按现状逻辑）
  - 新建按钮 `onclick` → `createNewChat(this)` 等
- 确认 view.ts 里不再有 render/tabs/input 那些方法的定义（已抽走）。

- [ ] **Step 5: 构建 + grep 验证**

Run: `./node_modules/.bin/tsc --noEmit --skipLibCheck` → Expected: 仅 tsconfig 弃用警告，无 TS 真错（import/类型都接对）。
Run: `npm run build` → Expected: exit 0。
Run: `grep -nE "this\." src/features/chat/render.ts src/features/chat/tabs.ts src/features/chat/input.ts` → Expected: 空（模块函数里应全是 `view.`，无残留 `this.`）。
Run: `npm test` → Expected: 105/2 不变（chat 无自动化测试，但纯逻辑测试不受影响）。

- [ ] **Step 6: 装 vault + 真机手动回归**

```bash
npm run build
VAULT="/Users/jiang/Library/Mobile Documents/iCloud~md~obsidian/Documents/我的工作"
cp main.js "$VAULT/.obsidian/plugins/workbuddian/main.js"
```
重载 Workbuddian，对照 1a 的 16 项手动回归清单逐项确认零回归（聊天/流式/多标签/搜索/改名/导出/@引用/停止/设置6项/上下文注入/模型）。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: split chat view into view/render/tabs/input modules"
```

---

## 收尾

三个 Task 完成后：`npm test` 105/2、`build` exit 0、真机手动回归通过 → 用 finishing-a-development-branch 把净化波分支 merge 回 main。
