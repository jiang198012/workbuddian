# CodebuddyProvider v2（ACP 持久会话架构）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把 CodebuddyProvider 从"每轮 spawn 单发进程"重写为"单进程多 session 的 ACP 持久会话"，获得执行前批准、真·计划批准、持久上下文、定向 cancel，UI 层零契约改动。

**Architecture:** 新增 `src/providers/codebuddy/acp/` 四个纯 Node 模块（client=进程+ndjson+JSON-RPC 分发；session=单会话状态机+Registry；events=ACP 事件→StreamChunk 纯映射；permission=权限请求→批准卡数据纯映射），`providers/codebuddy/index.ts` 整体重写为薄壳（生成器契约+旁路回调+超时/死亡恢复）。视图层仅新增批准卡注册/渲染并退役 v1.5.0 计划卡 workaround。

**Tech Stack:** TypeScript 4.7.4 / ts-jest / jest 29（`tests/` 现有 harness：`jest.mock('child_process')` + createFakeProc）；无新增依赖；ACP wire 格式以 `/tmp/acp-spike/traffic.jsonl` 实测为准。

**Spec:** `docs/superpowers/specs/2026-08-03-acp-provider-v2-design.md`（已批准）

## Global Constraints

- `StreamChunk` 契约原样：`{ type: 'thinking'|'text'|'tool'|'error'|'done'; content: string; toolName?: string; toolDetail?: string; usage?: UsageInfo }`，定义留在 `src/providers/codebuddy/index.ts`。
- `CodebuddyProvider` 现有公共方法签名全部保留：`setCodebuddyPath/setTimeout/setNodePath/setModel/setPermissionMode/setAvailableModels/getAvailableModels/getScriptPath/generateId/sendMessage/cancel`；`sendMessage(sessionId, text, vaultPath?, addDirs?, permissionModeOverride?)` 形参不动（v2 中 `addDirs` 与 `permissionModeOverride` 保留但忽略，对应 hack 已退役）；`cancel()` 改为 `cancel(sessionId?: string)`（可选参数，向后兼容）。
- 错误契约：生成器对错误 **throw Error(content)**（`input.ts:914` 与 `inline-edit/index.ts:9` 两处调用方依赖 throw），不向调用方 yield error chunk。
- 新模块（`acp/*`）零 `import 'obsidian'`（延续"逻辑可测"铁律；i18n 可 import，`src/i18n/index.ts` 无 obsidian 依赖）。
- i18n 新增 key 必须中英双语（`tests/i18n.test.ts` 完整性循环断言自动覆盖）；manifest.json 不动；settings 版本（`CURRENT_SETTINGS_VERSION = 10`）不动。
- UI 层（`features/chat`、`main.ts`）diff 仅限：provider-view 新接线（批准/用量/配置/会话查询注入）、批准卡渲染、旧计划卡体系退役、cancel 定向、onunload dispose。无其他重构。
- 每个 Task 结束 `npx jest <相关测试文件>` 全绿方可进下一个；Task 7/9/11/12 结束加跑 `npm run build`。
- 提交步骤按 superpowers 惯例列出；**实际是否 commit 以用户当面指示为准**（默认不提交）。

## ACP wire 事实（摘自 /tmp/acp-spike/traffic.jsonl，2026-08-03）

```jsonc
// 握手
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}}
← {"id":1,"result":{"protocolVersion":1,"agentCapabilities":{...,"loadSession":true},"authMethods":[...]}}   // authMethods 恒非空，不是未登录信号
// 建/载会话
→ {"id":2,"method":"session/new","params":{"cwd":"/abs/vault","mcpServers":[]}}
← {"id":2,"result":{"sessionId":"<acp-uuid>","models":{"availableModels":[{"modelId":"glm-5.2","name":"GLM-5.2","description":"x0.79",...}]},...}}
→ {"id":2,"method":"session/load","params":{"sessionId":"<id>","cwd":"/abs/vault","mcpServers":[]}}
// load 回放通知先到（实测 11 条），随后才是 result；回放事件 _meta["codebuddy.ai"].mode === "history"
// 提问与流式
→ {"id":3,"method":"session/prompt","params":{"sessionId":"<id>","prompt":[{"type":"text","text":"..."}]}}
← {"method":"session/update","params":{"sessionId":"<id>","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"..."}}}}
← {"id":3,"result":{"stopReason":"end_turn","userMessageId":"..."}}   // 或 "cancelled"
// 权限（agent→client 请求，client 必须应答）
← {"id":0,"method":"session/request_permission","params":{"sessionId":"...","options":[{"kind":"allow_always","name":"Always Allow","optionId":"allow_always"},{"kind":"allow_once","name":"Allow","optionId":"allow"},{"kind":"reject_once","name":"Reject","optionId":"reject"}],"toolCall":{"toolCallId":"call_x","rawInput":{"file_path":"hello.txt","content":"..."},"_meta":{"codebuddy.ai/toolName":"Write"}}}}
→ {"jsonrpc":"2.0","id":0,"result":{"outcome":{"outcome":"selected","optionId":"allow_always"}}}
// DeferExecuteTool（计划批准）：toolCall._meta["codebuddy.ai/toolName"]==="DeferExecuteTool"，rawInput.toolName==="ExitPlanMode"
// 其余事件
//   tool_call:        {"sessionUpdate":"tool_call","toolCallId":"...","title":"Write","status":"in_progress","rawInput":{},"_meta":{"codebuddy.ai/toolName":"Write"}}  ← rawInput 起始为空
//   tool_call_update: {"sessionUpdate":"tool_call_update","toolCallId":"...","rawInput":{"content":"hello"}}  ← 增量累积，不吐 chunk
//   usage_update:     {"sessionUpdate":"usage_update","used":24091,"size":168000,"cost":{...}}
//   config_option_update: {"sessionUpdate":"config_option_update","configOptions":[{"type":"select","id":"mode","currentValue":"default","options":[...]}]}
//   current_mode_update:  {"sessionUpdate":"current_mode_update","currentModeId":"plan"}
// 配置（probe5 实证：先试 set_mode，失败回退 set_config_option）
→ {"id":3,"method":"session/set_mode","params":{"sessionId":"...","modeId":"plan"}}
→ {"method":"session/set_config_option","params":{"sessionId":"...","configId":"model","value":"glm-5.2"}}
// 取消 = 通知（无 id）；cancel 后必须等 prompt 响应（stopReason:"cancelled"）落账才回 idle（spike 瑕疵⑤）
→ {"method":"session/cancel","params":{"sessionId":"..."}}
```

---

### Task 1: `acp/events.ts` — ACP 事件 → StreamChunk 纯映射

**Files:**
- Create: `src/providers/codebuddy/acp/events.ts`
- Test: `tests/acpEvents.test.ts`

**Interfaces:**
- Consumes: `StreamChunk`（type-only import from `../index`，类型级循环引用安全）。
- Produces（后续 Task 5/7 依赖，签名固定）:
  - `export interface AcpUpdate { sessionUpdate?: string; [key: string]: unknown }`
  - `mapSessionUpdate(update: AcpUpdate): StreamChunk | null` — thought→thinking、message→text、tool_call→tool、其余→null
  - `extractToolName(toolCall: { title?: unknown; _meta?: unknown }): string`
  - `summarizeRawInput(rawInput: unknown): string`
  - `mergeRawInput(prev: unknown, increment: unknown): unknown`（浅合并对象，其余覆盖）
  - `mapUsageUpdate(update: AcpUpdate): { used: number; size: number } | null`
  - `mapConfigUpdate(update: AcpUpdate): { mode?: string; model?: string } | null`
  - `isReplayUpdate(update: AcpUpdate): boolean`

- [x] **Step 1: 写失败测试** `tests/acpEvents.test.ts`

```ts
import {
    mapSessionUpdate, mapUsageUpdate, mapConfigUpdate,
    extractToolName, summarizeRawInput, mergeRawInput, isReplayUpdate,
} from '../src/providers/codebuddy/acp/events';

describe('mapSessionUpdate', () => {
    it('maps agent_thought_chunk to thinking chunk', () => {
        expect(mapSessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }))
            .toEqual({ type: 'thinking', content: 'hmm' });
    });
    it('maps agent_message_chunk to text chunk', () => {
        expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } }))
            .toEqual({ type: 'text', content: '你好' });
    });
    it('returns null for non-text content blocks', () => {
        expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'x' } })).toBeNull();
    });
    it('maps tool_call to tool chunk with _meta toolName and rawInput summary', () => {
        const chunk = mapSessionUpdate({
            sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write', rawInput: { file_path: '/a/b.md' },
            _meta: { 'codebuddy.ai/toolName': 'Write' },
        });
        expect(chunk).toEqual({ type: 'tool', content: '', toolName: 'Write', toolDetail: '/a/b.md' });
    });
    it.each(['tool_call_update', 'usage_update', 'config_option_update', 'current_mode_update',
        'session_info_update', 'available_commands_update', 'user_message_chunk'])('returns null for %s', (k) => {
        expect(mapSessionUpdate({ sessionUpdate: k })).toBeNull();
    });
});

describe('extractToolName / summarizeRawInput / mergeRawInput', () => {
    it('prefers _meta codebuddy toolName over title', () => {
        expect(extractToolName({ title: 'Write', _meta: { 'codebuddy.ai/toolName': 'Write' } })).toBe('Write');
        expect(extractToolName({ title: 'Bash' })).toBe('Bash');
        expect(extractToolName({})).toBe('tool');
    });
    it('summarizes rawInput by file_path then command then compact json', () => {
        expect(summarizeRawInput({ file_path: '/a/b.md' })).toBe('/a/b.md');
        expect(summarizeRawInput({ command: 'ls -la' })).toBe('ls -la');
        expect(summarizeRawInput({})).toBe('');
    });
    it('merges rawInput increments shallowly', () => {
        expect(mergeRawInput({ file_path: 'a' }, { content: 'x' })).toEqual({ file_path: 'a', content: 'x' });
        expect(mergeRawInput(null, { a: 1 })).toEqual({ a: 1 });
    });
});

describe('mapUsageUpdate / mapConfigUpdate / isReplayUpdate', () => {
    it('reads used/size from usage_update', () => {
        expect(mapUsageUpdate({ sessionUpdate: 'usage_update', used: 24091, size: 168000 }))
            .toEqual({ used: 24091, size: 168000 });
        expect(mapUsageUpdate({ sessionUpdate: 'usage_update' })).toBeNull();
    });
    it('reads mode/model currentValue from config_option_update', () => {
        expect(mapConfigUpdate({ sessionUpdate: 'config_option_update', configOptions: [
            { id: 'mode', currentValue: 'plan' }, { id: 'model', currentValue: 'glm-5.2' },
        ] })).toEqual({ mode: 'plan', model: 'glm-5.2' });
        expect(mapConfigUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toEqual({ mode: 'plan' });
    });
    it('detects history replay via _meta mode', () => {
        expect(isReplayUpdate({ _meta: { 'codebuddy.ai': { mode: 'history' } } })).toBe(true);
        expect(isReplayUpdate({})).toBe(false);
    });
});
```

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/acpEvents.test.ts` → 模块不存在报错。
- [x] **Step 3: 实现** `src/providers/codebuddy/acp/events.ts`

```ts
import type { StreamChunk } from '../index';

export interface AcpUpdate {
    sessionUpdate?: string;
    [key: string]: unknown;
}

function textOf(update: AcpUpdate): string | null {
    const content = update.content as { type?: unknown; text?: unknown } | undefined;
    if (content?.type === 'text' && typeof content.text === 'string') return content.text;
    return null;
}

export function extractToolName(toolCall: { title?: unknown; _meta?: unknown }): string {
    const meta = toolCall._meta as Record<string, unknown> | undefined;
    const metaName = meta?.['codebuddy.ai/toolName'];
    if (typeof metaName === 'string' && metaName) return metaName;
    if (typeof toolCall.title === 'string' && toolCall.title) return toolCall.title;
    return 'tool';
}

export function summarizeRawInput(rawInput: unknown): string {
    if (!rawInput || typeof rawInput !== 'object') return '';
    const input = rawInput as Record<string, unknown>;
    for (const key of ['file_path', 'path', 'command']) {
        const v = input[key];
        if (typeof v === 'string' && v) return v;
    }
    const keys = Object.keys(input);
    if (!keys.length) return '';
    try {
        const s = JSON.stringify(input);
        return s.length > 120 ? s.slice(0, 117) + '...' : s;
    } catch {
        return '';
    }
}

export function mergeRawInput(prev: unknown, increment: unknown): unknown {
    if (!increment || typeof increment !== 'object' || Array.isArray(increment)) return increment ?? prev;
    const base = prev && typeof prev === 'object' && !Array.isArray(prev) ? prev as Record<string, unknown> : {};
    return { ...base, ...(increment as Record<string, unknown>) };
}

