# ROADMAP B 类批次 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复被丢弃的工具块，在其中展示 Edit/Write 的行级 diff 并支持 Edit 撤销；加回计划模式并把计划渲染成可执行卡片；`/resume` 弹出会话选择器；补五条无障碍改进。

**Architecture:** 数据入口是 provider 的 `parseMessageBlock`（一行判断的 bug 导致工具块全被丢弃）。修好后 `StreamChunk.toolName/toolDetail` 直达 UI，新增纯逻辑模块把 `toolDetail` 解析成可 diff 的结构，渲染层用现成的 `lineDiff` 出图。计划模式复用同一条工具块通道（计划正文就在 Write 的 `content` 里）。

**Tech Stack:** TypeScript + esbuild、Jest + ts-jest、Obsidian Plugin API（Modal / MarkdownRenderer / Notice）。

## Global Constraints

- 不新增任何 npm 依赖。
- 纯逻辑放 `src/shared` / `src/core` / `src/types` 并配 jest 单测；`import 'obsidian'` 的文件（`features/**`）按项目惯例**不写单测**，也不要为了可测而重构它们。
- 用户可见文案一律走 `t()`，`zh` + `en` 成对。
- `main.js` 是提交进仓库的构建产物：改了 `src/**` 就 `npm run build`，`git status --porcelain main.js` 有输出就一并 `git add`。
- `npm run build` 内含 `tsc -noEmit`，必须零错误。
- 分支 `main`（用户已明确同意），**不 push、不打 tag、不碰 GitHub**。
- 提交信息用中文。
- 实测事实不得推翻（详见 spec `docs/superpowers/specs/2026-07-27-roadmap-b-batch-design.md`）：Write 无旧内容故不支持撤销；`ExitPlanMode` 在非交互模式下必被拒绝，「批准」只能是重发一轮。
- jest 会连带跑 `.claude/worktrees/` 下的陈旧副本，其结果与本批次无关；报告测试数字时照抄 jest 输出，不要estimate。

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `src/providers/codebuddy/index.ts` | CLI 流解析 | `parseMessageBlock` 放行 `tool_use` |
| `src/shared/toolDetail.ts`（新） | 工具入参 → 文件改动 / 计划路径判定 | 全新纯逻辑 |
| `src/shared/conversationSummary.ts`（新） | 会话摘要格式化 | 全新纯逻辑 |
| `src/features/chat/input.ts` | 工具块渲染、发送路径 | diff 区、撤销、计划卡片、`/resume` 分派 |
| `src/features/chat/resumeModal.ts`（新） | 会话选择器 | 全新 Modal |
| `src/features/chat/view.ts` / `tabs.ts` / `render.ts` | 面板 | 无障碍属性 |
| `src/shared/cliOptions.ts` | 权限选项 | `PERMISSION_MODE_CHOICES` 加回 `plan` |
| `src/i18n/index.ts` | 文案 | 各任务新增键 |
| `styles.css` | 样式 | diff 行、计划卡片、焦点环 |

---

### Task 1: 修复被丢弃的工具块

**Files:**
- Modify: `src/providers/codebuddy/index.ts:55-82`
- Test: `tests/api.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `StreamChunk { type:'tool', toolName, toolDetail }` 现在真的会在流里出现 —— Task 3/6 依赖它

- [ ] **Step 1: 写失败的测试**

在 `tests/api.test.ts` 里追加（放在已有的 `parseStreamLine` 相关 describe 旁）：

```ts
describe('parseStreamLine tool blocks', () => {
    it('accepts the tool_use block shape the CLI actually emits', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a/b.txt', old_string: 'x', new_string: 'y' } }] }
        });
        const chunk = parseStreamLine(line);
        expect(chunk).not.toBeNull();
        expect(chunk!.type).toBe('tool');
        expect(chunk!.toolName).toBe('Edit');
        expect(JSON.parse(chunk!.toolDetail!)).toEqual({ file_path: '/a/b.txt', old_string: 'x', new_string: 'y' });
    });

    it('still accepts the legacy tool_call block shape', () => {
        const line = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'tool_call', name: 'Read', input: { file_path: '/a/b.txt' } }] }
        });
        const chunk = parseStreamLine(line);
        expect(chunk!.type).toBe('tool');
        expect(chunk!.toolName).toBe('Read');
    });
});
```

若 `parseStreamLine` 尚未在该文件 import，补上（从 `../src/providers/codebuddy`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/api.test.ts -t "tool_use"`
Expected: FAIL —— 第一个用例得到 `null`（块被丢弃），第二个通过。

