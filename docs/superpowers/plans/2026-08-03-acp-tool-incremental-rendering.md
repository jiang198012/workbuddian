# tool_call_update 增量渲染（乙方案）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让 ACP v2 的工具行恢复实时可见（参数流式增长、completed 出 diff 预览、Edit 撤销按钮复活）。

**Architecture:** `StreamChunk` 加 `toolCallId?/toolStatus?` 可选字段；`acp/events.ts` 新增 `mapToolCallUpdate`；`acp/session.ts` 把 rawInput 累积从浅合并改为快照替换并发射增量/完成 chunk；`input.ts` tool 分支按 toolCallId 就地更新行文本，completed 时走 v1 原路径渲染 diff/undo。

**Tech Stack:** TypeScript 4.7.4 / ts-jest / jest 29；无新依赖。

**Spec:** `docs/superpowers/specs/2026-08-03-acp-tool-incremental-rendering-design.md`（已批准，commit 2d7c245）

## Global Constraints

- `StreamChunk` 只允许加可选字段：`toolCallId?: string; toolStatus?: 'in_progress' | 'completed'`，其余契约不变。
- rawInput 语义 = **快照**（traffic 实证）：同 toolCallId 后到的 update 直接替换，不做合并。
- 终态信号 = `tool_call_update` 且 `status === 'completed'`；流式中的 update 无 status。
- `acp/*` 模块零 `import 'obsidian'`；i18n 无新 key（diff/撤销文案 v1 已有）。
- UI 层 diff 仅限 tool 分支的就地更新与 diff/undo 复活。
- 每 Task 结束 `npx jest <相关测试>` 全绿；Task 4/5 加跑 `npm run build`。
- 提交步骤按惯例列出；是否 commit 以用户当面指示为准。

---

### Task 1: StreamChunk 扩展 + events 增量映射

**Files:**
- Modify: `src/providers/codebuddy/index.ts`（StreamChunk 加两字段）
- Modify: `src/providers/codebuddy/acp/events.ts`
- Test: `tests/acpEvents.test.ts`

**Interfaces:**
- Consumes: 现有 `mapSessionUpdate/extractToolName/summarizeRawInput`。
- Produces（Task 2/4 依赖）:
  - `mapToolCallUpdate(update: AcpUpdate, snapshot: unknown): StreamChunk | null` — 非 tool_call_update 或缺 toolCallId → null；`status==='completed'` → `{type:'tool', content:'', toolName, toolCallId, toolStatus:'completed', toolDetail: JSON 快照}`；否则 → `{type:'tool', content:'', toolName, toolCallId, toolDetail: 摘要}`
  - `mapSessionUpdate` 的 tool_call chunk 现在带 `toolCallId`

- [x] **Step 1: 写失败测试**（追加到 `tests/acpEvents.test.ts`；同时把 `mergeRawInput` 的 describe 整块删除——Task 2 将移除该函数，孤儿不留）

```ts
describe('mapToolCallUpdate', () => {
    it('returns null for non tool_call_update or missing toolCallId', () => {
        expect(mapToolCallUpdate({ sessionUpdate: 'usage_update' }, {})).toBeNull();
        expect(mapToolCallUpdate({ sessionUpdate: 'tool_call_update' }, {})).toBeNull();
    });
    it('maps streaming update to summary chunk with toolCallId', () => {
        const chunk = mapToolCallUpdate(
            { sessionUpdate: 'tool_call_update', toolCallId: 'c1', _meta: { 'codebuddy.ai/toolName': 'Write' } },
            { file_path: '/a/b.md', content: 'l1\nl2' },
        );
        expect(chunk).toEqual({ type: 'tool', content: '', toolName: 'Write', toolCallId: 'c1', toolDetail: '/a/b.md' });
    });
    it('maps completed update to JSON detail chunk with toolStatus', () => {
        const snapshot = { file_path: '/a/b.md', content: 'l1' };
        const chunk = mapToolCallUpdate(
            { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', _meta: { 'codebuddy.ai/toolName': 'Write' } },
            snapshot,
        );
        expect(chunk).toEqual({
            type: 'tool', content: '', toolName: 'Write', toolCallId: 'c1',
            toolStatus: 'completed', toolDetail: JSON.stringify(snapshot),
        });
    });
    it('tool_call chunk carries toolCallId', () => {
        expect(mapSessionUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c9', title: 'Bash', rawInput: {} }))
            .toMatchObject({ type: 'tool', toolCallId: 'c9', toolName: 'Bash' });
    });
});
```