export function mapSessionUpdate(update: AcpUpdate): StreamChunk | null {
    switch (update.sessionUpdate) {
        case 'agent_thought_chunk': {
            const text = textOf(update);
            return text === null ? null : { type: 'thinking', content: text };
        }
        case 'agent_message_chunk': {
            const text = textOf(update);
            return text === null ? null : { type: 'text', content: text };
        }
        case 'tool_call': {
            const toolName = extractToolName(update);
            return { type: 'tool', content: '', toolName, toolDetail: summarizeRawInput(update.rawInput) };
        }
        default:
            return null;
    }
}

export function mapUsageUpdate(update: AcpUpdate): { used: number; size: number } | null {
    if (update.sessionUpdate !== 'usage_update') return null;
    const { used, size } = update;
    if (typeof used !== 'number' || typeof size !== 'number') return null;
    return { used, size };
}

export function mapConfigUpdate(update: AcpUpdate): { mode?: string; model?: string } | null {
    if (update.sessionUpdate === 'current_mode_update') {
        return typeof update.currentModeId === 'string' ? { mode: update.currentModeId } : null;
    }
    if (update.sessionUpdate === 'config_option_update') {
        const out: { mode?: string; model?: string } = {};
        const options = Array.isArray(update.configOptions) ? update.configOptions : [];
        for (const opt of options as Array<{ id?: unknown; currentValue?: unknown }>) {
            if (opt.id === 'mode' && typeof opt.currentValue === 'string') out.mode = opt.currentValue;
            if (opt.id === 'model' && typeof opt.currentValue === 'string') out.model = opt.currentValue;
        }
        return Object.keys(out).length ? out : null;
    }
    return null;
}

export function isReplayUpdate(update: AcpUpdate): boolean {
    const meta = update._meta as Record<string, unknown> | undefined;
    const cb = meta?.['codebuddy.ai'] as { mode?: unknown } | undefined;
    return cb?.mode === 'history';
}
```

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/acpEvents.test.ts` 全绿。
- [x] **Step 5: Commit** — `git add src/providers/codebuddy/acp/events.ts tests/acpEvents.test.ts && git commit -m "feat(acp): add ACP event to StreamChunk pure mapping"`

---

### Task 2: `acp/permission.ts` — 权限请求 → 批准卡数据 + 应答构造

**Files:**
- Create: `src/providers/codebuddy/acp/permission.ts`
- Test: `tests/acpPermission.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，只用 `t()` from `../../../i18n`）。
- Produces（Task 5/8/11 依赖）:
  - `export interface PermissionOptionData { optionId: string; kind: string; label: string }`
  - `export type PermissionDetail = { kind:'write'; path: string; lines: number } | { kind:'edit'; path: string; oldText: string; newText: string } | { kind:'bash'; command: string } | { kind:'plan' } | { kind:'generic'; summary: string }`
  - `export interface PermissionCardData { requestId: number; sessionId: string; toolName: string; detail: PermissionDetail; options: PermissionOptionData[]; isPlanApproval: boolean }`
  - `mapPermissionRequest(requestId: number, params: unknown): PermissionCardData`
  - `buildPermissionResult(optionId: string): { outcome: { outcome: 'selected'; optionId: string } }`
  - `pickOptionId(options: PermissionOptionData[], kindPrefix: 'allow_once' | 'allow_always' | 'reject'): string | undefined`（kind 前缀匹配；allow_once 须排除 allow_always）

- [x] **Step 1: 写失败测试** `tests/acpPermission.test.ts`

```ts
import { mapPermissionRequest, buildPermissionResult, pickOptionId } from '../src/providers/codebuddy/acp/permission';

const OPTIONS = [
    { kind: 'allow_always', name: 'Always Allow', optionId: 'allow_always' },
    { kind: 'allow_once', name: 'Allow', optionId: 'allow' },
    { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
];

function paramsOf(toolName: string, rawInput: unknown, metaToolName?: string) {
    return {
        sessionId: 's1',
        options: OPTIONS,
        toolCall: { toolCallId: 'c1', rawInput, _meta: metaToolName ? { 'codebuddy.ai/toolName': metaToolName } : undefined },
    };
}

describe('mapPermissionRequest', () => {
    it('maps Write to path + line count', () => {
        const data = mapPermissionRequest(0, paramsOf('Write', { file_path: '/a/b.md', content: 'l1\nl2\nl3' }, 'Write'));
        expect(data).toMatchObject({ requestId: 0, sessionId: 's1', toolName: 'Write', isPlanApproval: false });
        expect(data.detail).toEqual({ kind: 'write', path: '/a/b.md', lines: 3 });
        expect(data.options).toEqual([
            { optionId: 'allow_always', kind: 'allow_always', label: 'Always Allow' },
            { optionId: 'allow', kind: 'allow_once', label: 'Allow' },
            { optionId: 'reject', kind: 'reject_once', label: 'Reject' },
        ]);
    });
    it('maps Edit to path + old/new text', () => {
        const data = mapPermissionRequest(1, paramsOf('Edit', { file_path: 'a.md', old_string: 'foo', new_string: 'bar' }, 'Edit'));
        expect(data.detail).toEqual({ kind: 'edit', path: 'a.md', oldText: 'foo', newText: 'bar' });
    });
    it('maps Bash to full command', () => {
        const data = mapPermissionRequest(2, paramsOf('Bash', { command: 'rm -rf /tmp/x' }, 'Bash'));
        expect(data.detail).toEqual({ kind: 'bash', command: 'rm -rf /tmp/x' });
    });
    it('flags DeferExecuteTool as plan approval', () => {
        const data = mapPermissionRequest(3, paramsOf('ExitPlanMode', { params: {}, toolName: 'ExitPlanMode' }, 'DeferExecuteTool'));
        expect(data.isPlanApproval).toBe(true);
        expect(data.detail).toEqual({ kind: 'plan' });
    });
    it('falls back to generic summary for unknown tools', () => {
        const data = mapPermissionRequest(4, paramsOf('WebFetch', { url: 'https://x.com' }, 'WebFetch'));
        expect(data.detail.kind).toBe('generic');
    });
});

describe('buildPermissionResult / pickOptionId', () => {
    it('builds the selected-outcome wire shape', () => {
        expect(buildPermissionResult('allow')).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    });
    it('picks option ids by kind prefix without confusing allow_once/allow_always', () => {
        const opts = mapPermissionRequest(0, paramsOf('Bash', {}, 'Bash')).options;
        expect(pickOptionId(opts, 'allow_once')).toBe('allow');
        expect(pickOptionId(opts, 'allow_always')).toBe('allow_always');
        expect(pickOptionId(opts, 'reject')).toBe('reject');
        expect(pickOptionId([], 'reject')).toBeUndefined();
    });
});
```

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/acpPermission.test.ts`。
- [x] **Step 3: 实现** `src/providers/codebuddy/acp/permission.ts`

```ts
export interface PermissionOptionData {
    optionId: string;
    kind: string;
    label: string;
}

export type PermissionDetail =
    | { kind: 'write'; path: string; lines: number }
    | { kind: 'edit'; path: string; oldText: string; newText: string }
    | { kind: 'bash'; command: string }
    | { kind: 'plan' }
    | { kind: 'generic'; summary: string };

export interface PermissionCardData {
    requestId: number;
    sessionId: string;
    toolName: string;
    detail: PermissionDetail;
    options: PermissionOptionData[];
    isPlanApproval: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function summarize(rawInput: Record<string, unknown>): string {
    try {
        const s = JSON.stringify(rawInput);
        return s.length > 200 ? s.slice(0, 197) + '...' : s;
    } catch {
        return '';
    }
}

function buildDetail(toolName: string, rawInput: Record<string, unknown>, isPlan: boolean): PermissionDetail {
    if (isPlan) return { kind: 'plan' };
    const path = typeof rawInput.file_path === 'string' ? rawInput.file_path
        : typeof rawInput.path === 'string' ? rawInput.path : '';
    if (toolName === 'Write' && typeof rawInput.content === 'string') {
        return { kind: 'write', path, lines: rawInput.content.split('\n').length };
    }
    if (toolName === 'Edit' || toolName === 'MultiEdit') {
        return {
            kind: 'edit', path,
            oldText: typeof rawInput.old_string === 'string' ? rawInput.old_string : '',
            newText: typeof rawInput.new_string === 'string' ? rawInput.new_string : '',
        };
    }
    if ((toolName === 'Bash' || toolName === 'Shell') && typeof rawInput.command === 'string') {
        return { kind: 'bash', command: rawInput.command };
    }
    return { kind: 'generic', summary: summarize(rawInput) };
}

export function mapPermissionRequest(requestId: number, params: unknown): PermissionCardData {
    const p = asRecord(params);
    const toolCall = asRecord(p.toolCall);
    const meta = asRecord(toolCall._meta);
    const rawInput = asRecord(toolCall.rawInput);
    const metaName = meta['codebuddy.ai/toolName'];
    const toolName = typeof metaName === 'string' && metaName ? metaName
        : typeof rawInput.toolName === 'string' ? rawInput.toolName
        : typeof toolCall.title === 'string' ? toolCall.title : 'tool';
    const isPlan = toolName === 'DeferExecuteTool' || rawInput.toolName === 'ExitPlanMode';
    const options: PermissionOptionData[] = (Array.isArray(p.options) ? p.options : []).map((o) => {
        const rec = asRecord(o);
        return {
            optionId: typeof rec.optionId === 'string' ? rec.optionId : '',
            kind: typeof rec.kind === 'string' ? rec.kind : '',
            label: typeof rec.name === 'string' ? rec.name : '',
        };
    }).filter((o) => o.optionId);
    return {
        requestId,
        sessionId: typeof p.sessionId === 'string' ? p.sessionId : '',
        toolName,
        detail: buildDetail(toolName, rawInput, isPlan),
        options,
        isPlanApproval: isPlan,
    };
}

export function buildPermissionResult(optionId: string): { outcome: { outcome: 'selected'; optionId: string } } {
    return { outcome: { outcome: 'selected', optionId } };
}

export function pickOptionId(
    options: PermissionOptionData[],
    kindPrefix: 'allow_once' | 'allow_always' | 'reject',
): string | undefined {
    const hit = options.find((o) => kindPrefix === 'allow_once'
        ? o.kind === 'allow_once'
        : o.kind.startsWith(kindPrefix));
    return hit?.optionId;
}
```

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/acpPermission.test.ts` 全绿。
- [x] **Step 5: Commit** — `git add src/providers/codebuddy/acp/permission.ts tests/acpPermission.test.ts && git commit -m "feat(acp): add permission request to approval-card pure mapping"`

---

### Task 3: `acp/client.ts` 传输核心 — ndjson 编解码 + JSON-RPC 分发 + spawn 构建

**Files:**
- Create: `src/providers/codebuddy/acp/client.ts`
- Test: `tests/acpClient.test.ts`

**Interfaces:**
- Consumes: `utils/cliPath.ts` 的 `resolveCodebuddyPath/isWindowsWrapper/isBareFallback/needsWindowsShell/findNodeExecutable`；`shared/logBuffer` 的 `bbLog`；`acp/events.ts` 的 `AcpUpdate`。
- Produces（Task 4/5/7 依赖）:
  - `export type AcpStartTier = 'cli-not-found' | 'acp-unsupported' | 'auth-required' | 'handshake-failed'`
  - `export class AcpStartError extends Error { readonly tier: AcpStartTier }`
  - `export interface AcpClientEvents { onSessionUpdate(sessionId: string, update: AcpUpdate): void; onPermissionRequest(requestId: number, params: unknown): void; onAgentNotification(method: string, params: unknown): void; onModels(models: string[]): void; onExit(code: number | null, signal: string | null): void }`
  - `export class AcpClient { constructor(events: AcpClientEvents); setCodebuddyPath(p: string): void; setNodePath(p: string): void; getScriptPath(): string; readonly running: boolean; ensureStarted(): Promise<void>; request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>; notify(method: string, params: Record<string, unknown>): void; respond(requestId: number, result: unknown): void; dispose(): void }`
  - 纯函数：`buildSpawnCommand(scriptPath, nodePathOverride, args): { command: string; args: string[]; shell: boolean }`、`classifyHandshakeFailure(stderr: string): AcpStartTier`、`isAuthError(message: string): boolean`

- [x] **Step 1: 写失败测试（编解码与分发）** `tests/acpClient.test.ts`，harness 沿用 `tests/api.test.ts:16-54` 的 createFakeProc 模式（`jest.mock('child_process')`，fake proc 记录 `stdinWrites`、`emit(event, ...args)` 驱动 stdout/stderr/close/error）。

```ts
import { spawn } from 'child_process';
import { AcpClient, buildSpawnCommand, classifyHandshakeFailure, isAuthError, type AcpClientEvents } from '../src/providers/codebuddy/acp/client';

jest.mock('child_process');
jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return { ...actual, existsSync: jest.fn(() => true) };
});
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createFakeProc() { /* 与 tests/api.test.ts:16-54 相同结构：
   stdin.write/stdin.end 记录、stdout.on/stderr.on/on 注册进 handlers、emit 触发 */ }