- [ ] **Step 3: 实现**

`src/providers/codebuddy/index.ts`：

1. `MessageBlock` 接口的 `type` 联合加上 `'tool_use'`：
```ts
    type: 'thinking' | 'text' | 'tool_call' | 'tool_use';
```
2. `parseMessageBlock` 第 58 行放行：
```ts
    if (type !== 'thinking' && type !== 'text' && type !== 'tool_call' && type !== 'tool_use') return null;
```
3. `blockToChunk` 无需改动（thinking/text 之外一律走工具分支），但确认它对 `tool_use` 也返回 `{type:'tool', toolName, toolDetail}`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/api.test.ts`
Expected: PASS，且原有用例不回归。

- [ ] **Step 5: 提交**

```bash
npm run build
git add src/providers/codebuddy/index.ts tests/api.test.ts main.js
git commit -m "fix: CLI 的 tool_use 工具块被丢弃导致工具调用不显示"
```

---

### Task 2: 工具入参纯逻辑

**Files:**
- Create: `src/shared/toolDetail.ts`
- Test: `tests/toolDetail.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces:
  - `parseFileChange(toolName: string, toolDetail: string): FileChange | null`
  - `isPlanFilePath(p: string): boolean`
  - 类型 `FileEdit` / `FileWrite` / `FileChange`

- [ ] **Step 1: 写失败的测试**

新建 `tests/toolDetail.test.ts`：

```ts
import { parseFileChange, isPlanFilePath } from '../src/shared/toolDetail';

describe('parseFileChange', () => {
    it('parses an Edit into old/new text', () => {
        const detail = JSON.stringify({ file_path: '/a/b.txt', old_string: 'line two', new_string: 'line TWO' });
        expect(parseFileChange('Edit', detail)).toEqual({ kind: 'edit', path: '/a/b.txt', oldText: 'line two', newText: 'line TWO' });
    });

    it('parses a Write as a whole-file addition', () => {
        const detail = JSON.stringify({ file_path: '/a/b.txt', content: 'hello\nworld' });
        expect(parseFileChange('Write', detail)).toEqual({ kind: 'write', path: '/a/b.txt', newText: 'hello\nworld' });
    });

    it('returns null for non-file tools', () => {
        expect(parseFileChange('Read', JSON.stringify({ file_path: '/a/b.txt' }))).toBeNull();
        expect(parseFileChange('Bash', JSON.stringify({ command: 'ls' }))).toBeNull();
    });

    it('returns null when required fields are missing or malformed', () => {
        expect(parseFileChange('Edit', JSON.stringify({ file_path: '/a/b.txt' }))).toBeNull();
        expect(parseFileChange('Write', JSON.stringify({ content: 'x' }))).toBeNull();
        expect(parseFileChange('Edit', 'not json')).toBeNull();
        expect(parseFileChange('Edit', '')).toBeNull();
    });
});

describe('isPlanFilePath', () => {
    it('recognises CodeBuddy plan files', () => {
        expect(isPlanFilePath('/Users/x/.codebuddy/plans/swift-forging-newton.md')).toBe(true);
        expect(isPlanFilePath('C:\\Users\\x\\.codebuddy\\plans\\a.md')).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isPlanFilePath('/Users/x/.codebuddy/plans/notes.txt')).toBe(false);
        expect(isPlanFilePath('/Users/x/notes/plans/a.md')).toBe(false);
        expect(isPlanFilePath('')).toBe(false);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/toolDetail.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

新建 `src/shared/toolDetail.ts`：

```ts
export interface FileEdit { kind: 'edit'; path: string; oldText: string; newText: string; }
export interface FileWrite { kind: 'write'; path: string; newText: string; }
export type FileChange = FileEdit | FileWrite;

/** 工具入参 JSON → 可 diff 的文件改动；非文件工具、字段缺失或 JSON 非法时返回 null */
export function parseFileChange(toolName: string, toolDetail: string): FileChange | null {
    let input: unknown;
    try {
        input = JSON.parse(toolDetail);
    } catch {
        return null;
    }
    if (typeof input !== 'object' || input === null) return null;
    const obj = input as Record<string, unknown>;
    const path = typeof obj.file_path === 'string' ? obj.file_path : '';
    if (!path) return null;

    if (toolName === 'Edit') {
        const oldText = obj.old_string;
        const newText = obj.new_string;
        if (typeof oldText !== 'string' || typeof newText !== 'string') return null;
        return { kind: 'edit', path, oldText, newText };
    }
    if (toolName === 'Write') {
        const content = obj.content;
        if (typeof content !== 'string') return null;
        return { kind: 'write', path, newText: content };
    }
    return null;
}