（`mapToolCallUpdate` 的 import 加进文件头部的 import 列表。）

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/acpEvents.test.ts`（mapToolCallUpdate 未定义）。
- [x] **Step 3: 实现**

`src/providers/codebuddy/index.ts` StreamChunk：

```ts
export interface StreamChunk {
    type: 'thinking' | 'text' | 'tool' | 'error' | 'done';
    content: string;
    toolName?: string;
    toolDetail?: string;
    /** ACP 工具调用 id：同 id 的后续 chunk 就地更新同一行（乙方案） */
    toolCallId?: string;
    /** 工具终态信号：仅 completed 时出现，携带 JSON 快照 detail 供 diff/撤销 */
    toolStatus?: 'in_progress' | 'completed';
    usage?: UsageInfo;
}
```

`src/providers/codebuddy/acp/events.ts`：tool_call 分支加 `toolCallId`；新增：

```ts
/** tool_call_update 映射：snapshot 为该 toolCallId 的最新 rawInput 快照（调用方负责替换式累积） */
export function mapToolCallUpdate(update: AcpUpdate, snapshot: unknown): StreamChunk | null {
    if (update.sessionUpdate !== 'tool_call_update') return null;
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!toolCallId) return null;
    const toolName = extractToolName(update);
    if (update.status === 'completed') {
        let toolDetail = '';
        try { toolDetail = JSON.stringify(snapshot) ?? ''; } catch { /* 循环引用等，留空 */ }
        return { type: 'tool', content: '', toolName, toolCallId, toolStatus: 'completed', toolDetail };
    }
    return { type: 'tool', content: '', toolName, toolCallId, toolDetail: summarizeRawInput(snapshot) };
}
```

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/acpEvents.test.ts` 全绿。
- [x] **Step 5: Commit** — `git commit -m "feat(acp): tool chunk 增量映射（toolCallId/completed 快照）"`

---

### Task 2: session 快照替换 + 发射节奏

**Files:**
- Modify: `src/providers/codebuddy/acp/session.ts`、`src/providers/codebuddy/acp/events.ts`（删 mergeRawInput）
- Test: `tests/acpSession.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `mapToolCallUpdate`。
- Produces: `handleUpdate` 对 tool_call_update 的行为契约——快照替换后必发 chunk（流式摘要 / completed JSON）；toolName 以 update 的 `_meta` 为准、tool_call 时缓存的名字兜底。

- [x] **Step 1: 改写失败测试** — `tests/acpSession.test.ts` 里 "accumulates tool_call_update rawInput without emitting chunks" 整条替换为：

```ts
it('replaces rawInput snapshot and emits streaming + completed chunks', async () => {
    const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
    const s = await loadedSession(client);
    const handlers = makeHandlers();
    const done = s.prompt('hi', handlers);
    s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write', rawInput: {}, _meta: { 'codebuddy.ai/toolName': 'Write' } });
    s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { file_path: 'a.md', content: 'l1' } });
    // 快照语义：后到的更短快照直接替换，不做合并（content 变短也生效）
    s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { file_path: 'a.md', content: '' } });
    s.handleUpdate({
        sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed',
        rawInput: { file_path: 'a.md', content: 'final' }, _meta: { 'codebuddy.ai/toolName': 'Write' },
    });
    await done;
    const chunks = handlers.onChunk.mock.calls.map((c) => c[0]);
    expect(chunks).toHaveLength(4); // tool_call + 2 流式 + 1 completed
    expect(chunks[1]).toMatchObject({ type: 'tool', toolCallId: 'c1', toolDetail: 'a.md' });
    expect(chunks[3]).toMatchObject({
        type: 'tool', toolCallId: 'c1', toolStatus: 'completed',
        toolDetail: JSON.stringify({ file_path: 'a.md', content: 'final' }),
    });
});