function makeClient() {
    const events: AcpClientEvents = {
        onSessionUpdate: jest.fn(), onPermissionRequest: jest.fn(),
        onAgentNotification: jest.fn(), onModels: jest.fn(), onExit: jest.fn(),
    };
    const client = new AcpClient(events);
    client.setCodebuddyPath('C:\\fake\\codebuddy.exe'); // isWindowsWrapper 分支：直接 spawn
    return { client, events };
}

describe('AcpClient codec & dispatch', () => {
    it('writes newline-delimited JSON-RPC requests with incrementing ids', async () => {
        const { proc, emit, stdinWrites } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);
        const { client } = makeClient();
        const started = client.ensureStarted();
        // 握手 initialize 是第一个请求；回 initialize 结果即完成启动
        emit('stdout', 'data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }) + '\n'));
        await started;
        const req = client.request('session/new', { cwd: '/v', mcpServers: [] });
        emit('stdout', 'data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { sessionId: 's1' } }) + '\n'));
        await expect(req).resolves.toEqual({ sessionId: 's1' });
        expect(JSON.parse(stdinWrites[0])).toMatchObject({ id: 1, method: 'initialize' });
        expect(JSON.parse(stdinWrites[1])).toMatchObject({ id: 2, method: 'session/new', params: { cwd: '/v' } });
    });
    it('routes session/update notifications by sessionId', async () => {
        // 启动后 emit 一条 session/update → events.onSessionUpdate('s1', update)
    });
    it('routes session/request_permission (incoming request) to onPermissionRequest', async () => {
        // emit {"id":0,"method":"session/request_permission","params":{...}} → onPermissionRequest(0, params)
        // client.respond(0, buildPermissionResult('allow')) → stdinWrites 含 {"id":0,"result":{"outcome":{...}}}
    });
    it('rejects pending request on JSON-RPC error response', async () => {
        // emit {"id":2,"error":{"code":-1,"message":"boom"}} → req rejects toThrow('boom')
    });
    it('routes _codebuddy.ai/* notifications to onAgentNotification', async () => { /* checkpoint */ });
    it('reports models from session/new result via onModels', async () => {
        // result 含 models.availableModels → onModels(['auto','hy3',...])
    });
});

describe('buildSpawnCommand / classifyHandshakeFailure / isAuthError', () => {
    it('spawns wrapper/bare paths directly, script via node', () => {
        expect(buildSpawnCommand('codebuddy', '', ['--acp'])).toEqual({ command: 'codebuddy', args: ['--acp'], shell: false });
        expect(buildSpawnCommand('C:\\cb\\codebuddy.cmd', '', ['--acp'])).toEqual({ command: 'C:\\cb\\codebuddy.cmd', args: ['--acp'], shell: false });
        expect(buildSpawnCommand('/usr/local/bin/codebuddy', '', ['--acp']))
            .toEqual({ command: expect.stringMatching(/node/), args: ['/usr/local/bin/codebuddy', '--acp'], shell: false });
    });
    it('classifies old CLI without --acp', () => {
        expect(classifyHandshakeFailure('error: unrecognized option: --acp')).toBe('acp-unsupported');
        expect(classifyHandshakeFailure('some other failure')).toBe('handshake-failed');
    });
    it('detects auth errors', () => {
        expect(isAuthError('authentication required')).toBe(true);
        expect(isAuthError('not logged in')).toBe(true);
        expect(isAuthError('boom')).toBe(false);
    });
});
```

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/acpClient.test.ts`。
- [x] **Step 3: 实现 client.ts 传输核心**（本 Task 只到"启动=spawn+initialize 握手成功"；预检分级在 Task 4 补全，本 Task 让 ENOENT/早退先抛通用 `AcpStartError('handshake-failed', ...)`）

```ts
import { spawn } from 'child_process';
import { findNodeExecutable, isBareFallback, isWindowsWrapper, needsWindowsShell, resolveCodebuddyPath } from '../../../utils/cliPath';
import { bbLog } from '../../../shared/logBuffer';
import type { AcpUpdate } from './events';

export type AcpStartTier = 'cli-not-found' | 'acp-unsupported' | 'auth-required' | 'handshake-failed';

export class AcpStartError extends Error {
    constructor(readonly tier: AcpStartTier, message: string) {
        super(message);
        this.name = 'AcpStartError';
    }
}

export interface AcpClientEvents {
    onSessionUpdate(sessionId: string, update: AcpUpdate): void;
    onPermissionRequest(requestId: number, params: unknown): void;
    onAgentNotification(method: string, params: unknown): void;
    onModels(models: string[]): void;
    onExit(code: number | null, signal: string | null): void;
}

export function buildSpawnCommand(scriptPath: string, nodePathOverride: string, args: string[]):
    { command: string; args: string[]; shell: boolean } {
    if (isWindowsWrapper(scriptPath) || isBareFallback(scriptPath)) {
        return { command: scriptPath, args, shell: needsWindowsShell(scriptPath) };
    }
    const node = nodePathOverride || findNodeExecutable() || 'node';
    return { command: node, args: [scriptPath, ...args], shell: false };
}

export function classifyHandshakeFailure(stderr: string): AcpStartTier {
    return /unrecogni[sz]ed|unknown (option|command|flag)|invalid option|unknown argument/i.test(stderr)
        ? 'acp-unsupported' : 'handshake-failed';
}

export function isAuthError(message: string): boolean {
    return /auth|login|unauthorized|登录|未登录/i.test(message);
}

const HANDSHAKE_TIMEOUT_MS = 10_000;

export class AcpClient {
    private scriptPath = '';
    private nodePath = '';
    private proc: ReturnType<typeof spawn> | null = null;
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private buffer = '';
    private stderrTail = '';
    private startPromise: Promise<void> | null = null;

    constructor(private readonly events: AcpClientEvents) {
        this.scriptPath = resolveCodebuddyPath('');
    }

    setCodebuddyPath(p: string): void { this.scriptPath = resolveCodebuddyPath(p); }
    setNodePath(p: string): void { this.nodePath = p; }
    getScriptPath(): string { return this.scriptPath; }
    get running(): boolean { return this.proc !== null; }

    ensureStarted(): Promise<void> {
        if (this.proc) return Promise.resolve();
        if (this.startPromise) return this.startPromise;
        this.startPromise = this.spawnAndHandshake().catch((e) => { this.startPromise = null; throw e; });
        return this.startPromise;
    }

    request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
        const id = this.nextId++;
        this.write({ jsonrpc: '2.0', id, method, params });
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        });
    }

    notify(method: string, params: Record<string, unknown>): void {
        this.write({ jsonrpc: '2.0', method, params });
    }

    respond(requestId: number, result: unknown): void {
        this.write({ jsonrpc: '2.0', id: requestId, result });
    }

    dispose(): void {
        const proc = this.proc;
        this.proc = null;
        this.startPromise = null;
        this.failAllPending(new Error('acp client disposed'));
        if (proc) { try { proc.kill(); } catch { /* 已退出 */ } }
    }

    // ---- 内部 ----

    private write(msg: Record<string, unknown>): void {
        if (!this.proc) throw new Error('acp client not started');
        this.proc.stdin.write(JSON.stringify(msg) + '\n');
    }

    private failAllPending(err: Error): void {
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
    }

    private handleLine(line: string): void {
        let msg: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { message?: string } };
        try { msg = JSON.parse(line); } catch { bbLog('[WB] acp 非 JSON 行:', line.slice(0, 200)); return; }
        if (typeof msg.method === 'string' && msg.id !== undefined) {
            // agent → client 请求（目前只有 session/request_permission）
            if (msg.method === 'session/request_permission' && typeof msg.id === 'number') {
                this.events.onPermissionRequest(msg.id, msg.params);
            }
            return;
        }
        if (typeof msg.method === 'string') {
            this.handleNotification(msg.method, msg.params);
            return;
        }
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) { p.reject(new Error(msg.error.message || 'acp rpc error')); return; }
            this.reportModels(msg.result);
            p.resolve(msg.result);
        }
    }

    private handleNotification(method: string, params: unknown): void {
        const rec = params && typeof params === 'object' ? params as Record<string, unknown> : {};
        if (method === 'session/update') {
            const sessionId = typeof rec.sessionId === 'string' ? rec.sessionId : '';
            const update = rec.update as AcpUpdate | undefined;
            if (sessionId && update) this.events.onSessionUpdate(sessionId, update);
            return;
        }
        this.events.onAgentNotification(method, params);
    }

    private reportModels(result: unknown): void {
        const models = (result as { models?: { availableModels?: Array<{ modelId?: unknown }> } })?.models?.availableModels;
        if (Array.isArray(models) && models.length) {
            this.events.onModels(models.map((m) => String(m.modelId)).filter(Boolean));
        }
    }
}
```

（`spawnAndHandshake` 在 Task 4 实现；本 Task 先给一个最小版：spawn → `request('initialize', {...})` → 成功即置 proc，失败 kill 并抛 `AcpStartError('handshake-failed', ...)`，保证测试 Step 1 通过。）

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/acpClient.test.ts` 全绿。
- [x] **Step 5: Commit** — `git add src/providers/codebuddy/acp/client.ts tests/acpClient.test.ts && git commit -m "feat(acp): add ndjson JSON-RPC transport core"`

---

### Task 4: AcpClient 生命周期 — 懒启动握手 10s 超时 / 预检分级 / 死亡通知 / dispose

**Files:**
- Modify: `src/providers/codebuddy/acp/client.ts`
- Test: `tests/acpClient.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 3 全部。
- Produces: `ensureStarted()` 完整语义（供 Task 7）：
  - CLI 不存在（spawn `error` 事件 ENOENT）→ `AcpStartError('cli-not-found')`
  - 握手前进程早退且 stderr 命中未知选项 → `AcpStartError('acp-unsupported')`；其他早退 → `AcpStartError('handshake-failed', stderr 摘要)`
  - 握手 10s 超时 → `AcpStartError('handshake-failed', 'timeout')`
  - 进程运行中 `close` → 拒绝全部 pending request → `events.onExit(code, signal)`；`running` 变 false；下次 `ensureStarted()` 重新 spawn（死亡后自动重启由 provider 驱动，client 只保证可重入）

- [x] **Step 1: 写失败测试（追加）**

```ts
describe('AcpClient lifecycle', () => {
    it('rejects ensureStarted with cli-not-found on ENOENT spawn error', async () => {
        // emit('', 'error', new Error('spawn codebuddy ENOENT')) → ensureStarted rejects，err.tier === 'cli-not-found'
    });
    it('classifies early exit with unknown-option stderr as acp-unsupported', async () => {
        // emit('stderr','data', Buffer.from('error: unrecognized option: --acp')) + emit('','close',1,null)
        // → rejects，tier === 'acp-unsupported'
    });
    it('times out handshake after 10s', async () => {
        jest.useFakeTimers(); // 不回 initialize → advanceTimersByTime(10_000) → rejects 'handshake-failed'
    });
    it('rejects in-flight requests and fires onExit when process dies mid-session', async () => {
        // 启动 → 发 request（pending）→ emit('','close',1,null) → request rejects、onExit 被调、running===false
    });
    it('respawns on next ensureStarted after death', async () => {
        // 死亡后再次 ensureStarted → mockedSpawn 被调 2 次
    });
});
```

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/acpClient.test.ts -t lifecycle`。
- [x] **Step 3: 实现 `spawnAndHandshake` + 死亡处理**（完整版，替换 Task 3 的最小版）

```ts
private spawnAndHandshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const { command, args, shell } = buildSpawnCommand(this.scriptPath, this.nodePath, ['--acp']);
        let proc: ReturnType<typeof spawn>;
        const fail = (err: AcpStartError) => { this.proc = null; try { proc?.kill(); } catch { /* noop */ } reject(err); };
        try {
            proc = spawn(command, args, { shell, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
            reject(new AcpStartError('cli-not-found', String(e)));
            return;
        }
        this.proc = proc;
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) { settled = true; fail(new AcpStartError('handshake-failed', 'handshake timeout')); }
        }, HANDSHAKE_TIMEOUT_MS);

        proc.stdout.on('data', (data: Buffer) => {
            this.buffer += data.toString('utf8');
            let idx: number;
            while ((idx = this.buffer.indexOf('\n')) >= 0) {
                const line = this.buffer.slice(0, idx).trim();
                this.buffer = this.buffer.slice(idx + 1);
                if (line) this.handleLine(line);
            }
        });
        proc.stderr.on('data', (data: Buffer) => {
            const text = data.toString('utf8');
            bbLog('[WB] acp stderr:', text.trim());
            this.stderrTail = (this.stderrTail + text).slice(-2000);
        });
        proc.on('error', (e: Error) => {
            if (!settled) {
                settled = true; clearTimeout(timer);
                fail(new AcpStartError(e.message.includes('ENOENT') ? 'cli-not-found' : 'handshake-failed', e.message));
            }
        });
        proc.on('close', (code: number | null, signal: string | null) => {
            const wasStarting = !settled;
            this.proc = null;
            this.buffer = '';
            this.failAllPending(new Error('acp process exited'));
            if (wasStarting) {
                settled = true; clearTimeout(timer);
                fail(new AcpStartError(classifyHandshakeFailure(this.stderrTail), this.stderrTail.trim().slice(-300) || `exit ${code}`));
                return;
            }
            this.events.onExit(code, signal);
        });

        // 握手：initialize 成功即启动完成
        this.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        }).then(() => {
            if (!settled) { settled = true; clearTimeout(timer); resolve(); }
        }, (e: Error) => {
            if (!settled) {
                settled = true; clearTimeout(timer);
                fail(new AcpStartError(isAuthError(e.message) ? 'auth-required' : 'handshake-failed', e.message));
            }
        });
    });
}
```

注意：`handleLine` 里 `session/request_permission` 之外如未来出现其他 agent→client 请求，静默忽略（不回方法不存在错误，YAGNI）。`dispose()` 中 `proc.kill()` 触发 `close` 时 `wasStarting===false` 会走 `events.onExit`——dispose 前把 `this.proc=null` 后再 kill，并在 close 处理器开头判 `if (this.proc === null && settled) return;` 防重复（实现时以测试校准）。

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/acpClient.test.ts` 全绿。
- [x] **Step 5: Commit** — `git commit -m "feat(acp): add client lifecycle with preflight tiers and death handling"`