/** 是否 CodeBuddy 写出的计划文件（.codebuddy/plans 下的 .md），跨平台兼容 / 与 \ */
export function isPlanFilePath(p: string): boolean {
    const norm = p.replace(/\\/g, '/');
    return norm.includes('/.codebuddy/plans/') && norm.endsWith('.md');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/toolDetail.test.ts`
Expected: PASS，全部用例绿。

- [ ] **Step 5: 提交**

```bash
npm run build
git add src/shared/toolDetail.ts tests/toolDetail.test.ts
git status --porcelain main.js && git add main.js
git commit -m "feat: toolDetail 纯逻辑（工具入参解析 + 计划文件判定）"
```

（新模块此时尚无引用，esbuild 可能 tree-shake 掉，`main.js` 无变化属正常。）

---

### Task 3: 工具块内的行级 diff

**Files:**
- Modify: `src/features/chat/input.ts`（tool chunk 分支，约 558-600 行）
- Modify: `src/i18n/index.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: Task 1 让工具块真的出现；Task 2 的 `parseFileChange`；既有的 `lineDiff(oldText, newText): DiffLine[]`（`shared/lineDiff.ts`，返回 `{type:'equal'|'add'|'remove', text}[]`）
- Produces: diff 区 DOM（class `workbuddian-tool-diff`），Task 4 在其中挂撤销按钮

- [ ] **Step 1: 在工具条目下渲染 diff 区**

`input.ts` 的 `chunk.type === 'tool'` 分支里，为每个工具条目追加：解析 `parseFileChange(chunk.toolName, chunk.toolDetail)`，为 null 就保持现有纯文本展示；不为 null 则在该条目下创建：

```
div.workbuddian-tool-diff
  div.workbuddian-tool-diff-header   ← 可点击折叠，文本为 t('tool.diffTitle') + 文件名（用 fileBasename）
  div.workbuddian-tool-diff-body.workbuddian-hidden  ← 默认折叠
    div.workbuddian-diff-line.workbuddian-diff-add / -remove / -equal  ← 每行一个
```

行内容：`add` 前缀 `+ `，`remove` 前缀 `- `，`equal` 前缀两个空格。`Write` 传 `lineDiff('', change.newText)`（整篇新增），`Edit` 传 `lineDiff(change.oldText, change.newText)`。

折叠交互复用同文件里 thinking / tools 块的写法（点 header 切 `workbuddian-hidden`，chevron 在 `▾`/`▸` 间切换）。

- [ ] **Step 2: 加 i18n**

`src/i18n/index.ts` 新增：

```ts
    'tool.diffTitle': { zh: '改动', en: 'Changes' },
```

- [ ] **Step 3: 加样式**

`styles.css` 追加（用 python 追加写入，避免 shell 转义问题）：

```css
/* 工具块内的行级 diff */
.workbuddian-tool-diff { margin: 4px 0 0 0; }
.workbuddian-tool-diff-header { cursor: pointer; font-size: 12px; opacity: 0.8; display: flex; align-items: center; gap: 4px; }
.workbuddian-tool-diff-body { margin-top: 4px; border-radius: 4px; overflow-x: auto; }
.workbuddian-diff-line { font-family: var(--font-monospace); font-size: 12px; white-space: pre; padding: 0 6px; }
.workbuddian-diff-add { background: rgba(0, 160, 60, 0.15); }
.workbuddian-diff-remove { background: rgba(200, 40, 40, 0.15); }
.workbuddian-diff-equal { opacity: 0.65; }
```

- [ ] **Step 4: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零 TS 错误；测试全绿（本任务在 `features/**`，不新增单测）。

- [ ] **Step 5: 提交**

```bash
git add src/features/chat/input.ts src/i18n/index.ts styles.css main.js
git commit -m "feat: 工具块内展示 Edit/Write 的行级 diff"
```

---

### Task 4: Edit 撤销

**Files:**
- Modify: `src/features/chat/input.ts`（diff 区）
- Modify: `src/i18n/index.ts`

**Interfaces:**
- Consumes: Task 3 的 diff 区 DOM；`view.vaultPath`；`view.app.vault.adapter`
- Produces: 无

- [ ] **Step 1: 加撤销按钮**

仅当 `change.kind === 'edit'` **且** 目标路径位于 vault 内（`view.vaultPath` 非空且 `change.path` 以它开头）时，在 diff 区 header 右侧加按钮 `t('tool.undo')`。

点击行为：
1. 用 Node `fs.readFileSync(change.path, 'utf8')` 读当前内容（该文件路径是 CLI 给的绝对路径，直接读盘，不走 vault API，避免相对路径换算）。
2. 若内容中找不到 `change.newText` → `new Notice(t('tool.undoStale'))` 并 return（说明文件已被后续改动，不做危险的猜测替换）。
3. 否则把**第一处** `change.newText` 替换回 `change.oldText`，`fs.writeFileSync` 写回。
4. 成功后按钮禁用、文案改为 `t('tool.undone')`。
5. 整个过程包 try/catch，失败 `new Notice(t('tool.undoFailed'))`。

- [ ] **Step 2: 加 i18n**

```ts
    'tool.undo': { zh: '撤销此修改', en: 'Undo this edit' },
    'tool.undone': { zh: '已撤销', en: 'Undone' },
    'tool.undoStale': { zh: '文件已变化，未执行撤销', en: 'File has changed since; undo skipped' },
    'tool.undoFailed': { zh: '撤销失败', en: 'Undo failed' },
```

- [ ] **Step 3: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零错误、测试全绿。

- [ ] **Step 4: 提交**

```bash
git add src/features/chat/input.ts src/i18n/index.ts main.js
git commit -m "feat: vault 内 Edit 改动支持一键撤销"
```

---

### Task 5: `/resume` 会话选择器

**Files:**
- Create: `src/shared/conversationSummary.ts`
- Test: `tests/conversationSummary.test.ts`（新建）
- Create: `src/features/chat/resumeModal.ts`
- Modify: `src/features/chat/input.ts`（斜杠命令分派处）
- Modify: `src/i18n/index.ts`

**Interfaces:**
- Consumes: `view.manager.getAll()`（返回全部会话，`tabs.ts:32` 已在用）；`switchToChat(view, id)`（`tabs.ts:15`，异步）
- Produces: `formatConversationSummary(conv, now): { title: string; meta: string }`

- [ ] **Step 1: 写失败的测试**

新建 `tests/conversationSummary.test.ts`：

```ts
import { formatConversationSummary } from '../src/shared/conversationSummary';
import type { Conversation } from '../src/types';

const base = (over: Partial<Conversation> = {}): Conversation => ({
    id: 'c1', title: '示例对话', sessionId: 's1',
    messages: [], createdAt: 0, updatedAt: 0, ...over,
});

const NOW = 1_700_000_000_000;

describe('formatConversationSummary', () => {
    it('reports message count and "just now" for a fresh update', () => {
        const conv = base({ messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 0 }], updatedAt: NOW - 5_000 });
        const r = formatConversationSummary(conv, NOW);
        expect(r.title).toBe('示例对话');
        expect(r.meta).toContain('1');
    });

    it('uses minutes, hours and days as the gap grows', () => {
        expect(formatConversationSummary(base({ updatedAt: NOW - 5 * 60_000 }), NOW).meta).toMatch(/5/);
        expect(formatConversationSummary(base({ updatedAt: NOW - 3 * 3_600_000 }), NOW).meta).toMatch(/3/);
        expect(formatConversationSummary(base({ updatedAt: NOW - 2 * 86_400_000 }), NOW).meta).toMatch(/2/);
    });

    it('never returns an empty title', () => {
        expect(formatConversationSummary(base({ title: '' }), NOW).title).not.toBe('');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/conversationSummary.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现纯逻辑**

新建 `src/shared/conversationSummary.ts`，导出 `formatConversationSummary(conv: Conversation, now: number)`：`title` 为 `conv.title` 或回退到 `t('chat.newConversation')`；`meta` 由消息数与 `now - conv.updatedAt` 的相对时间拼成（<1 分钟用「刚刚」，<1 小时用分钟，<1 天用小时，否则用天；中英各一套，走 `t()` + 数字拼接）。**不要在纯函数里调用 `Date.now()`** —— 时间从参数传入，测试才能确定。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/conversationSummary.test.ts`
Expected: PASS。

- [ ] **Step 5: 写 Modal 并接入**

新建 `src/features/chat/resumeModal.ts`，仿 `instructionModal.ts` 的结构：`class ResumeModal extends Modal`，`onOpen` 里用 `view.manager.getAll()` 列出全部会话（每条一行：标题 + `meta`，点击调 `switchToChat(view, conv.id)` 后 `close()`），空列表时显示 `t('resume.empty')`。导出 `openResumeModal(view)`。列表按 `updatedAt` 倒序（最近的在最上）。

`input.ts` 的斜杠命令分派处：`cmd.name === 'resume' && cmd.rest === ''` 时不发 CLI，改为清空输入框并 `openResumeModal(view)`；带参数时保持现状透传。

- [ ] **Step 6: 加 i18n**

```ts
    'resume.modalTitle': { zh: '选择要恢复的对话', en: 'Resume a conversation' },
    'resume.empty': { zh: '（还没有历史对话）', en: '(No conversations yet)' },
    'resume.justNow': { zh: '刚刚', en: 'just now' },
    'resume.minutesAgo': { zh: '分钟前', en: 'min ago' },
    'resume.hoursAgo': { zh: '小时前', en: 'h ago' },
    'resume.daysAgo': { zh: '天前', en: 'd ago' },
    'resume.messageCount': { zh: '条', en: 'msgs' },
```

- [ ] **Step 7: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零错误、测试全绿。

- [ ] **Step 8: 提交**

```bash
git add src/shared/conversationSummary.ts tests/conversationSummary.test.ts src/features/chat/resumeModal.ts src/features/chat/input.ts src/i18n/index.ts main.js
git commit -m "feat: /resume 弹出会话选择器"
```

---

### Task 6: 计划模式与计划卡片

**Files:**
- Modify: `src/shared/cliOptions.ts`
- Modify: `src/features/chat/input.ts`
- Modify: `src/i18n/index.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: Task 1（工具块可见）、Task 2 的 `isPlanFilePath`、`parseFileChange`；`sendText`（重发一轮的入口）；`MarkdownRenderer`
- Produces: 无

**实测约束（不得违背）**：`ExitPlanMode` 在 `--print` 非交互模式下必被 CLI 拒绝，报 `permission prompts are not available in non-interactive mode`。因此「按此执行」只能是**用计划正文以 `default` 权限模式重发一轮**，按钮文案必须如实反映这一点，不得伪装成原生批准。

- [ ] **Step 1: 权限菜单加回计划模式**

`src/shared/cliOptions.ts`：

```ts
export const PERMISSION_MODE_CHOICES: PermissionMode[] = ['default', 'plan', 'bypassPermissions'];
```

（`PERMISSION_MODE_ICONS` 已有 `plan: 'eye'`，i18n 的 `perm.plan` 若缺失则补上：`{ zh: '计划模式', en: 'Plan mode' }`。）

- [ ] **Step 2: 渲染计划卡片**

`input.ts` 的 tool 分支：当 `parseFileChange` 得到 `kind === 'write'` 且 `isPlanFilePath(change.path)` 为真时，**不渲染 diff**，改为在气泡内渲染计划卡片：

```
div.workbuddian-plan-card
  div.workbuddian-plan-card-title   ← t('plan.cardTitle')
  div.workbuddian-plan-card-body    ← MarkdownRenderer.render(change.newText, ...)
  div.workbuddian-plan-card-actions
    button ← t('plan.execute')  「按此执行（重新发起一轮）」
    button ← t('plan.dismiss')  「忽略」
  div.workbuddian-plan-card-note    ← t('plan.note')，解释 CLI 非交互模式下无法原生批准
```

「按此执行」：把 `view.settings.permissionMode` 临时设为 `'default'`，以 `change.newText` 为文本调用既有的 `sendText(view, ...)` 发起新一轮（发完恢复原权限模式）。「忽略」：移除卡片元素。

- [ ] **Step 3: 抑制 ExitPlanMode 的报错文本**

CLI 因 `DeferExecuteTool` 被拒返回的那段 `Error: Permission to use DeferExecuteTool has been denied ...` 会以工具结果/正文形式出现。在渲染前做一次判断：文本含 `DeferExecuteTool` 且含 `non-interactive` 时不作为错误展示，改为静默忽略（计划卡片自带的说明已覆盖该情形）。

- [ ] **Step 4: 加 i18n**

```ts
    'plan.cardTitle': { zh: '执行计划', en: 'Execution plan' },
    'plan.execute': { zh: '按此执行（重新发起一轮）', en: 'Run this plan (new round)' },
    'plan.dismiss': { zh: '忽略', en: 'Dismiss' },
    'plan.note': { zh: 'CLI 在非交互模式下无法原生批准计划，「按此执行」会以默认权限模式把计划正文重新发起一轮。', en: 'The CLI cannot approve plans natively in non-interactive mode; "Run this plan" re-sends the plan text as a new round in default permission mode.' },
```

- [ ] **Step 5: 加样式**

```css
/* 计划卡片 */
.workbuddian-plan-card { border: 1px solid var(--workbuddian-primary, #C8B487); border-radius: 6px; padding: 8px 10px; margin: 6px 0; }
.workbuddian-plan-card-title { font-weight: 600; margin-bottom: 4px; }
.workbuddian-plan-card-actions { display: flex; gap: 8px; margin-top: 8px; }
.workbuddian-plan-card-note { font-size: 11px; opacity: 0.7; margin-top: 6px; }
```

- [ ] **Step 6: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零错误、测试全绿。

- [ ] **Step 7: 提交**

```bash
git add src/shared/cliOptions.ts src/features/chat/input.ts src/i18n/index.ts styles.css main.js
git commit -m "feat: 计划模式与计划卡片（按此执行＝重发一轮）"
```

---

### Task 7: 无障碍五条

**Files:**
- Modify: `src/features/chat/view.ts`、`tabs.ts`、`input.ts`、`render.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 补 ARIA 与键盘可达**

1. 工具栏四个按钮（模型 / 附件 / 授权 / 指令）、发送键：确认都有 `aria-label`（缺的补上，文案走 `t()`）；模型下拉那个 `div` 补 `role="button"` 和 `tabindex="0"`。
2. 消息容器（`view.messageContainer`）加 `aria-live="polite"` 与 `aria-relevant="additions text"`。
3. `view.inputEl` 补 `aria-label`（新增 i18n 键 `input.ariaLabel`，zh「聊天输入框」/ en「Chat input」）。
4. 标签栏每个 tab 补 `role="tab"` + `tabindex="0"`，其关闭键补 `aria-label`（复用已有的删除文案）。
5. 所有 chip 的 ✕（引用 / 附件 / 选区）：现在只有 `onclick`，补 `keydown` 处理 `Enter` 与 `Space`（`e.preventDefault()` 后触发同一回调）。抽一个小工具函数避免三处重复。

- [ ] **Step 2: Esc 关闭补全下拉**

`input.ts` 的键盘处理里：`Escape` 且补全下拉可见时，关闭下拉并阻止事件冒泡（避免同时触发 Obsidian 的其它 Esc 行为）。Modal 的 Esc 由 Obsidian 原生提供，无需处理。

- [ ] **Step 3: 焦点环样式**

`styles.css` 追加：

```css
.workbuddian-chat-container :focus-visible {
    outline: 2px solid var(--workbuddian-primary, #C8B487);
    outline-offset: 2px;
    border-radius: 4px;
}
```

- [ ] **Step 4: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零错误、测试全绿。

- [ ] **Step 5: 提交**

```bash
git add src/features/chat src/i18n/index.ts styles.css main.js
git commit -m "feat: 无障碍改进（ARIA 标签 / aria-live / 键盘可达 / 焦点环）"
```

- [ ] **Step 6: 交给用户手动验收**

以下需在 Obsidian 中肉眼确认，实现方**不得声称已完成**：

1. 提问触发一次 Edit → 气泡内出现工具块（修复前完全看不到），展开可见绿红 diff。
2. 点「撤销此修改」→ 文件回到修改前；再点一次（或文件已被改动）→ 提示「文件已变化」而非静默。
3. 权限菜单可选「计划模式」；该模式下提问 → 出现计划卡片，不再是一段 DeferExecuteTool 报错。
4. 点「按此执行」→ 以默认权限模式重新发起一轮并真正落地改动。
5. `/resume` 回车 → 弹出会话列表 → 选中即切到该对话。
6. Tab 可遍历工具栏与标签栏、焦点环可见；Esc 关掉 `@` / `/` 补全下拉。