it('falls back to cached toolName when update lacks _meta', async () => {
    const client = makeFakeClient((m) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : undefined);
    const s = await loadedSession(client);
    const handlers = makeHandlers();
    const done = s.prompt('hi', handlers);
    s.handleUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write', rawInput: {}, _meta: { 'codebuddy.ai/toolName': 'Write' } });
    s.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { file_path: 'a.md' } }); // 无 _meta
    await done;
    expect(handlers.onChunk).toHaveBeenLastCalledWith(
        expect.objectContaining({ toolCallId: 'c1', toolName: 'Write' }),
    );
});
```

同时删除 `tests/acpSession.test.ts` 里对 `mergeRawInput` 语义有依赖的旧断言（若有），`tests/acpEvents.test.ts` 的 mergeRawInput describe 在 Task 1 已删。

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/acpSession.test.ts`。
- [x] **Step 3: 实现** `session.ts`：

```ts
// 字段区：toolInputs 注释改快照语义；新增 toolNames 缓存
private toolInputs = new Map<string, unknown>();   // toolCallId → 最新 rawInput 快照（替换式，traffic 实证快照语义）
private toolNames = new Map<string, string>();     // toolCallId → toolName（update 缺 _meta 时兜底）

// handleUpdate 的 tool_call_update 分支，由"只累积"改为：
if (update.sessionUpdate === 'tool_call_update') {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!id) return;
    this.toolInputs.set(id, update.rawInput); // 快照替换
    const chunk = mapToolCallUpdate(update, update.rawInput);
    if (chunk) {
        if (!update._meta && this.toolNames.has(id)) chunk.toolName = this.toolNames.get(id)!;
        handlers.onChunk(chunk);
    }
    return;
}
// mapSessionUpdate 的 tool_call 分支缓存名字（在 handlers.onChunk(chunk) 之前）：
//   if (chunk.type === 'tool' && typeof update.toolCallId === 'string') {
//       this.toolNames.set(update.toolCallId, chunk.toolName ?? 'tool');
//       this.toolInputs.set(update.toolCallId, update.rawInput ?? {});
//   }
```

（`mapToolCallUpdate` 加进 import；`mergeRawInput` import 移除。）

`events.ts`：删除 `mergeRawInput` 函数（孤儿）。

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/acpSession.test.ts tests/acpEvents.test.ts` 全绿。
- [x] **Step 5: Commit** — `git commit -m "feat(acp): 会话层快照替换并发射工具增量/完成 chunk"`

---

### Task 3: provider.busy 映射修复

**Files:**
- Modify: `src/providers/codebuddy/index.ts`（sendMessage 的同步 throw 处）
- Test: `tests/api.test.ts`（改现有 busy 用例断言）

- [x] **Step 1: 改测试断言** — "rejects a second send on the same session while busy" 用例的 `.rejects.toThrow('session busy')` 改为 `.rejects.toThrow(t('provider.busy'))`。
- [x] **Step 2: 跑测试确认失败** — `npx jest tests/api.test.ts -t busy`（现在抛的是英文原文）。
- [x] **Step 3: 实现** — sendMessage 里：

```ts
try {
    promptPromise = session.prompt(text, handlers);
} catch (e) {
    clearTimeout(timer);
    throw e instanceof Error && e.message === 'session busy' ? new Error(t('provider.busy')) : e;
}
```

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/api.test.ts` 全绿。
- [x] **Step 5: Commit** — `git commit -m "fix(provider): 会话忙错误接入 provider.busy 文案"`

---

### Task 4: input.ts 就地更新 + diff/undo 复活

**Files:**
- Modify: `src/features/chat/input.ts`（sendText tool 分支，当前 :798 起）

**Interfaces:**
- Consumes: Task 1 的 chunk 字段（`toolCallId/toolStatus`）；v1 既有 `parseFileChange/lineDiff/undoEdit` 路径（原样未动）。

- [x] **Step 1: sendText 局部加工具行登记表** — `const chunkStats` 声明附近加：

```ts
const toolRows = new Map<string, HTMLElement>(); // toolCallId → 工具行（同 id 后续 chunk 就地更新）
```