---

### Task 5: `acp/session.ts` — AcpSession 状态机 + SessionRegistry

**Files:**
- Create: `src/providers/codebuddy/acp/session.ts`
- Test: `tests/acpSession.test.ts`

**Interfaces:**
- Consumes: `acp/events.ts`（全部映射函数）、`acp/permission.ts`（`mapPermissionRequest/buildPermissionResult/pickOptionId/PermissionCardData`）、`StreamChunk`（type-only from `../index`）。
- Produces（Task 7/8 依赖，签名固定）:
  - `export interface AcpClientFacade { request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>; notify(method: string, params: Record<string, unknown>): void; respond(requestId: number, result: unknown): void }`
  - `export interface ConversationLookup { getAcpSessionId(key: string): string | undefined; setAcpSessionId(key: string, acpSessionId: string): void }`
  - `export interface TurnHandlers { onChunk(chunk: StreamChunk): void; onError(message: string): void; onPermissionRequest?(data: PermissionCardData): void; onUsage?(used: number, size: number): void; onConfigUpdate?(cfg: { mode?: string; model?: string }): void }`
  - `export type SessionStatus = 'idle' | 'loading' | 'prompting' | 'awaitingPermission'`
  - `export interface SessionConfig { model: string; mode: string }`（对象引用共享，provider 改字段即对新会话生效）
  - `export class AcpSession { readonly key: string; acpSessionId: string | null; status: SessionStatus; lastUsage: { used: number; size: number } | null; ensureLoaded(vaultPath?: string): Promise<void>; prompt(text: string, handlers: TurnHandlers): Promise<{ stopReason: string }>; handleUpdate(update: AcpUpdate): void; handlePermissionRequest(requestId: number, params: unknown): void; hasPendingPermission(requestId: number): boolean; respondPermission(requestId: number, optionId: string): boolean; rejectPendingPermissions(): void; cancelTurn(): Promise<void>; failTurn(message: string): void }`
  - `export class SessionRegistry { get(key: string): AcpSession; find(key: string): AcpSession | undefined; byAcpId(acpSessionId: string): AcpSession | undefined; all(): AcpSession[] }`

**状态机：** `idle → loading → idle`（懒加载）；`idle → prompting → (awaitingPermission → prompting)* → idle`（prompt 响应落账才回 idle——cancel 也必须等 `stopReason:'cancelled'` 响应，spike 瑕疵⑤兜底）。`loading` 期间全部 update 吞掉（回放不进 UI），`isReplayUpdate` 兜底。

**ensureLoaded 懒加载链：** `lookup.getAcpSessionId(key)` 有 → `session/load(该 id)`；无 → 先试 `session/load(key)`（v1 uuid 兼容）→ 失败则 `session/new` + `lookup.setAcpSessionId` 回写。加载后应用 `SessionConfig`（model→`session/set_config_option`，mode→`session/set_mode` 失败回退 `set_config_option`；仅 bbLog 不 fail）。加载/新建结果里的 models 由 client 层统一上报（Task 3 `reportModels`），session 不管。

- [x] **Step 1: 写失败测试** `tests/acpSession.test.ts`（fake facade：手写 jest.fn 对象，不用 jest.mock）

```ts
import { AcpSession, SessionRegistry, type AcpClientFacade, type ConversationLookup, type TurnHandlers } from '../src/providers/codebuddy/acp/session';

function makeFakeClient() {
    return {
        request: jest.fn(async (method: string, _params: Record<string, unknown>) => {
            if (method === 'session/new') return { sessionId: 'acp-new-1' };
            if (method === 'session/load') throw new Error('session not found');
            return {};
        }),
        notify: jest.fn(),
        respond: jest.fn(),
    } as unknown as AcpClientFacade & { request: jest.Mock; notify: jest.Mock; respond: jest.Mock };
}
function makeLookup(): ConversationLookup & { getAcpSessionId: jest.Mock; setAcpSessionId: jest.Mock } {
    return { getAcpSessionId: jest.fn(() => undefined), setAcpSessionId: jest.fn() };
}
function makeHandlers(): TurnHandlers & { onChunk: jest.Mock; onError: jest.Mock } {
    return { onChunk: jest.fn(), onError: jest.fn() };
}

describe('AcpSession.ensureLoaded', () => {
    it('creates new session and writes back acpSessionId when nothing stored and old-uuid load fails', async () => {
        const client = makeFakeClient(); const lookup = makeLookup();
        const s = new AcpSession('v1-uuid', client, lookup, { model: 'auto', mode: 'default' });
        await s.ensureLoaded('/vault');
        expect(client.request).toHaveBeenCalledWith('session/load', expect.objectContaining({ sessionId: 'v1-uuid' }));
        expect(client.request).toHaveBeenCalledWith('session/new', expect.objectContaining({ cwd: '/vault', mcpServers: [] }));
        expect(s.acpSessionId).toBe('acp-new-1');
        expect(lookup.setAcpSessionId).toHaveBeenCalledWith('v1-uuid', 'acp-new-1');
    });
    it('loads stored acpSessionId directly', async () => {
        const client = makeFakeClient();
        client.request = jest.fn(async (m: string) => m === 'session/load' ? {} : {}) as any;
        const lookup = makeLookup(); lookup.getAcpSessionId.mockReturnValue('acp-stored');
        const s = new AcpSession('v1-uuid', client, lookup, { model: 'auto', mode: 'default' });
        await s.ensureLoaded('/vault');
        expect(client.request).toHaveBeenCalledWith('session/load', expect.objectContaining({ sessionId: 'acp-stored' }));
        expect(s.acpSessionId).toBe('acp-stored');
    });
    it('applies mode/model config after load (set_mode first, set_config_option for model)', async () => {
        // 断言 client.request 被调：session/set_mode {modeId:'plan'} 与 session/set_config_option {configId:'model',value:'glm-5.2'}
    });
});

describe('AcpSession.prompt + updates', () => {
    it('maps updates to chunks during prompting and resolves on end_turn', async () => {
        const client = makeFakeClient();
        client.request = jest.fn(async (m: string) => m === 'session/load' ? {} : m === 'session/prompt' ? { stopReason: 'end_turn' } : {}) as any;
        const s = new AcpSession('k', client, makeLookup(), { model: 'auto', mode: 'default' });
        await s.ensureLoaded('/v');
        const handlers = makeHandlers();
        const done = s.prompt('hi', handlers);
        s.handleUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } });
        s.handleUpdate({ sessionUpdate: 'usage_update', used: 100, size: 168000 });
        await expect(done).resolves.toEqual({ stopReason: 'end_turn' });
        expect(handlers.onChunk).toHaveBeenCalledWith({ type: 'text', content: '你好' });
        expect(s.lastUsage).toEqual({ used: 100, size: 168000 });
        expect(s.status).toBe('idle');
    });
    it('swallows replay updates while loading', async () => {
        // ensureLoaded 未 resolve 时 handleUpdate → onChunk 不被调
    });
    it('accumulates tool_call_update rawInput without emitting chunks', async () => {
        // tool_call（rawInput:{}）→ 一个 tool chunk；tool_call_update → 不再吐 chunk
    });
});

describe('AcpSession permission', () => {
    it('parks permission request, forwards card data, responds on respondPermission', async () => {
        // prompting 中 handlePermissionRequest(0, params) → onPermissionRequest 收到 PermissionCardData、status==='awaitingPermission'
        // respondPermission(0,'allow') → client.respond(0,{outcome:{outcome:'selected',optionId:'allow'}})、status 回 'prompting'
    });
    it('auto-rejects when no handler registered', async () => {
        // handlers 无 onPermissionRequest → client.respond 以 reject optionId
    });
    it('rejectPendingPermissions answers reject for all parked requests', async () => { /* 2 个悬挂 → 2 次 respond */ });
});

describe('AcpSession cancel & failure', () => {
    it('cancelTurn notifies session/cancel and prompt resolves on cancelled result', async () => {
        // prompt 挂起 → cancelTurn() → notify('session/cancel') → 模拟 prompt resolve {stopReason:'cancelled'} → status 'idle'
    });
    it('failTurn pushes error and rejects nothing itself', async () => {
        // failTurn('died') → handlers.onError('died')
    });
});

describe('SessionRegistry', () => {
    it('get creates once, find/byAcpId route correctly', async () => { /* get('a')===get('a')；byAcpId 在 ensureLoaded 后命中 */ });
});
```

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/acpSession.test.ts`。
- [x] **Step 3: 实现** `src/providers/codebuddy/acp/session.ts`

```ts
import type { StreamChunk } from '../index';
import {
    mapSessionUpdate, mapUsageUpdate, mapConfigUpdate, mergeRawInput, isReplayUpdate, type AcpUpdate,
} from './events';
import {
    mapPermissionRequest, buildPermissionResult, pickOptionId, type PermissionCardData,
} from './permission';
import { bbLog } from '../../../shared/logBuffer';

export interface AcpClientFacade {
    request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
    notify(method: string, params: Record<string, unknown>): void;
    respond(requestId: number, result: unknown): void;
}

export interface ConversationLookup {
    getAcpSessionId(key: string): string | undefined;
    setAcpSessionId(key: string, acpSessionId: string): void;
}

export interface TurnHandlers {
    onChunk(chunk: StreamChunk): void;
    onError(message: string): void;
    onPermissionRequest?(data: PermissionCardData): void;
    onUsage?(used: number, size: number): void;
    onConfigUpdate?(cfg: { mode?: string; model?: string }): void;
}

export type SessionStatus = 'idle' | 'loading' | 'prompting' | 'awaitingPermission';

export interface SessionConfig { model: string; mode: string }

export class AcpSession {
    acpSessionId: string | null = null;
    status: SessionStatus = 'idle';
    lastUsage: { used: number; size: number } | null = null;
    private handlers: TurnHandlers | null = null;
    private pendingPermissions = new Map<number, PermissionCardData>();
    private toolInputs = new Map<string, unknown>();

    constructor(
        readonly key: string,
        private readonly client: AcpClientFacade,
        private readonly lookup: ConversationLookup,
        private readonly config: SessionConfig,
    ) {}

    async ensureLoaded(vaultPath?: string): Promise<void> {
        if (this.acpSessionId) return;
        this.status = 'loading';
        try {
            const stored = this.lookup.getAcpSessionId(this.key);
            const candidate = stored ?? this.key;
            try {
                await this.client.request('session/load', { sessionId: candidate, cwd: vaultPath ?? '', mcpServers: [] });
                this.acpSessionId = candidate;
            } catch {
                const result = await this.client.request<{ sessionId: string }>('session/new', { cwd: vaultPath ?? '', mcpServers: [] });
                this.acpSessionId = result.sessionId;
            }
            this.lookup.setAcpSessionId(this.key, this.acpSessionId);
            await this.applyConfig();
        } finally {
            this.status = 'idle';
        }
    }

    private async applyConfig(): Promise<void> {
        const sessionId = this.acpSessionId;
        if (!sessionId) return;
        try {
            if (this.config.model) {
                await this.client.request('session/set_config_option', { sessionId, configId: 'model', value: this.config.model });
            }
        } catch (e) { bbLog('[WB] acp 设置模型失败（忽略）:', e); }
        try {
            if (this.config.mode) {
                try {
                    await this.client.request('session/set_mode', { sessionId, modeId: this.config.mode });
                } catch {
                    await this.client.request('session/set_config_option', { sessionId, configId: 'mode', value: this.config.mode });
                }
            }
        } catch (e) { bbLog('[WB] acp 设置权限模式失败（忽略）:', e); }
    }

    async applyRemoteConfig(): Promise<void> { await this.applyConfig(); }  // provider setModel/setPermissionMode 用

    async prompt(text: string, handlers: TurnHandlers): Promise<{ stopReason: string }> {
        if (this.status !== 'idle') throw new Error('session busy');
        if (!this.acpSessionId) throw new Error('session not loaded');
        this.status = 'prompting';
        this.handlers = handlers;
        this.toolInputs.clear();
        try {
            const result = await this.client.request<{ stopReason?: string }>('session/prompt', {
                sessionId: this.acpSessionId,
                prompt: [{ type: 'text', text }],
            });
            return { stopReason: typeof result.stopReason === 'string' ? result.stopReason : 'end_turn' };
        } finally {
            this.status = 'idle';
            this.handlers = null;
            this.pendingPermissions.clear();
        }
    }

    handleUpdate(update: AcpUpdate): void {
        if (this.status === 'loading' || isReplayUpdate(update)) return;
        const handlers = this.handlers;
        if (!handlers) return;
        if (update.sessionUpdate === 'tool_call_update') {
            const id = typeof update.toolCallId === 'string' ? update.toolCallId : '';
            if (id) this.toolInputs.set(id, mergeRawInput(this.toolInputs.get(id), update.rawInput));
            return; // 增量渲染属第二步，这里只累积
        }
        const usage = mapUsageUpdate(update);
        if (usage) { this.lastUsage = usage; handlers.onUsage?.(usage.used, usage.size); return; }
        const config = mapConfigUpdate(update);
        if (config) { handlers.onConfigUpdate?.(config); return; }
        const chunk = mapSessionUpdate(update);
        if (chunk) {
            if (chunk.type === 'tool' && typeof update.toolCallId === 'string') {
                this.toolInputs.set(update.toolCallId, update.rawInput ?? {});
            }
            handlers.onChunk(chunk);
        }
    }

    handlePermissionRequest(requestId: number, params: unknown): void {
        const data = mapPermissionRequest(requestId, params);
        const handlers = this.handlers;
        if (!handlers?.onPermissionRequest) {
            const rejectId = pickOptionId(data.options, 'reject') ?? 'reject';
            this.client.respond(requestId, buildPermissionResult(rejectId));
            return;
        }
        this.pendingPermissions.set(requestId, data);
        this.status = 'awaitingPermission';
        handlers.onPermissionRequest(data);
    }

    hasPendingPermission(requestId: number): boolean { return this.pendingPermissions.has(requestId); }

    respondPermission(requestId: number, optionId: string): boolean {
        if (!this.pendingPermissions.delete(requestId)) return false;
        this.client.respond(requestId, buildPermissionResult(optionId));
        if (this.status === 'awaitingPermission') this.status = 'prompting';
        return true;
    }

    rejectPendingPermissions(): void {
        for (const [requestId, data] of this.pendingPermissions) {
            this.client.respond(requestId, buildPermissionResult(pickOptionId(data.options, 'reject') ?? 'reject'));
        }
        this.pendingPermissions.clear();
        if (this.status === 'awaitingPermission') this.status = 'prompting';
    }

    async cancelTurn(): Promise<void> {
        if (this.status !== 'prompting' && this.status !== 'awaitingPermission') return;
        this.rejectPendingPermissions();
        if (this.acpSessionId) this.client.notify('session/cancel', { sessionId: this.acpSessionId });
        // prompt() 的 finally 在 cancelled 响应落账时把 status 归 idle——这里不主动改 status
    }

    failTurn(message: string): void {
        this.handlers?.onError(message);
    }
}

export class SessionRegistry {
    private sessions = new Map<string, AcpSession>();

    constructor(
        private readonly client: AcpClientFacade,
        private readonly lookup: ConversationLookup,
        private readonly config: SessionConfig,
    ) {}

    get(key: string): AcpSession {
        let s = this.sessions.get(key);
        if (!s) {
            s = new AcpSession(key, this.client, this.lookup, this.config);
            this.sessions.set(key, s);
        }
        return s;
    }

    find(key: string): AcpSession | undefined { return this.sessions.get(key); }
    byAcpId(acpSessionId: string): AcpSession | undefined {
        for (const s of this.sessions.values()) if (s.acpSessionId === acpSessionId) return s;
        return undefined;
    }
    all(): AcpSession[] { return [...this.sessions.values()]; }
}
```

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/acpSession.test.ts` 全绿。
- [x] **Step 5: Commit** — `git commit -m "feat(acp): add session state machine and registry"`

---

### Task 6: `Conversation.acpSessionId` + manager 支持

**Files:**
- Modify: `src/types/index.ts:18-27`（Conversation 加字段）
- Modify: `src/core/session/manager.ts`（约 :160-180，加两个方法；loadConversations 归一化放行 acpSessionId）
- Test: `tests/manager.test.ts`（追加）

**Interfaces:**
- Consumes: 无。
- Produces（Task 7/9 依赖）:
  - `Conversation.acpSessionId?: string`（CLI 分配；现有 `sessionId` 保留为 v1 兼容字段）
  - `ConversationManager.setAcpSessionId(convId: string, acpSessionId: string): void`（镜像 `setSessionId` :166-171，不触发 persist，靠同轮 flush 落盘）
  - `ConversationManager.findBySessionId(sessionId: string): Conversation | undefined`（扫描 Map values）

- [x] **Step 1: 写失败测试**（追加到 `tests/manager.test.ts`）

```ts
describe('acpSessionId', () => {
    it('setAcpSessionId stores id without persisting immediately', () => {
        const manager = new ConversationManager();
        const persist = jest.fn();
        manager.setPersistCallback(persist);
        const conv = manager.createConversation();
        persist.mockClear();
        manager.setAcpSessionId(conv.id, 'acp-1');
        expect(manager.getById(conv.id)?.acpSessionId).toBe('acp-1');
        expect(persist).not.toHaveBeenCalled();
    });
    it('findBySessionId locates conversation by v1 sessionId', () => {
        const manager = new ConversationManager();
        const conv = manager.createConversation();
        manager.setSessionId(conv.id, 'v1-uuid');
        expect(manager.findBySessionId('v1-uuid')?.id).toBe(conv.id);
        expect(manager.findBySessionId('nope')).toBeUndefined();
    });
    it('acpSessionId survives loadConversations normalize', () => {
        const manager = new ConversationManager();
        manager.loadConversations([{ id: 'c1', title: 't', sessionId: 's', acpSessionId: 'acp-9', messages: [], createdAt: 1, updatedAt: 1 }]);
        expect(manager.getById('c1')?.acpSessionId).toBe('acp-9');
    });
});
```

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/manager.test.ts -t acpSessionId`。
- [x] **Step 3: 实现**
  - `src/types/index.ts` Conversation 接口 `sessionId: string;` 行后加：`/** ACP 持久会话 id（CLI 分配）；sessionId 保留为 v1 兼容字段 */ acpSessionId?: string;`
  - `src/core/session/manager.ts` `setSessionId` 方法后加：

```ts
/** 回写 CLI 分配的 ACP 会话 id；与 setSessionId 一样不单独触发持久化，靠同轮后续 persist/flush 顺带落盘 */
setAcpSessionId(convId: string, acpSessionId: string): void {
    const conv = this.conversations.get(convId);
    if (conv) conv.acpSessionId = acpSessionId;
}

/** 按 v1 sessionId（provider 会话 key）反查会话，供 provider 会话查询注入用 */
findBySessionId(sessionId: string): Conversation | undefined {
    for (const conv of this.conversations.values()) if (conv.sessionId === sessionId) return conv;
    return undefined;
}
```
  - 检查 `loadConversations` 归一化：若按字段白名单拷贝，补 `acpSessionId` 放行（实现时读 manager.ts 加载段校准）。

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/manager.test.ts tests/types.test.ts` 全绿。
- [x] **Step 5: Commit** — `git commit -m "feat(session): add acpSessionId to Conversation with manager support"`

---

### Task 7: `CodebuddyProvider` v2 核心重写（index.ts）+ `tests/api.test.ts` 改写

**Files:**
- Rewrite: `src/providers/codebuddy/index.ts`（402 行 → 约 330 行；删 `parseStreamLine/parseMessageBlock/blockToChunk/parseUsage/parseStreamEvent/MessageBlock/StreamEvent`、`--add-dir` 预授权（旧 :258-267）、内联 spawn 三分支（移交 client.ts））
- Rewrite: `tests/api.test.ts`（删全部解析 describe（旧 :366-793）与 sendMessage CLI 参数契约 describe；**保留** cliPath/Node 发现/Windows 分支 describe 原样；provider 用例改为 mock AcpClient 的生成器契约）

**Interfaces:**
- Consumes: Task 3-6 全部（`AcpClient/AcpStartError`、`SessionRegistry/AcpSession/TurnHandlers/ConversationLookup/SessionConfig`、`PermissionCardData`）。
- Produces（Task 8-11 依赖，签名固定）:
  - `CodebuddyProvider` 现有公共方法原样保留（见 Global Constraints）；`cancel(sessionId?: string)`：有参→定向 cancel 该会话在飞轮次；无参→cancel 所有在飞轮次
  - `setConversationLookup(lookup: ConversationLookup): void`（main.ts 注入点）
  - `onPermissionRequest(sessionKey: string, cb: (data: PermissionCardData) => void): void`
  - `onUsage(sessionKey: string, cb: (used: number, size: number) => void): void`
  - `onConfigUpdate(sessionKey: string, cb: (cfg: { mode?: string; model?: string }) => void): void`
  - `respondPermission(requestId: number, optionId: string): void`
  - `rejectPendingPermissions(sessionKey?: string): void`
  - `dispose(): void`
- 生成器行为契约（测试断言目标）:
  - 启动/加载失败 → throw（tier 映射：cli-not-found→`t('provider.cliNotFound')`；acp-unsupported→`t('provider.acpUnsupported')`；auth-required→`t('provider.notLoggedIn')`；其他→`t('provider.handshakeFailed')`）
  - 流式 chunk 原样 yield；`end_turn` → 尾发 `{type:'done', content:'', usage:{inputTokens:lastUsed}}`；`cancelled` → 静默结束（无 done chunk，对齐 v1）；其他 stopReason → throw `t('provider.turnFailed')`
  - 单轮超时（`this.timeout`）→ `session.cancelTurn()` + throw `t('provider.turnTimeout')`（进程保活）
  - 进程死亡 → 在飞轮次 throw `t('provider.processDied')`；下次 sendMessage 自动重启 + 受影响会话 `session/load` 恢复
  - 会话忙（同 key 重入）→ throw `t('provider.busy')`

- [x] **Step 1: 改写测试** `tests/api.test.ts`。保留文件头部 import 与 cliPath 相关 describe；provider 部分换成下面的 harness + 用例：