- [x] **Step 2: tool 分支重构** — 保持 toolsBlock 创建逻辑不变，`if (list instanceof HTMLElement) {` 之后改为：

```ts
const toolName = chunk.toolName || '';
const toolDetail = chunk.toolDetail || '';
// completed chunk 的 toolDetail 是 JSON 快照：行文本只留路径，JSON 仅供 parseFileChange
const completedChange = chunk.toolStatus === 'completed' ? parseFileChange(toolName, toolDetail) : null;
const rowText = chunk.toolStatus === 'completed'
    ? `${toolName} ${completedChange?.path ?? ''}`.trim()
    : `${toolName} ${toolDetail}`.trim();

let iconName = 'wrench'; // ……图标分支照旧（read/write/search 关键字）……

let row: HTMLElement | undefined;
if (chunk.toolCallId && toolRows.has(chunk.toolCallId)) {
    row = toolRows.get(chunk.toolCallId)!;
    row.querySelector('.workbuddian-tool-call-text')?.setText(rowText);
} else {
    row = list.createDiv({ cls: 'workbuddian-tool-call' });
    const icon = row.createSpan({ cls: 'workbuddian-tool-call-icon' });
    setIcon(icon, iconName);
    row.createSpan({ cls: 'workbuddian-tool-call-text', text: rowText });
    if (chunk.toolCallId) toolRows.set(chunk.toolCallId, row);
}

// 终态：diff 预览 + 撤销按钮（v1 原路径复活），幂等防重复 completed
if (chunk.toolStatus === 'completed' && completedChange && row.dataset.diffRendered !== '1') {
    row.dataset.diffRendered = '1';
    // ……现有 diff 块代码（diffLines/diffBlock/diffHeader/撤销按钮/diffBody/toggleDiff）原样搬入，
//     唯一改动：diffBlock 由 list.createDiv 改为创建后 row.insertAdjacentElement('afterend', diffBlock)，
//     保证 diff 跟在所属行之后而不是列表末尾……
}
```

注：`insertAdjacentElement` 是原生 DOM API（Obsidian 元素即 HTMLElement），先用 `document.createElement('div')` 建 diffBlock 再插入；或保持 `list.createDiv` 再 `list.insertBefore(diffBlock, row.nextSibling)`——两者择一，实现时以不破坏既有 class 结构为准。

- [x] **Step 3: 验证** — `npm run build`（tsc 类型关）+ `npx jest` 全量绿（UI 无单测，靠类型与既有套件防回归）。
- [x] **Step 4: Commit** — `git commit -m "feat(chat): 工具行按 toolCallId 就地更新，completed 复活 diff 预览与撤销"`

---

### Task 5: 全量验收

- [x] **Step 1:** `npx jest` 全绿（含 worktree 旧套件）、`npm run build` 过。
- [x] **Step 2:** demo-vault 手测清单（交用户执行）：
  1. 长 Write（如"写一篇 500 字笔记"）工具行文本**实时增长**；
  2. Edit 完成后该row下方出 diff 预览（可折叠）；
  3. vault 内 Edit 出「撤销此修改」按钮，点击后文件回滚、按钮变「已撤销」；
  4. 双面板同时流式，各自工具行不串；
  5. 批准卡流程不回归（default 模式弹卡、批准后落盘、diff 照常出现）。
- [x] **Step 3: Commit** — 如有修补随验收提交。

---

## Self-Review

- **Spec coverage**：快照替换（Task 2）/增量与 completed 映射（Task 1）/就地更新+diff+撤销（Task 4）/busy 修复（Task 3）/手测五项（Task 5）——spec §4/§5/§7 逐条有落点；§6 非目标均未安排。
- **Placeholder scan**：Task 4 Step 2 的 diff 块以"现有代码原样搬入"描述——该代码块在当前文件 :856-913 完整存在，搬移锚点明确，不算占位。
- **Type consistency**：`mapToolCallUpdate(update, snapshot)` 签名 Task 1 定义、Task 2 消费一致；`toolCallId/toolStatus` 字段名四处一致；`toolRows`/`dataset.diffRendered` 仅 Task 4 内部。