```ts
import { CodebuddyProvider } from '../src/providers/codebuddy';
import { AcpClient, type AcpClientEvents } from '../src/providers/codebuddy/acp/client';

jest.mock('../src/providers/codebuddy/acp/client', () => {
    const actual = jest.requireActual('../src/providers/codebuddy/acp/client');
    return { ...actual, AcpClient: jest.fn() };
});
const MockAcpClient = AcpClient as jest.MockedClass<typeof AcpClient>;

/** fake AcpClient：request 按 method 路由；captured.events 用来注入 update/permission/exit */
function makeFakeClient() {
    let events: AcpClientEvents;
    const fake = {
        setCodebuddyPath: jest.fn(), setNodePath: jest.fn(), getScriptPath: jest.fn(() => '/fake/codebuddy'),
        running: true,
        ensureStarted: jest.fn(async () => {}),
        notify: jest.fn(), respond: jest.fn(), dispose: jest.fn(),
        request: jest.fn(async (method: string, params: Record<string, unknown>) => {
            if (method === 'session/new') return { sessionId: 'acp-' + String(params.cwd ? 'new' : 'x') };
            if (method === 'session/load') throw new Error('not found');
            if (method === 'session/prompt') return { stopReason: 'end_turn' };
            return {};
        }),
    };
    MockAcpClient.mockImplementation((ev: AcpClientEvents) => { events = ev; return fake as unknown as AcpClient; });
    return { fake, emit: () => events };
}

describe('CodebuddyProvider v2 sendMessage', () => {
    it('streams chunks and ends with a done chunk carrying usage', async () => {
        const { fake, emit } = makeFakeClient();
        fake.request.mockImplementation(async (method: string) => {
            if (method === 'session/prompt') {
                emit().onSessionUpdate('acp-new', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } });
                emit().onSessionUpdate('acp-new', { sessionUpdate: 'usage_update', used: 42, size: 168000 });
                return { stopReason: 'end_turn' };
            }
            if (method === 'session/new') return { sessionId: 'acp-new' };
            if (method === 'session/load') throw new Error('not found');
            return {};
        });
        const api = new CodebuddyProvider();
        const chunks = [];
        for await (const chunk of api.sendMessage('s1', 'hello', '/v')) chunks.push(chunk);
        expect(chunks).toEqual([
            { type: 'text', content: 'world' },
            { type: 'done', content: '', usage: { inputTokens: 42 } },
        ]);
    });
    it('cancel(sessionId) sends session/cancel and ends generator silently without killing the process', async () => {
        // prompt 挂起（promise 不 resolve 直到测试触发）→ api.cancel('s1') → notify('session/cancel')
        // → 手动 resolve prompt {stopReason:'cancelled'} → 生成器结束、无 done、fake.dispose 未被调
    });
    it('targeted cancel does not affect another in-flight session (双面板)', async () => {
        // 两个会话并发：s1、s2 各自 prompt 挂起；cancel('s1') → s1 收 cancelled 结束，s2 继续收 chunk 正常 done
    });
    it('times out a turn with cancelTurn + turnTimeout error, process stays alive', async () => {
        // api.setTimeout(50)；prompt 永不 resolve → await expect(gen).rejects.toThrow(t('provider.turnTimeout'))
        // notify('session/cancel') 被调、fake.dispose 未被调
    });
    it('surfaces preflight failure as thrown localized error and does not retry-storm', async () => {
        // ensureStarted reject new AcpStartError('acp-unsupported','x') → rejects.toThrow(t('provider.acpUnsupported'))
        // 再发一次 → ensureStarted 被调但失败路径一致（不重试轰炸由 client startPromise 置空语义保证，断言 throw 即可）
    });
    it('fails in-flight turn on process death and recovers via session/load on next send', async () => {
        // 第一轮流式中 emit().onExit(1, null) → 生成器 rejects.toThrow(t('provider.processDied'))
        // 第二轮：ensureStarted 重新 resolve、session/load 以旧 acpSessionId 成功 → 正常流式
    });
    it('ignores addDirs and permissionModeOverride (退役参数保留签名)', async () => {
        // sendMessage('s1','t','/v',['/etc'],'acceptEdits') 正常完成；request 参数不含 add-dir/permission-mode 痕迹
    });
    it('generateId returns v4 uuid shape', () => { /* 保留原有用例语义 */ });
});
```

- [x] **Step 2: 跑测试确认失败** — `npx jest tests/api.test.ts`（provider 还是 v1）。
- [x] **Step 3: 重写 `src/providers/codebuddy/index.ts`**

```ts
import { FALLBACK_MODEL_OPTIONS, type PermissionMode } from '../../shared/cliOptions';
import { t } from '../../i18n';
import { bbLog } from '../../shared/logBuffer';
import type { UsageInfo } from '../../types';
import { AcpClient, AcpStartError, type AcpStartTier } from './acp/client';
import {
    SessionRegistry, type AcpSession, type ConversationLookup, type SessionConfig, type TurnHandlers,
} from './acp/session';
import type { PermissionCardData } from './acp/permission';

const TIMEOUT = 300_000;

export interface StreamChunk {
    type: 'thinking' | 'text' | 'tool' | 'error' | 'done';
    content: string;
    toolName?: string;
    toolDetail?: string;
    usage?: UsageInfo;
}

interface SessionCallbacks {
    onPermissionRequest?: (data: PermissionCardData) => void;
    onUsage?: (used: number, size: number) => void;
    onConfigUpdate?: (cfg: { mode?: string; model?: string }) => void;
}

const NOOP_LOOKUP: ConversationLookup = { getAcpSessionId: () => undefined, setAcpSessionId: () => {} };

export class CodebuddyProvider {
    private timeout: number;
    private readonly client: AcpClient;
    private readonly registry: SessionRegistry;
    private readonly config: SessionConfig = { model: 'auto', mode: 'default' };
    private lookup: ConversationLookup = NOOP_LOOKUP;
    private availableModels: string[] = Object.keys(FALLBACK_MODEL_OPTIONS);
    private callbacks = new Map<string, SessionCallbacks>();

    constructor(timeout: number = TIMEOUT) {
        this.timeout = timeout;
        this.client = new AcpClient({
            onSessionUpdate: (acpSessionId, update) => this.registry.byAcpId(acpSessionId)?.handleUpdate(update),
            onPermissionRequest: (requestId, params) => this.routePermissionRequest(requestId, params),
            onAgentNotification: (method) => bbLog('[WB] acp 通知:', method),
            onModels: (models) => { this.availableModels = models; },
            onExit: (code, signal) => this.handleProcessExit(code, signal),
        });
        this.registry = new SessionRegistry(
            this.client,
            { getAcpSessionId: (k) => this.lookup.getAcpSessionId(k), setAcpSessionId: (k, id) => this.lookup.setAcpSessionId(k, id) },
            this.config,
        );
    }

    setCodebuddyPath(p: string): void { this.client.setCodebuddyPath(p); }
    setTimeout(ms: number): void { this.timeout = ms; }
    setNodePath(nodePath: string): void { this.client.setNodePath(nodePath); }
    setModel(model: string): void {
        this.config.model = model;
        for (const s of this.registry.all()) void s.applyRemoteConfig();
    }
    setPermissionMode(mode: PermissionMode): void {
        this.config.mode = mode;
        for (const s of this.registry.all()) void s.applyRemoteConfig();
    }
    setAvailableModels(models: string[]): void { this.availableModels = models; }
    getAvailableModels(): string[] { return [...this.availableModels]; }
    getScriptPath(): string { return this.client.getScriptPath(); }
    setConversationLookup(lookup: ConversationLookup): void { this.lookup = lookup; }

    generateId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    onPermissionRequest(sessionKey: string, cb: SessionCallbacks['onPermissionRequest']): void {
        this.callbacks.set(sessionKey, { ...this.callbacks.get(sessionKey), onPermissionRequest: cb });
    }
    onUsage(sessionKey: string, cb: SessionCallbacks['onUsage']): void {
        this.callbacks.set(sessionKey, { ...this.callbacks.get(sessionKey), onUsage: cb });
    }
    onConfigUpdate(sessionKey: string, cb: SessionCallbacks['onConfigUpdate']): void {
        this.callbacks.set(sessionKey, { ...this.callbacks.get(sessionKey), onConfigUpdate: cb });
    }
    respondPermission(requestId: number, optionId: string): void {
        for (const s of this.registry.all()) if (s.respondPermission(requestId, optionId)) return;
    }
    rejectPendingPermissions(sessionKey?: string): void {
        for (const s of this.registry.all()) if (!sessionKey || s.key === sessionKey) s.rejectPendingPermissions();
    }

    cancel(sessionId?: string): void {
        for (const s of this.registry.all()) {
            if (!sessionId || s.key === sessionId) void s.cancelTurn();
        }
    }

    dispose(): void {
        this.rejectPendingPermissions();
        this.client.dispose();
    }

    async *sendMessage(
        sessionId: string,
        text: string,
        vaultPath?: string,
        addDirs: string[] = [],
        permissionModeOverride?: PermissionMode,
    ): AsyncGenerator<StreamChunk> {
        // v2 退役项：addDirs（--add-dir 预授权 hack）与 permissionModeOverride（计划卡重发 workaround）
        // 仅保留签名兼容，不再消费；vault 外文件 Read 由 CLI 在 default 模式弹批准卡
        void addDirs; void permissionModeOverride;

        const session = this.registry.get(sessionId);
        try {
            await this.client.ensureStarted();
            await session.ensureLoaded(vaultPath);
        } catch (e) {
            throw new Error(this.startErrorMessage(e));
        }

        const cbs = this.callbacks.get(sessionId) ?? {};
        type QueueItem = { chunk?: StreamChunk; end?: boolean; error?: string };
        const queue: QueueItem[] = [];
        let waiter: ((item: QueueItem) => void) | null = null;
        let settled = false;
        const push = (item: QueueItem) => {
            if (settled) return;
            if (item.end || item.error) settled = true;
            if (waiter) { const w = waiter; waiter = null; w(item); } else queue.push(item);
        };
        const pull = (): Promise<QueueItem> => queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => { waiter = r; });

        const handlers: TurnHandlers = {
            onChunk: (chunk) => push({ chunk }),
            onError: (message) => push({ error: message }),
            onPermissionRequest: cbs.onPermissionRequest
                ? (data) => cbs.onPermissionRequest!(data)
                : undefined,
            onUsage: (used, size) => cbs.onUsage?.(used, size),
            onConfigUpdate: (cfg) => cbs.onConfigUpdate?.(cfg),
        };
        // 未注册批准回调时交给 session 的自动拒绝（handlers.onPermissionRequest 置 undefined 即可）

        const timer = setTimeout(() => {
            void session.cancelTurn();
            push({ error: t('provider.turnTimeout') });
        }, this.timeout);

        session.prompt(text, handlers).then(({ stopReason }) => {
            clearTimeout(timer);
            if (stopReason === 'end_turn') {
                push({ chunk: { type: 'done', content: '', usage: session.lastUsage ? { inputTokens: session.lastUsage.used } : undefined } });
                push({ end: true });
            } else if (stopReason === 'cancelled') {
                push({ end: true });
            } else {
                push({ error: t('provider.turnFailed').replace('{reason}', stopReason) });
            }
        }, (e: Error) => {
            clearTimeout(timer);
            push({ error: e.message });
        });

        while (true) {
            const item = await pull();
            if (item.end) return;
            if (item.error) throw new Error(item.error);
            if (item.chunk) yield item.chunk;
        }
    }

    private routePermissionRequest(requestId: number, params: unknown): void {
        const sessionId = (params as { sessionId?: unknown })?.sessionId;
        const session = typeof sessionId === 'string' ? this.registry.byAcpId(sessionId) : undefined;
        if (session) session.handlePermissionRequest(requestId, params);
        else this.client.respond(requestId, { outcome: { outcome: 'selected', optionId: 'reject' } });
    }

    private handleProcessExit(code: number | null, signal: string | null): void {
        bbLog('[WB] acp 进程退出:', code, signal);
        for (const s of this.registry.all()) s.failTurn(t('provider.processDied'));
        // 重启与 session/load 恢复由下次 sendMessage 的 ensureStarted/ensureLoaded 驱动
    }

    private startErrorMessage(e: unknown): string {
        if (e instanceof AcpStartError) {
            const byTier: Record<AcpStartTier, string> = {
                'cli-not-found': t('provider.cliNotFound'),
                'acp-unsupported': t('provider.acpUnsupported'),
                'auth-required': t('provider.notLoggedIn'),
                'handshake-failed': t('provider.handshakeFailed').replace('{detail}', e.message),
            };
            return byTier[e.tier];
        }
        return e instanceof Error ? e.message : String(e);
    }
}
```

注意：`PermissionMode` 从 `shared/cliOptions` import；`UsageInfo` 从 `types` import；i18n 新 key（`provider.acpUnsupported/notLoggedIn/handshakeFailed/turnTimeout/turnFailed/processDied/busy`）在 Task 10 才落地——本 Task 测试断言用 `t(...)` 实时取值（key 缺失时 `t()` 回落为 key 本身，测试与实现同值仍绿），Task 10 后文案生效。

- [x] **Step 4: 跑测试确认通过** — `npx jest tests/api.test.ts` 全绿；再 `npm run build` 确认类型。
- [x] **Step 5: Commit** — `git commit -m "feat(provider): rewrite CodebuddyProvider on ACP persistent sessions"`

---

### Task 8: Provider 旁路回调完整化 + respondPermission/rejectPendingPermissions 测试

**Files:**
- Modify: `src/providers/codebuddy/index.ts`（仅补测试驱动的边角：无回调注册时自动拒绝、permission 路由断言）
- Test: `tests/api.test.ts`（追加 describe）、或新增 `tests/providerCallbacks.test.ts`（推荐，避免 api.test.ts 再膨胀）

**Interfaces:**
- Consumes: Task 7 全部公共方法。
- Produces: 与 Task 7 "Produces" 相同——本 Task 是把旁路行为钉死在测试里。

- [x] **Step 1: 写失败测试** `tests/providerCallbacks.test.ts`（复用 api.test.ts 的 makeFakeClient harness，抽 `tests/helpers/fakeAcpClient.ts` 共享——把它从 api.test.ts 移到 helpers 并两边 import）

```ts
describe('provider side channels', () => {
    it('forwards permission requests to the registered callback with card data', async () => {
        // onPermissionRequest('s1', cb)；prompt 中 emit().onPermissionRequest(0, {sessionId:'acp-new', options:[...], toolCall:{...}})
        // → cb 收到 PermissionCardData（toolName/detail/options/isPlanApproval）
    });
    it('respondPermission answers the agent through the owning session', async () => {
        // 上一步后 api.respondPermission(0, 'allow') → fake.respond(0, {outcome:{outcome:'selected',optionId:'allow'}})
    });
    it('auto-rejects permission when no callback registered', async () => {
        // 不注册 → emit 权限请求 → fake.respond 以 reject optionId 被调
    });
    it('rejectPendingPermissions answers reject for all parked requests of a session', async () => { /* ... */ });
    it('routes usage updates to onUsage and config updates to onConfigUpdate', async () => {
        // emit usage_update → onUsage(used,size)；emit config_option_update → onConfigUpdate({mode:'plan'})
    });
    it('dispose rejects parked permissions and disposes client', async () => { /* ... */ });
});
```

- [x] **Step 2: 跑测试确认失败/通过** — 大部分应已绿（Task 7 已实现）；把 harness 抽取 + 补齐缺口（预计 `routePermissionRequest` 的 byAcpId 命中与未注册自动拒绝路径需校准）。
- [x] **Step 3: 补缺实现**（以红测为准，最小改动）。
- [x] **Step 4: 跑测试确认通过** — `npx jest tests/providerCallbacks.test.ts tests/api.test.ts` 全绿。
- [x] **Step 5: Commit** — `git commit -m "test(provider): pin down side-channel callbacks and permission routing"`

---

### Task 9: 配置同步 / 模型列表 / main.ts 接线 / 删除 models.ts

**Files:**
- Delete: `src/providers/codebuddy/models.ts`、`tests/models.test.ts`
- Modify: `src/main.ts`（删 fetchModels 接线 :3/:35-36/:120-129；onload 注入 ConversationLookup；onunload → dispose）
- Test: `tests/api.test.ts` 或 `tests/providerCallbacks.test.ts` 追加模型/配置用例

**Interfaces:**
- Consumes: Task 6 `findBySessionId/setAcpSessionId`、Task 7 provider 方法。
- Produces:
  - `getAvailableModels()` 数据源 = 握手/`session/new|load` 上报（client `onModels`）；空窗回退 `FALLBACK_MODEL_OPTIONS`
  - `setModel/setPermissionMode` → 对所有已加载 ACP 会话逐一 `applyRemoteConfig()`（Task 5 已实现，本 Task 钉测试）
  - main.ts onload（manager 创建后，旧 :45 之后）注入：
    ```ts
    this.api.setConversationLookup({
        getAcpSessionId: (key) => this.manager.findBySessionId(key)?.acpSessionId,
        setAcpSessionId: (key, id) => {
            const conv = this.manager.findBySessionId(key);
            if (conv) this.manager.setAcpSessionId(conv.id, id);
        },
    });
    ```
  - `onunload()`：`this.api.cancel()` → `this.api.dispose();`

- [x] **Step 1: 写失败测试**（追加）

```ts
describe('models & config sync', () => {
    it('getAvailableModels falls back before any session, then serves handshake models', async () => {
        // 新 provider → getAvailableModels() === Object.keys(FALLBACK_MODEL_OPTIONS)
        // emit().onModels(['auto','hy3'])（或 session/new 结果带 models）→ getAvailableModels() === ['auto','hy3']
    });
    it('setModel applies set_config_option to every loaded session', async () => {
        // 先 sendMessage 建会话 → api.setModel('glm-5.2') → fake.request 收到 session/set_config_option {configId:'model',value:'glm-5.2'}
    });
    it('setPermissionMode applies set_mode to every loaded session', async () => {
        // api.setPermissionMode('plan') → fake.request 收到 session/set_mode {modeId:'plan'}
    });
});
```

- [x] **Step 2: 跑测试确认失败/通过**（Task 5/7 已铺大半，以实际红绿校准）。
- [x] **Step 3: 删改**
  - `git rm src/providers/codebuddy/models.ts tests/models.test.ts`（工作区删除文件）
  - `src/main.ts`：
    - 删第 3 行 `import { fetchModels } from './providers/codebuddy/models';`
    - 删 :35-36 `// 后台刷新可用模型列表…` 注释 + `void this.refreshAvailableModels();`
    - 删整个 `refreshAvailableModels` 方法（:120-129）
    - manager.setPersistCallback 块（:41-45）后插入 `setConversationLookup`（上方 Produces 代码）
    - `onunload()`（:98-101）：`this.api.cancel();` → `this.api.dispose();`
- [x] **Step 4: 跑测试确认通过** — `npx jest` 全量（models.test.ts 已删）+ `npm run build`。
- [x] **Step 5: Commit** — `git commit -m "feat(provider): per-session config sync, handshake-driven model list, main wiring"`

---

### Task 10: i18n 增删 key

**Files:**
- Modify: `src/i18n/index.ts`（STRINGS 表 :35-214）

**Interfaces:**
- Produces（Task 11 依赖）：

```ts
// 新增（批准卡）
'approval.title':        { zh: '工具批准', en: 'Tool approval' },
'approval.allow':        { zh: '允许', en: 'Allow' },
'approval.alwaysAllow':  { zh: '总是允许', en: 'Always allow' },
'approval.reject':       { zh: '拒绝', en: 'Reject' },
'approval.planReady':    { zh: '计划已就绪', en: 'Plan ready' },
'approval.execute':      { zh: '按此执行', en: 'Execute' },
'approval.alwaysExecute':{ zh: '总是执行', en: 'Always execute' },
'approval.cancel':       { zh: '取消', en: 'Cancel' },
'approval.writeLines':   { zh: '写入 {path}（{count} 行）', en: 'Write {path} ({count} lines)' },
'approval.resolvedAllow':  { zh: '已允许', en: 'Allowed' },
'approval.resolvedAlways': { zh: '已总是允许', en: 'Always allowed' },
'approval.resolvedReject': { zh: '已拒绝', en: 'Rejected' },
// 新增（错误文案）
'provider.acpUnsupported': { zh: '当前 codebuddy CLI 版本过旧，不支持 ACP 持久会话。请升级 WorkBuddy 桌面版。', en: 'Your codebuddy CLI is too old for ACP persistent sessions. Please upgrade WorkBuddy.' },
'provider.notLoggedIn':    { zh: 'codebuddy CLI 疑似未登录。请先在 WorkBuddy 桌面版中登录。', en: 'codebuddy CLI appears logged out. Please log in via WorkBuddy first.' },
'provider.handshakeFailed':{ zh: 'codebuddy CLI 握手失败：{detail}', en: 'codebuddy CLI handshake failed: {detail}' },
'provider.turnTimeout':    { zh: '本轮响应超时，已中断', en: 'Turn timed out and was interrupted' },
'provider.turnFailed':     { zh: '本轮中断：{reason}', en: 'Turn interrupted: {reason}' },
'provider.processDied':    { zh: 'codebuddy 进程意外退出，本轮已中断。重新发送将自动恢复会话。', en: 'codebuddy process exited unexpectedly. Resend to resume the session.' },
'provider.busy':           { zh: '该会话正在响应中，请稍候', en: 'This conversation is still responding' },
// 删除（v1.5.0 计划卡 workaround 退役）
'plan.cardTitle' / 'plan.execute' / 'plan.dismiss' / 'plan.note' / 'plan.notApprovable'
```

- [x] **Step 1: 编辑 STRINGS**：在 `'perm.bypassPermissions'` 附近插入 approval.* 组；在 `'provider.nodeNotFound'`（:42）附近插入 provider.* 组；删除 :138-142 的 plan.* 五行。保留 `perm.acceptEdits`（无害残留，不在本次范围）。
- [x] **Step 2: 跑测试** — `npx jest tests/i18n.test.ts`（完整性循环断言自动覆盖新增 key）；再 `npx jest tests/api.test.ts tests/acpPermission.test.ts` 确认 t() 断言仍绿。
- [x] **Step 3: Commit** — `git commit -m "feat(i18n): approval card and ACP error strings; retire plan-card strings"`

---

### Task 11: View 接线 — 批准卡渲染/注册、旧计划卡退役、cancel 定向、用量环/工具栏回显、styles

**Files:**
- Modify: `src/features/chat/input.ts`（删 renderPlanCard :243-273 + isDeferExecuteRejection :276-278 + 调用点 :790 + 标志 :662-663/:791/:887 + 吞错 :857-858/:869-870 + isPlanFilePath import :11；新增 renderApprovalCard/renderApprovalDetail/applyToolbarConfig；sendText 注册旁路；renderContextUsage 支持 CLI 窗口）
- Modify: `src/features/chat/view.ts`（`pendingApprovals` 字段 + `rejectPendingApprovals()` + onClose 调用 + sendBtn cancel 定向 :211-217 + `cliWindowSize` 字段）
- Modify: `src/features/chat/tabs.ts`（switchToChat 前 `view.rejectPendingApprovals()`）
- Modify: `src/shared/toolDetail.ts`（删 isPlanFilePath :32-36）
- Modify: `tests/toolDetail.test.ts`（删对应 its :27-36）
- Modify: `styles.css`（:1014-1017 `.workbuddian-plan-card*` → `.workbuddian-approval-card*` 体系）

**Interfaces:**
- Consumes: Task 2 `PermissionCardData/PermissionDetail/pickOptionId`；Task 7/8 provider 旁路方法；`shared/lineDiff.ts` 的 `lineDiff`（Edit diff 预览）；Task 10 i18n key。
- Produces:
  - `view.pendingApprovals: Map<number, string>`（requestId → rejectOptionId）
  - `view.rejectPendingApprovals(): void`（逐一 respondPermission(reject) 并清卡标记）
  - `view.cliWindowSize?: number`
  - `renderContextUsage(view, cliWindowSize?)`：窗口取值 = 用户改过 `contextWindowSize`（≠ `DEFAULT_CONTEXT_WINDOW_SIZE`）→ 用户值；否则 CLI 上报值（无则回退 settings 值）

- [x] **Step 1: 删旧计划卡体系**
  - `input.ts`：删 `renderPlanCard`（:243-273）、`isDeferExecuteRejection`（:276-278）、:790 调用点（tool chunk 分支内 `if (isPlanFilePath(...)) renderPlanCard(...)` 段）、`planCardRendered/rejectionSwallowed` 两个标志（:662-663）及其所有读写（:791/:857-858/:869-870/:887）、:11 import 中的 `isPlanFilePath`。
  - `toolDetail.ts` 删 `isPlanFilePath`；`tests/toolDetail.test.ts` 删对应 describe/its。
  - 验证：`npx jest tests/toolDetail.test.ts && npm run build`。
- [x] **Step 2: view.ts 字段与 cancel 定向**

```ts
// view.ts 字段区（isStreaming :30 附近）追加：
pendingApprovals = new Map<number, string>();
cliWindowSize: number | undefined;

// 新方法：
/** 面板关闭/切会话/卸载前，把本面板悬挂的批准卡统一答 reject（批准请求不设超时，不能悬挂到 CLI 侧干等） */
rejectPendingApprovals(): void {
    for (const [requestId, rejectId] of this.pendingApprovals) this.api.respondPermission(requestId, rejectId);
    this.pendingApprovals.clear();
}

// onClose（:241-243）首行加：this.rejectPendingApprovals();
// sendBtn.onclick（:211-217）改为：
this.sendBtn.onclick = () => {
    if (this.isStreaming) {
        this.api.cancel(this.getActiveConversation()?.sessionId);
    } else {
        void sendMessage(this);
    }
};
```
  - `tabs.ts` `switchToChat` 切换前加 `view.rejectPendingApprovals();`（读实现校准插入点）。
- [x] **Step 3: input.ts 批准卡渲染**（renderPlanCard 原位置替换）

```ts
import type { PermissionCardData, PermissionDetail } from '../../providers/codebuddy/acp/permission';
import { pickOptionId } from '../../providers/codebuddy/acp/permission';
import { lineDiff } from '../../shared/lineDiff'; // 若已 import 则复用

/** ACP 权限请求 → 气泡内批准卡（复用 v1.5.0 卡片样式体系）；点击即 respondPermission，卡片留存供回看 */
async function renderApprovalCard(view: WorkbuddianChatView, container: HTMLElement, data: PermissionCardData): Promise<void> {
    const card = container.createDiv({ cls: 'workbuddian-approval-card workbuddian-approval-card-pending' });
    card.createDiv({
        cls: 'workbuddian-approval-card-title',
        text: data.isPlanApproval ? t('approval.planReady') : `${t('approval.title')}: ${data.toolName}`,
    });
    renderApprovalDetail(card.createDiv({ cls: 'workbuddian-approval-card-body' }), data.detail);

    const actions = card.createDiv({ cls: 'workbuddian-approval-card-actions' });
    const rejectId = pickOptionId(data.options, 'reject') ?? 'reject';
    view.pendingApprovals.set(data.requestId, rejectId);
    const defs: Array<{ label: string; kind: 'allow_once' | 'allow_always' | 'reject'; resolved: string; cta?: boolean }> = data.isPlanApproval
        ? [
            { label: t('approval.execute'), kind: 'allow_once', resolved: t('approval.resolvedAllow'), cta: true },
            { label: t('approval.alwaysExecute'), kind: 'allow_always', resolved: t('approval.resolvedAlways') },
            { label: t('approval.cancel'), kind: 'reject', resolved: t('approval.resolvedReject') },
        ]
        : [
            { label: t('approval.allow'), kind: 'allow_once', resolved: t('approval.resolvedAllow'), cta: true },
            { label: t('approval.alwaysAllow'), kind: 'allow_always', resolved: t('approval.resolvedAlways') },
            { label: t('approval.reject'), kind: 'reject', resolved: t('approval.resolvedReject') },
        ];
    let responded = false;
    for (const def of defs) {
        const btn = actions.createEl('button', { text: def.label, cls: def.cta ? 'mod-cta' : '' });
        btn.onclick = () => {
            if (responded) return;
            const optionId = pickOptionId(data.options, def.kind);
            if (!optionId) return;
            responded = true;
            view.pendingApprovals.delete(data.requestId);
            view.api.respondPermission(data.requestId, optionId);
            card.removeClass('workbuddian-approval-card-pending');
            actions.empty();
            card.createDiv({ cls: 'workbuddian-approval-card-resolved', text: def.resolved });
        };
    }
}

function renderApprovalDetail(body: HTMLElement, detail: PermissionDetail): void {
    switch (detail.kind) {
        case 'plan':
            body.remove(); // 计划正文已作为 message chunk 流在上方气泡，无需重复
            return;
        case 'write':
            body.setText(t('approval.writeLines').replace('{path}', detail.path).replace('{count}', String(detail.lines)));
            return;
        case 'edit': {
            body.createDiv({ cls: 'workbuddian-approval-card-path', text: detail.path });
            const diffEl = body.createDiv({ cls: 'workbuddian-tool-diff-body' });
            for (const row of lineDiff(detail.oldText, detail.newText)) {
                diffEl.createDiv({ cls: `workbuddian-diff-line workbuddian-diff-${row.type}`, text: `${row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' '} ${row.text}` });
            }
            return;
        }
        case 'bash':
            body.createEl('pre', { cls: 'workbuddian-approval-card-cmd', text: detail.command });
            return;
        case 'generic':
            body.setText(detail.summary);
            return;
    }
}
```

（`lineDiff` 返回行对象的 type/字段名以 `src/shared/lineDiff.ts` 实际定义为准，实现时读文件校准；diff 行 class 沿用 styles.css 现有 `.workbuddian-tool-diff*` 体系。）

- [x] **Step 4: sendText 旁路注册**（input.ts :694 streamingBubble 校验后、:696 for-await 前插入）

```ts
const sessionKey = conv.sessionId;
const msgEl = streamingBubble.closest('.workbuddian-message-assistant');
view.api.onPermissionRequest(sessionKey, (data) => {
    if (msgEl instanceof HTMLElement) void renderApprovalCard(view, msgEl as HTMLElement, data);
});
view.api.onUsage(sessionKey, (used, size) => {
    view.cliWindowSize = size;
    view.manager.setUsage(convId, { inputTokens: used });
    renderContextUsage(view, size);
});
view.api.onConfigUpdate(sessionKey, (cfg) => applyToolbarConfig(view, cfg));
```

并新增：

```ts
/** CLI 为真相源：config_option_update 回流时同步工具栏与 settings（不回调 api.set*，避免回环） */
function applyToolbarConfig(view: WorkbuddianChatView, cfg: { mode?: string; model?: string }): void {
    let changed = false;
    if (cfg.mode && (PERMISSION_MODE_CHOICES as readonly string[]).includes(cfg.mode) && cfg.mode !== view.settings.permissionMode) {
        view.settings.permissionMode = cfg.mode as PermissionMode;
        setIcon(view.permissionBtn, permissionIcon(view.settings.permissionMode));
        view.permissionBtn.setAttribute('title', `${t('input.permission')}: ${t('perm.' + view.settings.permissionMode)}`);
        changed = true;
    }
    if (cfg.model && cfg.model !== view.settings.model) {
        view.settings.model = cfg.model;
        view.containerEl.querySelector('.workbuddian-model-btn')?.setText(cfg.model);
        changed = true;
    }
    if (changed) void view.saveSettingsCallback();
}
```

`renderContextUsage(view, cliWindowSize?: number)` 改窗口取值（:337 一行）：

```ts
const userWindow = view.settings.contextWindowSize;
const windowSize = userWindow !== DEFAULT_CONTEXT_WINDOW_SIZE
    ? userWindow
    : (cliWindowSize ?? view.cliWindowSize ?? userWindow);
```

（`DEFAULT_CONTEXT_WINDOW_SIZE` 从 `../../types` import；`PERMISSION_MODE_CHOICES/permissionIcon` input.ts 已有。）

- [x] **Step 5: styles.css** — 读 :1014-1017 `.workbuddian-plan-card*` 规则，整组改名为 `.workbuddian-approval-card*`，补：

```css
.workbuddian-approval-card-pending { border-color: var(--interactive-accent); }
.workbuddian-approval-card-resolved { color: var(--text-muted); font-size: var(--font-ui-smaller); padding: 4px 0; }
.workbuddian-approval-card-cmd { white-space: pre-wrap; word-break: break-all; margin: 4px 0; }
.workbuddian-approval-card-path { color: var(--text-muted); margin-bottom: 4px; }
```

- [x] **Step 6: 验证** — `npm run build`（类型+打包）+ `npx jest` 全量绿。
- [x] **Step 7: Commit** — `git commit -m "feat(chat): in-bubble approval cards via ACP; retire plan-card workaround"`

---

### Task 12: `scripts/acp-smoke.mjs` + 全量验收

**Files:**
- Create: `scripts/acp-smoke.mjs`（真 CLI 手动回归，不进 jest）

**Interfaces:**
- 用法：`node scripts/acp-smoke.mjs [vaultPath]`（默认 cwd）。覆盖 spike 七问的最小回归：握手 → new → 两轮 prompt（报耗时）→ 权限请求（自动答 allow_once，验证落盘）→ cancel → load 回放 → plan 模式 → DeferExecuteTool 批准 → 自动执行落盘。

- [x] **Step 1: 写脚本**（~150 行，纯 node，复用 spike `acp.py` 的交互模式：行缓冲读 ndjson、id 递增、request/response 配对 promise）

```js
#!/usr/bin/env node
// ACP 冒烟：真实 codebuddy CLI 回归 spike 七问（手动运行，不进 jest）
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const vault = process.argv[2] || mkdtempSync(join(tmpdir(), 'acp-smoke-'));
const cli = process.env.CODEBUDDY_PATH || 'codebuddy';
let passed = 0, failed = 0;
const check = (name, ok, extra = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

// ... AcpProc 类：spawn --acp、行缓冲、request/notify/respond、onNotification 回调
// 步骤：
// 1. initialize → agentCapabilities 非空
// 2. session/new(cwd=vault) → sessionId、availableModels 非空
// 3. prompt#1（"只回复两个字：收到"）→ 收 agent_message_chunk；记耗时
// 4. prompt#2（"再说一次"）→ 耗时 < prompt#1（上下文真保持，容差：仅打印不 assert）
// 5. prompt "创建文件 smoke-acp.txt 内容 ok" → 等 session/request_permission → respond allow_once
//    → prompt 结束后 existsSync(join(vault,'smoke-acp.txt'))
// 6. 新一轮 prompt 中途 session/cancel → stopReason==='cancelled'
// 7. session/load(sessionId) → 收到回放 update（计数>0）后 result
// 8. set_mode plan → prompt "写一个三步计划" → 等 DeferExecuteTool 权限 → respond allow_once
//    → 计划批准链成立（收到权限请求即算过，执行落盘可选验）
// 退出码：failed>0 → 1
```

- [x] **Step 2: 手动跑冒烟** — `node scripts/acp-smoke.mjs /tmp/acp-smoke-vault`（需真 CLI 已登录；结果记入回复，失败项对照 traffic.jsonl 校准）。
- [x] **Step 3: 全量验收**
  - `npm test` 全绿（`jest --coverage`）
  - `npm run build` 通过
  - 自查 spec §7 验收标准逐条：①jest 绿+build 过 ✓/✗；②demo-vault 手测六项（多轮加速/批准卡三按钮/plan 真批准落盘/cancel 定向/杀进程重发恢复/旧版 CLI 报错卡）——列出手测清单交用户执行；③`git diff --stat -- src/features/chat` 仅含接线与批准卡改动
- [x] **Step 4: Commit** — `git commit -m "test(scripts): ACP smoke regression against real CLI"`

---

## 风险与备忘

1. **spec §7.3 与 §4.5 的张力**：验收标准说"UI diff 仅含批准卡注册/渲染"，而 §4.5 明令删除 `permissionModeOverride` workaround、§4.3 要求 `cancel(sessionId)` 定向。本计划的裁量：UI diff = provider-view 接线（批准/用量/配置/Lookup 注入）+ 批准卡 + 旧计划卡退役 + cancel 定向一行；`sendMessage` 与 `sendText` 的形参**原样保留**（addDirs/override 退役但占位），把 UI 改动压到最小且满足 spec 全部行为要求。
2. **`session/set_config_option` 的参数形状**（`{sessionId, configId, value}`）来自 spec §2 与 probe5 回退分支，traffic.jsonl 未直接捕获；如 smoke（Task 12）证明形状不符，只需改 `session.ts applyConfig` 一处。
3. **agent 请求 id 冲突**：实测 `session/request_permission` 的 id 恒为 0（同 session 串行无冲突）；跨 session 应答按"session 持有 pending"路由，wire 层只透传 id，CLI 侧自行关联。
4. **`handleLine` 对未知 agent→client 请求静默忽略**（不回 method-not-found），YAGNI；如出现新请求类型再补。
5. **双面板 callbacks 注册**：`onPermissionRequest(sessionKey, cb)` 按会话 key 存，两个面板各注册各的会话，互不覆盖；同会话在两个面板打开时后注册覆盖先注册（与 v1 共享实例语义一致，可接受）。
6. **inline-edit**：每次 `generateId()` 新 key → 每次新 ACP session（与 v1 `--session-id` 行为一致）；无 Conversation 落盘，Lookup 查不到 → `session/new`，无回写。

## Self-Review

- **Spec coverage**：
  - §4.1 分层四模块 → Task 1/2/3-4/5/7 ✓；UI 零契约改动 → Global Constraints + Task 7 签名保留 ✓
  - §4.2 传输层（懒启动/握手 10s/预检三级/stderr→bbLog/失败不轰炸）→ Task 3/4 ✓
  - §4.3 会话映射（acpSessionId/懒加载/回放吞掉/状态机/双面板定向 cancel/--add-dir 删除）→ Task 5/6/7 ✓
  - §4.4 事件映射表逐行 → Task 1（含 tool_call_update 只累积、usage/config 旁路、checkpoint/info/commands 仅日志、stopReason 三分支 → Task 7）✓
  - §4.5 批准流（批准卡三按钮/DeferExecuteTool 特化/按会话 set config/悬挂统一 reject/模型列表来自 session/new/fetchModels 删除）→ Task 2/8/9/11 ✓
  - §4.6 错误处理（超时 cancel+错误卡/进程死亡恢复/cancel 竞态/卸载拒悬挂+terminate）→ Task 7/8/9/11 ✓
  - §5 测试策略（纯逻辑单测/client mock child_process/provider mock AcpClient/删除旧解析与 fetchModels 测试/冒烟脚本/i18n key）→ Task 1-10/12 ✓
  - §6 非目标：均未安排任务 ✓（tool_call_update 只进内部状态不渲染；embeddedContext/image 不碰；fork/checkpoint UI 不做）
  - §7 验收标准 → Task 12 Step 3 逐条核对 ✓
- **Placeholder scan**：无线框占位；测试代码在重复模式处用注释标断言点（执行时按同文件已有模式补全，不得跳过断言）。
- **Type consistency**：`TurnHandlers`（Task 5）= provider sendMessage 消费形态（Task 7）✓；`PermissionCardData.requestId: number` 贯穿 Task 2/5/7/8/11 ✓；`pickOptionId` 的 `'allow_once'|'allow_always'|'reject'` 参数在 Task 2 定义、Task 11 使用 ✓；`ConversationLookup` Task 5 定义、Task 7 注入、Task 9 main.ts 实现 ✓；`SessionConfig` 引用共享语义 Task 5 定义、Task 7 构造传入 ✓；`renderContextUsage(view, cliWindowSize?)` Task 11 定义与调用一致 ✓。
