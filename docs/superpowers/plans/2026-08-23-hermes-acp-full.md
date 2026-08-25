# Hermes ACP 完整版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hermes 后端从 OpenAI 兼容 HTTP 纯对话（MVP）升级为 ACP 全能力后端（工具/批准卡/thinking/usage/历史回放/fork/模型切换/图片/MCP），HTTP 保留为自动降级与远程兜底。

**Architecture:** 把 `providers/codebuddy/acp/` 平移为共享引擎 `providers/acp/`，新增 `AcpBackendProfile` 抽象全部方言点；CodeBuddy 与 Hermes 各持一个 profile。`providers/hermes/index.ts` 改为路由器：本机有可用 `hermes` CLI 走 ACP，远程 gateway 或 CLI 不可用走 HTTP 轻量。

**Tech Stack:** TypeScript / esbuild / jest（ts-jest）/ ACP（stdio ndjson JSON-RPC）/ Hermes Agent v0.20.5（`hermes acp`）。

**Spec:** `docs/superpowers/specs/2026-08-23-hermes-acp-full-design.md`

**方言事实（2026-08-23 探针实证，实现以此为准）:**
- hermes mode id：`default`(ask) / `accept_edits`(workspace_session) / `dont_ask`(session)；`session/set_mode` 原生支持。
- 模型：`session/set_model {sessionId, modelId}`；modelId 可能是 `custom:<provider>:<model>` 编码，插件只做原样往返 + 显示解码。
- fork：`session/fork {sessionId, cwd}` → `{sessionId: newId}`（无 name 参数）。
- `session/load` 会话不存在时**返回 null 结果**（不抛错）→ 必须判空落回 `session/new`。
- 历史回放**无 meta 标记**（codebuddy 的 `_meta['codebuddy.ai'].mode==='history'` 不存在）；回放按 ACP 规范发生在 load 响应之前 → 引擎用「load 窗口」通用判别。
- `set_config_option` 对 hermes 是「收下不执行」→ thoughtLevel 不下发。
- `session/new|load` 响应含 `models:{availableModels:[{modelId,name}],currentModelId}` 与 `modes:{availableModes,currentModeId}`（ACP 标准 camelCase，与 codebuddy 同形）。
- hermes 工具名经 `_meta['codebuddy.ai/toolName']` 不存在 → 用 `title`（现有兜底已兼容）。

---

### Task 0: 活探针 scripts/probe-hermes-acp.mjs

**Files:**
- Create: `scripts/probe-hermes-acp.mjs`
- Create: `docs/manual-test-2026-08-23-hermes-acp-probe.md`

- [ ] **Step 1: 写探针脚本**

参照 `scripts/acp-smoke.mjs` 的 AcpProc 骨架（spawn + ndjson 读写 + id 分发），probe 项：
1. `initialize`（protocolVersion:1）→ 期望成功；
2. `session/new {cwd}` → 记录 models/modes 完整 JSON；
3. `session/prompt`「回复两个字：你好」→ 期望 agent_message_chunk 流 + stopReason；
4. `session/set_mode {modeId:'dont_ask'}` + `session/prompt`「在当前目录创建文件 probe-hello.txt 内容 hi」→ 期望 tool_call/tool_call_update 事件、**无** request_permission（dont_ask 免批）；
5. `session/set_mode {modeId:'default'}` + 同样写文件 prompt → 期望 `session/request_permission`（记录 toolCall 形态），应答 allow_once；
6. `session/set_model`（用 2 拿到的第一个 modelId）→ 期望成功响应；
7. `session/fork {sessionId, cwd}` → 期望返回新 sessionId；
8. `session/load`（旧 id）→ 记录回放事件序列（确认无 history meta、回放在响应前）；
9. `session/load` 不存在 id → 确认返回 null；
10. `session/cancel`（prompt 中途 notify）→ 期望 stopReason cancelled。

- [ ] **Step 2: 运行并记录**

```bash
node scripts/probe-hermes-acp.mjs /tmp/hermes-probe-vault
```
期望：10 项全过；输出贴进 `docs/manual-test-2026-08-23-hermes-acp-probe.md`。**任一项与「方言事实」不符 → 停下回修 spec §1/§3 再继续。**

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-hermes-acp.mjs docs/manual-test-2026-08-23-hermes-acp-probe.md
git commit -m "test: hermes ACP 活探针 — 握手/会话/权限/模型/fork/回放十项"
```

---

### Task 1: 引擎平移 providers/codebuddy/acp → providers/acp

**Files:**
- Move: `src/providers/codebuddy/acp/{client,session,events,permission}.ts` → `src/providers/acp/`
- Modify: `src/providers/codebuddy/index.ts`、`src/features/chat/input.ts`、`tests/{acpClient,acpEvents,acpPermission,acpSession,api,providerCallbacks}.test.ts`、`tests/helpers/fakeAcpClient.ts`

- [ ] **Step 1: git mv**

```bash
git mv src/providers/codebuddy/acp src/providers/acp
```

- [ ] **Step 2: 修 import（平移后深度少一层）**

`src/providers/acp/*.ts` 内：`../../../utils/cliPath` → `../../utils/cliPath`；`../../../shared/logBuffer` → `../../shared/logBuffer`；`../../../shared/responseFinalize` → `../../shared/responseFinalize`；`../index`（StreamChunk）暂改为 `../codebuddy/index`（Task 2 再内沉）。

引用方：`src/providers/codebuddy/index.ts` 的 `./acp/client` → `../acp/client`、`./acp/session` → `../acp/session`、`./acp/events` → `../acp/events`、`./acp/permission` → `../acp/permission`；`src/features/chat/input.ts` 与 6 个测试文件 + fakeAcpClient 的 `providers/codebuddy/acp/` → `providers/acp/`。

```bash
python3 - << 'EOF'
import re, pathlib
root = pathlib.Path('/Users/jiang/claude/workbuddian')
def sub(p, pairs):
    s = p.read_text(encoding='utf-8')
    for a, b in pairs: s = s.replace(a, b)
    p.write_text(s, encoding='utf-8')
for f in (root/'src/providers/acp').glob('*.ts'):
    sub(f, [("../../../utils/cliPath", "../../utils/cliPath"),
            ("../../../shared/logBuffer", "../../shared/logBuffer"),
            ("../../../shared/responseFinalize", "../../shared/responseFinalize"),
            ("from '../index'", "from '../codebuddy/index'")])
sub(root/'src/providers/codebuddy/index.ts', [("from './acp/", "from '../acp/")])
for f in list((root/'tests').glob('*.test.ts')) + [root/'tests/helpers/fakeAcpClient.ts', root/'src/features/chat/input.ts']:
    sub(f, [("providers/codebuddy/acp/", "providers/acp/")])
print('done')
EOF
```

- [ ] **Step 3: 验证**

```bash
npx jest tests/acpClient.test.ts tests/acpSession.test.ts tests/acpEvents.test.ts tests/acpPermission.test.ts tests/api.test.ts tests/providerCallbacks.test.ts --coverage=false 2>&1 | tail -5
npm run build 2>&1 | tail -3
```
期望：测试全绿、build 过（tsc + esbuild）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: ACP 引擎平移 providers/acp — 为 hermes 复用铺路"
```

---

### Task 2: StreamChunk 内沉 + 泛化 provider 壳（AcpProvider 基类）

**Files:**
- Modify: `src/providers/acp/events.ts`（StreamChunk 移入）
- Create: `src/providers/acp/provider.ts`
- Modify: `src/providers/codebuddy/index.ts`（变薄壳）
- Test: `tests/api.test.ts`、`tests/providerCallbacks.test.ts`（现有用例即行为钉）

- [ ] **Step 1: StreamChunk 移入 events.ts**

把 `StreamChunk` 接口从 `codebuddy/index.ts` 剪切到 `src/providers/acp/events.ts` 顶部并 `export`；`codebuddy/index.ts` 改为 `export type { StreamChunk } from '../acp/events';`（re-export 保持 v1 路径兼容）；`hermes/index.ts` 的本地 StreamChunk 定义删除，同样 re-export（接口字段两者本就一致）。`acp/session.ts`、`acp/events.ts` 内 `from '../codebuddy/index'` 改 `from './events'`。

- [ ] **Step 2: 跑测试确认类型平移无破坏**

```bash
npx jest tests/acpEvents.test.ts tests/api.test.ts --coverage=false 2>&1 | tail -3
```
期望：全绿。

- [ ] **Step 3: 抽 AcpProvider 基类**

把 `codebuddy/index.ts` 中后端无关部分整体移入 `src/providers/acp/provider.ts`：`SessionCallbacks`、`NOOP_LOOKUP`、`sendMessage` 全部队列管道、`routeSessionUpdate`、`routePermissionRequest`、`handleProcessExit`、`restartAfterDeadTurn`、旁路回调注册、`respondPermission`/`rejectPendingPermissions`/`cancel`/`forkSession`/`dispose`、`setModel/setPermissionMode/setThoughtLevel/setAvailableModels/getAvailableModels/getScriptPath/setConversationLookup/setMcpServersJson/setTimeout/generateId`、`resolveMcpForMessage`。签名：

```ts
export class AcpProvider {
    protected readonly client: AcpClient;
    protected readonly registry: SessionRegistry;
    protected readonly config: SessionConfig = { model: 'auto', mode: 'default', mcpServers: [] };
    // ……本任务 AcpClient 构造签名不变（仍内部 resolveCodebuddyPath）,profile 参数 Task 3 才加入
}
```

`codebuddy/index.ts` 变为：`export class CodebuddyProvider extends AcpProvider` + codebuddy 专属公共方法（`setCodebuddyPath`、`setNodePath`、`setCustomAgentsJson`、`startErrorMessage` 的文案分级留在基类，文案 key 不变）。

- [ ] **Step 4: 验证**

```bash
npx jest --coverage=false 2>&1 | tail -5 && npm run build 2>&1 | tail -3
```
期望：668 项全绿、build 过。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: AcpProvider 基类抽出 — provider 壳后端无关化"
```

---

### Task 3: AcpBackendProfile 接口 + codebuddy profile

**Files:**
- Create: `src/providers/acp/profile.ts`
- Create: `src/providers/codebuddy/profile.ts`
- Modify: `src/providers/acp/client.ts`、`src/providers/acp/session.ts`、`src/providers/acp/events.ts`、`src/providers/acp/provider.ts`、`src/providers/codebuddy/index.ts`
- Test: `tests/acpProfile.test.ts`（新）

- [ ] **Step 1: 写失败测试 tests/acpProfile.test.ts**

```ts
import { CODEBUDDY_PROFILE } from '../src/providers/codebuddy/profile';

describe('codebuddy profile（行为钉：与现状一致）', () => {
    it('spawn 入口参数为 --acp', () => {
        expect([...CODEBUDDY_PROFILE.acpArgs]).toEqual(['--acp']);
    });
    it('mode 映射恒等', () => {
        expect(CODEBUDDY_PROFILE.mapOutgoingMode('acceptEdits')).toBe('acceptEdits');
        expect(CODEBUDDY_PROFILE.mapIncomingMode('acceptEdits')).toBe('acceptEdits');
    });
    it('模型下发走 set_config_option', async () => {
        const calls: Array<Record<string, unknown>> = [];
        await CODEBUDDY_PROFILE.applyRemoteModel(
            { request: async (m, p) => { calls.push({ m, ...p }); return {}; } },
            'sid', 'claude-x');
        expect(calls).toEqual([{ m: 'session/set_config_option', sessionId: 'sid', configId: 'model', value: 'claude-x' }]);
    });
    it('回放判别认 codebuddy.ai meta', () => {
        expect(CODEBUDDY_PROFILE.isReplayUpdate({ _meta: { 'codebuddy.ai': { mode: 'history' } } })).toBe(true);
        expect(CODEBUDDY_PROFILE.isReplayUpdate({})).toBe(false);
    });
    it('forkMode 为 branch-prompt，thoughtLevel 下发', () => {
        expect(CODEBUDDY_PROFILE.forkMode).toBe('branch-prompt');
        expect(CODEBUDDY_PROFILE.supportsThoughtLevel).toBe(true);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest tests/acpProfile.test.ts --coverage=false 2>&1 | tail -3
```
期望：FAIL（模块不存在）。

- [ ] **Step 3: 实现 profile.ts 接口 + codebuddy profile**

`src/providers/acp/profile.ts`：

```ts
import type { PermissionMode } from '../../shared/cliOptions';
import type { AcpUpdate } from './events';

/** applyRemoteModel 对传输层的最小依赖（AcpClient/AcpClientFacade 天然满足） */
export interface ModelConfigClient {
    request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
}

/** 后端方言剖面：ACP 共享引擎与具体 CLI 之间的全部差异点 */
export interface AcpBackendProfile {
    readonly id: 'codebuddy' | 'hermes';
    /** CLI 路径解析：自定义覆盖 → 自动发现 → bare fallback */
    resolveCliPath(customPath: string): string;
    /** spawn 时 CLI 后的 ACP 入口参数 */
    readonly acpArgs: readonly string[];
    /** 插件权限模式 → agent 侧 mode id */
    mapOutgoingMode(mode: PermissionMode): string;
    /** agent 侧 mode id → 插件权限模式（不认识返回 undefined） */
    mapIncomingMode(modeId: string): PermissionMode | undefined;
    /** 模型下发到远端会话 */
    applyRemoteModel(client: ModelConfigClient, sessionId: string, model: string): Promise<void>;
    /** thoughtLevel 是否真下发（hermes 收下不执行 → false 跳过） */
    readonly supportsThoughtLevel: boolean;
    /** session/load 回放事件的 meta 判别（hermes 无标记 → 恒 false，靠引擎 load 窗口） */
    isReplayUpdate(update: AcpUpdate): boolean;
    /** extractToolName 读取的 _meta 键（空 = 只用 title 兜底） */
    readonly toolNameMetaKeys: readonly string[];
    /** fork 机制：/branch prompt 捕获（codebuddy）| session/fork RPC（hermes） */
    readonly forkMode: 'branch-prompt' | 'native-rpc';
}
```

`src/providers/codebuddy/profile.ts`：

```ts
import { resolveCodebuddyPath } from '../../utils/cliPath';
import type { PermissionMode } from '../../shared/cliOptions';
import type { AcpBackendProfile } from '../acp/profile';
import { bbLog } from '../../shared/logBuffer';

export const CODEBUDDY_PROFILE: AcpBackendProfile = {
    id: 'codebuddy',
    resolveCliPath: resolveCodebuddyPath,
    acpArgs: ['--acp'],
    mapOutgoingMode: (m) => m,
    mapIncomingMode: (id) => id as PermissionMode,
    async applyRemoteModel(client, sessionId, model) {
        try {
            await client.request('session/set_config_option', { sessionId, configId: 'model', value: model });
        } catch (e) { bbLog('[WB] acp 设置模型失败（忽略）:', e); }
    },
    supportsThoughtLevel: true,
    isReplayUpdate: (update) => {
        const meta = update._meta as Record<string, unknown> | undefined;
        const cb = meta?.['codebuddy.ai'] as { mode?: unknown } | undefined;
        return cb?.mode === 'history';
    },
    toolNameMetaKeys: ['codebuddy.ai/toolName'],
    forkMode: 'branch-prompt',
};
```

- [ ] **Step 4: 引擎接线（行为不变）**

1. `client.ts`：构造函数第二参数收 `profile: AcpBackendProfile`；`this.scriptPath = profile.resolveCliPath('')`；`setCodebuddyPath` 改名 `setCliPath`（codebuddy/index.ts 的 `setCodebuddyPath` 公共方法保留，内部调 `client.setCliPath`）；spawn 行 `buildSpawnCommand(this.scriptPath, this.nodePath, [...this.profile.acpArgs, ...this.extraArgs])`；新增 load 窗口跟踪：

```ts
private loadingSessions = new Set<string>();
/** session/load 在飞窗口：窗口内该会话的流式事件按回放处理（ACP 规范：回放在 load 响应前到达） */
loadInFlight(sessionId: string): boolean { return this.loadingSessions.has(sessionId); }
// request() 内 method==='session/load' 时：
//   const sid = String(params.sessionId ?? ''); this.loadingSessions.add(sid);
//   return this.doRequest<T>(...).finally(() => this.loadingSessions.delete(sid));
```

2. `session.ts`：`AcpSession` 构造函数追加 `profile: AcpBackendProfile` 参数（`SessionRegistry` 透传）；`applyConfig()` 的模型分支改为 `await this.profile.applyRemoteModel(this.client, sessionId, this.config.model)`；mode 分支 `session/set_mode` 的 modeId 用 `this.profile.mapOutgoingMode(this.config.mode as PermissionMode)`；thoughtLevel 分支整体包 `if (this.profile.supportsThoughtLevel)`；回放守卫 `isReplayUpdate(update)` 改 `this.profile.isReplayUpdate(update)`；`fork()` 头部加：

```ts
if (this.profile.forkMode === 'native-rpc') {
    if (this.status !== 'idle') throw new Error('session busy');
    if (!this.acpSessionId) throw new Error('session not loaded');
    const res = await this.client.request<{ sessionId?: string } | null>('session/fork', {
        sessionId: this.acpSessionId, cwd: this.lastVaultPath ?? '',
    });
    const newId = res && typeof res.sessionId === 'string' ? res.sessionId : '';
    if (!newId) throw new Error('fork failed: empty sessionId');
    bbLog('[WB] fork 成功(native):', this.acpSessionId, '→', newId);
    return newId;
}
// ……现有 /branch 逻辑原样保留
```

`ensureLoaded()` 的 load-miss 判空（hermes 返回 null 不抛错，codebuddy 抛错走 catch，两态兼容）：

```ts
const loaded = await this.client.request<unknown>(
    'session/load', { sessionId: candidate, cwd: vaultPath ?? '', mcpServers }).catch(() => null);
if (loaded == null) {
    const result = await this.client.request<{ sessionId: string }>(
        'session/new', { cwd: vaultPath ?? '', mcpServers });
    this.acpSessionId = result.sessionId;
} else {
    this.acpSessionId = candidate;
}
```

3. `events.ts`：`extractToolName(toolCall, metaKeys: readonly string[] = ['codebuddy.ai/toolName'])`——遍历 metaKeys 命中即返，再落 title 兜底；`mapSessionUpdate(update, metaKeys?)` / `mapToolCallUpdate(update, snapshot, metaKeys?)` 透传（默认参数保现有测试绿）；`isReplayUpdate` 函数保留（codebuddy profile 内部复用），引擎调用点改走 profile。
4. `provider.ts`（AcpProvider）：构造参数加 `profile`，传给 AcpClient/SessionRegistry；`routeSessionUpdate` 里 `!isReplayUpdate(update)` 改 `!this.profile.isReplayUpdate(update) && !this.client.loadInFlight(acpSessionId)`（两处：轮外 config 直推守卫、无归属噪音守卫）。
5. `codebuddy/index.ts`：`super(CODEBUDDY_PROFILE, timeout)`。

- [ ] **Step 5: 验证**

```bash
npx jest --coverage=false 2>&1 | tail -5 && npm run build 2>&1 | tail -3
```
期望：全绿（含新 acpProfile 5 例）、build 过。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: AcpBackendProfile 方言抽象 — codebuddy profile 落地,行为不变"
```

---

### Task 4: utils/cliPath.ts 增加 resolveHermesPath

**Files:**
- Modify: `src/utils/cliPath.ts`
- Test: `tests/cliPath.test.ts`（新）

- [ ] **Step 1: 写失败测试 tests/cliPath.test.ts**

```ts
import { resolveHermesPath } from '../src/utils/cliPath';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('fs');
const existsSync = fs.existsSync as jest.Mock;

describe('resolveHermesPath', () => {
    beforeEach(() => existsSync.mockReset().mockReturnValue(false));
    it('自定义覆盖原样返回', () => {
        expect(resolveHermesPath('  /opt/hermes/bin/hermes ')).toBe('/opt/hermes/bin/hermes');
    });
    it('命中 ~/.local/bin/hermes', () => {
        const home = os.homedir();
        existsSync.mockImplementation((p) => p === path.join(home, '.local', 'bin', 'hermes'));
        expect(resolveHermesPath('')).toBe(path.join(home, '.local', 'bin', 'hermes'));
    });
    it('全部未命中 → bare fallback hermes（交 PATH 解析）', () => {
        expect(resolveHermesPath('')).toBe('hermes');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest tests/cliPath.test.ts --coverage=false 2>&1 | tail -3
```
期望：FAIL（导出不存在）。

- [ ] **Step 3: 实现（镜像 resolveCodebuddyPath 的候选策略）**

`src/utils/cliPath.ts` 追加（复用文件内既有 `findOnPath`/`isWin` helper）：

```ts
/** Hermes CLI 发现：自定义覆盖 → 常见安装位 → PATH → bare fallback（'hermes' 交 OS 解析） */
export function resolveHermesPath(customPath: string): string {
    const custom = customPath.trim();
    if (custom) return custom;
    const home = os.homedir();
    const candidates = isWin()
        ? [path.join(home, '.local', 'bin', 'hermes.exe'), path.join(home, '.hermes', 'bin', 'hermes.exe')]
        : [path.join(home, '.local', 'bin', 'hermes'), path.join(home, '.hermes', 'bin', 'hermes'),
           '/usr/local/bin/hermes', '/opt/homebrew/bin/hermes'];
    for (const p of candidates) if (fs.existsSync(p)) return p;
    const onPath = findOnPath(isWin() ? ['hermes.exe', 'hermes.cmd', 'hermes'] : ['hermes']);
    return onPath ?? 'hermes';
}
```

（若 cliPath.ts 内部 fs/os 导入形态不同，沿用该文件既有写法。）

- [ ] **Step 4: 验证 + Commit**

```bash
npx jest tests/cliPath.test.ts --coverage=false 2>&1 | tail -3
git add src/utils/cliPath.ts tests/cliPath.test.ts
git commit -m "feat: resolveHermesPath — hermes CLI 跨平台自动发现"
```

---

### Task 5: hermes profile + HermesAcpProvider

**Files:**
- Create: `src/providers/hermes/profile.ts`
- Create: `src/providers/hermes/acpProvider.ts`
- Test: `tests/hermesProfile.test.ts`（新）
- Test: `tests/hermesAcpProvider.test.ts`（新，复用 tests/helpers/fakeAcpClient.ts）

- [ ] **Step 1: 写失败测试 tests/hermesProfile.test.ts**

```ts
import { HERMES_PROFILE, hermesModelLabel } from '../src/providers/hermes/profile';

describe('hermes profile 方言', () => {
    it('spawn 入口参数为 acp', () => {
        expect([...HERMES_PROFILE.acpArgs]).toEqual(['acp']);
    });
    it('权限模式出向映射', () => {
        expect(HERMES_PROFILE.mapOutgoingMode('default')).toBe('default');
        expect(HERMES_PROFILE.mapOutgoingMode('acceptEdits')).toBe('accept_edits');
        expect(HERMES_PROFILE.mapOutgoingMode('bypassPermissions')).toBe('dont_ask');
        expect(HERMES_PROFILE.mapOutgoingMode('plan')).toBe('default'); // hermes 无 plan，回落
    });
    it('权限模式入向映射（current_mode_update → UI）', () => {
        expect(HERMES_PROFILE.mapIncomingMode('default')).toBe('default');
        expect(HERMES_PROFILE.mapIncomingMode('accept_edits')).toBe('acceptEdits');
        expect(HERMES_PROFILE.mapIncomingMode('dont_ask')).toBe('bypassPermissions');
        expect(HERMES_PROFILE.mapIncomingMode('unknown-x')).toBeUndefined();
    });
    it('模型下发走 session/set_model；auto 不下发', async () => {
        const calls: Array<Record<string, unknown>> = [];
        const client = { request: async (m: string, p: Record<string, unknown>) => { calls.push({ m, ...p }); return {}; } };
        await HERMES_PROFILE.applyRemoteModel(client, 'sid', 'custom:kimi:kimi-k3');
        await HERMES_PROFILE.applyRemoteModel(client, 'sid', 'auto');
        expect(calls).toEqual([{ m: 'session/set_model', sessionId: 'sid', modelId: 'custom:kimi:kimi-k3' }]);
    });
    it('thoughtLevel 不下发；回放无 meta 判别；fork 走原生 RPC', () => {
        expect(HERMES_PROFILE.supportsThoughtLevel).toBe(false);
        expect(HERMES_PROFILE.isReplayUpdate({ _meta: { hermes: { compactionSummary: true } } })).toBe(false);
        expect(HERMES_PROFILE.forkMode).toBe('native-rpc');
    });
    it('hermesModelLabel 显示解码', () => {
        expect(hermesModelLabel('custom:kimi:kimi-k3')).toBe('kimi-k3 (kimi)');
        expect(hermesModelLabel('gpt-5')).toBe('gpt-5');
    });
});
```

- [ ] **Step 2: 写失败测试 tests/hermesAcpProvider.test.ts**

复用 `tests/helpers/fakeAcpClient.ts`（参照 api.test.ts 的 mock 方式 `jest.mock('../src/providers/acp/client')`）：

```ts
import { HermesAcpProvider } from '../src/providers/hermes/acpProvider';

describe('HermesAcpProvider', () => {
    it('forkSession 走 session/fork RPC 并返回新 id', async () => {
        const p = new HermesAcpProvider();
        p.setConversationLookup({ getAcpSessionId: () => undefined, setAcpSessionId: () => {} });
        const newId = await p.forkSession('conv-1', '分支名', '/tmp/vault');
        expect(typeof newId).toBe('string');
        expect(newId.length).toBeGreaterThan(0);
        // fake client 断言见 tests/helpers/fakeAcpClient.ts 的调用记录（session/fork 被调、无 /branch prompt）
    });
    it('setCustomAgentsJson 为空操作（hermes 无 --agents）', () => {
        const p = new HermesAcpProvider();
        expect(() => p.setCustomAgentsJson('{"a":{}}')).not.toThrow();
    });
});
```

（fake client 需要支持 `session/fork` 应答：按 api.test.ts 现有 fake 的扩展方式补 `session/fork → { sessionId: 'forked-xxx' }`。）

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest tests/hermesProfile.test.ts tests/hermesAcpProvider.test.ts --coverage=false 2>&1 | tail -3
```
期望：FAIL（模块不存在）。

- [ ] **Step 4: 实现 src/providers/hermes/profile.ts**

```ts
import { resolveHermesPath } from '../../utils/cliPath';
import type { PermissionMode } from '../../shared/cliOptions';
import type { AcpBackendProfile } from '../acp/profile';
import { bbLog } from '../../shared/logBuffer';

const OUTGOING_MODE: Record<PermissionMode, string> = {
    default: 'default',
    acceptEdits: 'accept_edits',
    bypassPermissions: 'dont_ask',
    plan: 'default', // hermes 无 plan 模式，回落 default
};
const INCOMING_MODE: Record<string, PermissionMode> = {
    default: 'default',
    accept_edits: 'acceptEdits',
    dont_ask: 'bypassPermissions',
};

/** 模型 id → 可读标签：custom:<provider>:<model> → "<model> (<provider>)"；其余原样 */
export function hermesModelLabel(modelId: string): string {
    const m = /^custom:([^:]+):(.+)$/.exec(modelId);
    return m ? `${m[2]} (${m[1]})` : modelId;
}

export const HERMES_PROFILE: AcpBackendProfile = {
    id: 'hermes',
    resolveCliPath: resolveHermesPath,
    acpArgs: ['acp'],
    mapOutgoingMode: (m) => OUTGOING_MODE[m],
    mapIncomingMode: (id) => INCOMING_MODE[id],
    async applyRemoteModel(client, sessionId, model) {
        if (!model || model === 'auto') return; // auto = 跟随 hermes 当前 provider 默认模型
        try {
            await client.request('session/set_model', { sessionId, modelId: model });
        } catch (e) { bbLog('[WB] hermes 设置模型失败（忽略）:', e); }
    },
    supportsThoughtLevel: false,
    isReplayUpdate: () => false, // hermes 回放无 meta 标记：由引擎 load 窗口通用判别
    toolNameMetaKeys: [],
    forkMode: 'native-rpc',
};
```

- [ ] **Step 5: 实现 src/providers/hermes/acpProvider.ts**

```ts
import { AcpProvider } from '../acp/provider';
import { HERMES_PROFILE } from './profile';

/**
 * Hermes ACP 完整版 provider：spawn `hermes acp`，全能力（工具/批准卡/thinking/usage/fork）。
 * 公共契约与 CodebuddyProvider 一致（main.ts 联合类型不动）。
 */
export class HermesAcpProvider extends AcpProvider {
    constructor(timeout?: number) { super(HERMES_PROFILE, timeout); }

    /** hermes acp 无 --agents 旗标：空操作（main.ts 会无条件灌 customAgentsJson） */
    setCustomAgentsJson(_json: string): void {}

    /** 设置页模型下拉展示用：id → 可读标签 */
    getAvailableModelLabels(): Array<{ id: string; label: string }> {
        return this.getAvailableModels().map((id) => ({ id, label: hermesModelLabel(id) }));
    }
}
```

（`hermesModelLabel` 需在文件头 import。）

- [ ] **Step 6: 验证**

```bash
npx jest tests/hermesProfile.test.ts tests/hermesAcpProvider.test.ts --coverage=false 2>&1 | tail -3
npx jest --coverage=false 2>&1 | tail -4
```
期望：新测试 PASS、全套绿。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: hermes ACP profile + provider — 方言映射/fork RPC/模型编解码"
```

---

### Task 6: hermes/index.ts 改路由器（ACP/HTTP 自动选择）

**Files:**
- Move: `src/providers/hermes/index.ts` 现有内容 → `src/providers/hermes/httpProvider.ts`（类名改 `HermesHttpProvider`）
- Create: `src/providers/hermes/index.ts`（路由器，类名保持 `HermesProvider`）
- Test: `tests/hermesRouter.test.ts`（新）
- Modify: `tests/hermes.test.ts`（import 改 httpProvider 直测，或经路由器默认 http 模式原样跑——见 Step 1）

- [ ] **Step 1: 平移 HTTP 实现**

`git mv` 不可用于「同目录改名+新建同名文件」，手动：
1. `cp src/providers/hermes/index.ts /tmp/hermes-http.bak`（保险）
2. `src/providers/hermes/httpProvider.ts` = 现 index.ts 内容，类名 `HermesProvider` → `HermesHttpProvider`，文件头注释改为「HTTP 轻量版：OpenAI 兼容纯对话，ACP 不可用/远程 gateway 时的降级路径」。
3. `tests/hermes.test.ts` 的 `from '../src/providers/hermes'` 改 `from '../src/providers/hermes/httpProvider'`，`new HermesProvider()` 改 `new HermesHttpProvider()`。

```bash
npx jest tests/hermes.test.ts tests/hermesDiscover.test.ts --coverage=false 2>&1 | tail -3
```
期望：全绿（纯改名）。

- [ ] **Step 2: 写失败测试 tests/hermesRouter.test.ts**

```ts
import { HermesProvider } from '../src/providers/hermes';

// mock 两个内部 provider 与 CLI 探测
jest.mock('../src/providers/hermes/acpProvider', () => ({
    HermesAcpProvider: jest.fn().mockImplementation(() => ({ kind: 'acp', ...contractStub() })),
}));
jest.mock('../src/providers/hermes/httpProvider', () => ({
    HermesHttpProvider: jest.fn().mockImplementation(() => ({ kind: 'http', ...contractStub() })),
}));
jest.mock('child_process', () => ({ execFile: jest.fn() }));
import { execFile } from 'child_process';
const execFileMock = execFile as unknown as jest.Mock;

function contractStub() {
    return {
        setGateway: jest.fn(), setModel: jest.fn(), setTimeout: jest.fn(),
        setPermissionMode: jest.fn(), setThoughtLevel: jest.fn(), setMcpServersJson: jest.fn(),
        setCustomAgentsJson: jest.fn(), setConversationLookup: jest.fn(),
        onPermissionRequest: jest.fn(), onUsage: jest.fn(), onConfigUpdate: jest.fn(),
        cancel: jest.fn(), dispose: jest.fn(), getAvailableModels: jest.fn(() => []),
    };
}

describe('HermesProvider 路由器', () => {
    beforeEach(() => execFileMock.mockReset());
    it('远程 gateway 地址 → http 模式，不探测 CLI', async () => {
        const p = new HermesProvider();
        p.setGateway('http://10.100.0.1:8642', 'key');
        await p.init();
        expect(p.mode).toBe('http');
        expect(execFileMock).not.toHaveBeenCalled();
    });
    it('本机 CLI --check 通过 → acp 模式', async () => {
        execFileMock.mockImplementation((_c, _a, _o, cb) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        p.setGateway('', '');
        await p.init();
        expect(p.mode).toBe('acp');
    });
    it('本机 CLI 自检失败 → http 降级', async () => {
        execFileMock.mockImplementation((_c, _a, _o, cb) => cb(new Error('exit 1'), '', 'fail'));
        const p = new HermesProvider();
        p.setGateway('', '');
        await p.init();
        expect(p.mode).toBe('http');
    });
    it('ACP 启动失败 → 粘性降级 http 并触发 onModeChange', async () => {
        execFileMock.mockImplementation((_c, _a, _o, cb) => cb(null, 'ok', ''));
        const p = new HermesProvider();
        await p.init();
        const seen: string[] = [];
        p.onModeChange((m) => seen.push(m));
        p.demoteToHttp(new Error('spawn ENOENT'));
        expect(p.mode).toBe('http');
        expect(seen).toEqual(['http']);
    });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest tests/hermesRouter.test.ts --coverage=false 2>&1 | tail -3
```
期望：FAIL（init/mode/demoteToHttp 不存在）。

- [ ] **Step 4: 实现路由器 src/providers/hermes/index.ts**

```ts
import { execFile } from 'child_process';
import { bbLog, bbError } from '../../shared/logBuffer';
import { resolveHermesPath } from '../../utils/cliPath';
import { HermesAcpProvider } from './acpProvider';
import { HermesHttpProvider } from './httpProvider';

export type HermesMode = 'acp' | 'http';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

function isLocalGateway(url: string): boolean {
    if (!url.trim()) return true; // 空 = 本机自动发现
    try { return LOCAL_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

/**
 * Hermes 路由器：本机 CLI 可用 → ACP 完整版；远程 gateway / CLI 不可用 → HTTP 轻量版。
 * 对 view 层公共契约与 CodebuddyProvider 一致；mode 只读外露（降级顶条/设置页状态行用）。
 */
export class HermesProvider {
    private readonly acp = new HermesAcpProvider();
    private readonly http = new HermesHttpProvider();
    private modeValue: HermesMode = 'http'; // init() 前保守为 http（现有 hermes.test.ts 行为钉）
    private cliPath = '';
    private gatewayUrl = '';
    private apiKey = '';
    private modeCbs: Array<(m: HermesMode) => void> = [];

    get mode(): HermesMode { return this.modeValue; }
    onModeChange(cb: (m: HermesMode) => void): void { this.modeCbs.push(cb); }

    /** main.ts onload/设置变更后调用：探测一次定模式 */
    async init(): Promise<void> {
        if (!isLocalGateway(this.gatewayUrl)) { this.setMode('http'); return; } // 远程 → 直接 http
        const cli = resolveHermesPath(this.cliPath);
        const ok = await new Promise<boolean>((resolve) => {
            execFile(cli, ['acp', '--check'], { timeout: 5000 }, (err) => resolve(!err));
        });
        this.setMode(ok ? 'acp' : 'http');
        bbLog('[WB] hermes 路由:', this.modeValue, ok ? '' : '(CLI 自检失败)');
    }

    /** ACP 启动/运行失败 → 粘性降级（本次插件生命周期内不再尝试 ACP） */
    demoteToHttp(e: unknown): void {
        if (this.modeValue === 'http') return;
        bbError('[WB] hermes ACP 不可用,降级 HTTP 轻量模式:', e);
        this.setMode('http');
    }

    private setMode(m: HermesMode): void {
        if (m === this.modeValue) return;
        this.modeValue = m;
        for (const cb of this.modeCbs) cb(m);
    }

    private active(): HermesAcpProvider | HermesHttpProvider { return this.modeValue === 'acp' ? this.acp : this.http; }

    // ---- 契约转发（双 inner 都灌,模式翻转不丢注册）----
    setHermesCliPath(p: string): void { this.cliPath = p.trim(); }
    setGateway(url: string, key: string): void {
        this.gatewayUrl = url; this.apiKey = key;
        this.http.setGateway(url, key);
    }
    setModel(m: string): void { this.acp.setModel(m); this.http.setModel(m); }
    setTimeout(ms: number): void { this.acp.setTimeout(ms); this.http.setTimeout(ms); }
    setPermissionMode(m: Parameters<HermesAcpProvider['setPermissionMode']>[0]): void { this.acp.setPermissionMode(m); this.http.setPermissionMode(m); }
    setThoughtLevel(l: string): void { this.acp.setThoughtLevel(l); this.http.setThoughtLevel(l); }
    setMcpServersJson(j: string): void { this.acp.setMcpServersJson(j); this.http.setMcpServersJson(j); }
    setCustomAgentsJson(j: string): void { this.acp.setCustomAgentsJson(j); this.http.setCustomAgentsJson(j); }
    setCodebuddyPath(_p: string): void {}
    setNodePath(_p: string): void {}
    setAvailableModels(m: string[]): void { this.acp.setAvailableModels(m); this.http.setAvailableModels(m); }
    getAvailableModels(): string[] { return this.active().getAvailableModels(); }
    getScriptPath(): string { return this.active().getScriptPath(); }
    setConversationLookup(l: Parameters<HermesAcpProvider['setConversationLookup']>[0]): void {
        this.acp.setConversationLookup(l); this.http.setConversationLookup(l);
    }
    generateId(): string { return this.active().generateId(); }
    onPermissionRequest(k: string, cb: Parameters<HermesAcpProvider['onPermissionRequest']>[1]): void { this.acp.onPermissionRequest(k, cb); this.http.onPermissionRequest(k, cb); }
    onUsage(k: string, cb: Parameters<HermesAcpProvider['onUsage']>[1]): void { this.acp.onUsage(k, cb); this.http.onUsage(k, cb); }
    onConfigUpdate(k: string, cb: Parameters<HermesAcpProvider['onConfigUpdate']>[1]): void { this.acp.onConfigUpdate(k, cb); this.http.onConfigUpdate(k, cb); }
    respondPermission(id: number, o: string): void { this.acp.respondPermission(id, o); this.http.respondPermission(id, o); }
    rejectPendingPermissions(k?: string): void { this.acp.rejectPendingPermissions(k); this.http.rejectPendingPermissions(k); }
    cancel(k?: string): void { this.active().cancel(k); }
    forkSession(k: string, n: string, v?: string): Promise<string> { return this.active().forkSession(k, n, v); }
    testConnection(): Promise<{ ok: boolean; error?: string }> { return this.http.testConnection(); }
    sendMessage(...args: Parameters<HermesAcpProvider['sendMessage']>): AsyncGenerator<import('../acp/events').StreamChunk> {
        return this.active().sendMessage(...args);
    }
    dispose(): void { this.acp.dispose(); this.http.dispose(); }
}
export type { StreamChunk } from '../acp/events';
```

注意：`sendMessage` 的 ACP 分支要把 `AcpStartError` 转成 `this.demoteToHttp(e)` + 重抛（view 出错误卡 + Notice），实现时在 sendMessage 外包一层 async generator try/catch（首轮 catch 到启动错误即 demote）。测试里 `demoteToHttp` 直调已钉行为。

- [ ] **Step 5: 验证**

```bash
npx jest --coverage=false 2>&1 | tail -4 && npm run build 2>&1 | tail -3
```
期望：全绿、build 过。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: hermes 路由器 — ACP 完整版/HTTP 轻量自动选择 + 粘性降级"
```

---

### Task 7: settings v5 迁移 + hermesCliPath + main.ts 灌线

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/main.ts`
- Test: `tests/types.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试（tests/types.test.ts 追加）**

```ts
it('v4 → v5: hermesCliPath 缺省补空串', () => {
    const migrated = migrateSettings({ backend: 'hermes' } as never);
    expect(migrated.hermesCliPath).toBe('');
    expect(migrated.backend).toBe('hermes');
});
it('hermesCliPath 非法类型回落默认', () => {
    const migrated = migrateSettings({ hermesCliPath: 42 } as never);
    expect(migrated.hermesCliPath).toBe('');
});
```

（与文件内既有迁移用例同写法，`migrateSettings` 按现有 import。）

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest tests/types.test.ts -t "hermesCliPath" --coverage=false 2>&1 | tail -3
```
期望：FAIL（属性不存在）。

- [ ] **Step 3: 实现**

`src/types/index.ts`：
1. `CURRENT_SETTINGS_VERSION` 4 → 5；
2. `PluginSettings` 接口加 `hermesCliPath: string;`（放 hermesApiKey 旁）；
3. `DEFAULT_SETTINGS` 加 `hermesCliPath: '',`；
4. 迁移字段表加 `{ key: 'hermesCliPath', read: (s) => getString(s, 'hermesCliPath') },`。

`src/main.ts` `applySettingsToApi()` 的 `if (this.api instanceof HermesProvider)` 块内追加：

```ts
this.api.setHermesCliPath(this.settings.hermesCliPath);
void this.api.init(); // 探测一次定 ACP/HTTP 模式（异步,不阻塞设置灌入）
```

- [ ] **Step 4: 验证 + Commit**

```bash
npx jest tests/types.test.ts --coverage=false 2>&1 | tail -3 && npm run build 2>&1 | tail -3
git add src/types/index.ts src/main.ts tests/types.test.ts
git commit -m "feat: settings v5 — hermesCliPath + 路由器 init 灌线"
```

---

### Task 8: 设置页方案一 + thoughtLevel 置灰 + 降级顶条（obsidian 层）

**Files:**
- Modify: `src/features/settings/tab.ts`
- Modify: `src/features/chat/view.ts`（或 input.ts,视 DOM 结构）
- Modify: `src/i18n/index.ts`（中英新增）
- Modify: `styles.css`（状态行/顶条样式）

> obsidian 层无 jest（仓库约定）:验证 = build + 手测。文案 key 先行进 i18n（tests/i18n.test.ts 会卡中英 key 对齐）。

- [ ] **Step 1: i18n 新增（中英双份）**

```
hermes.mode           = 运行模式
hermes.modeAcp        = ACP 完整版
hermes.modeHttp       = HTTP 轻量版
hermes.acpOk          = ✅ ACP 可用（{version}）
hermes.acpMissing     = ❌ 未检测到 hermes CLI,将使用轻量模式
hermes.cliPath        = Hermes CLI 路径
hermes.cliPathDesc    = 留空自动发现（~/.local/bin/hermes、PATH 等）
hermes.advanced       = 高级:HTTP 降级 / 远程 gateway
hermes.advancedDesc   = ACP 不可用,或填了非本机 gateway 地址时,自动使用轻量模式(仅纯对话)
hermes.liteBanner     = 轻量模式:工具/批准卡不可用(完整功能需本机 hermes CLI)
hermes.thoughtUnsupported = Hermes 暂不支持调节推理强度
hermes.remoteHttp     = 检测到远程 gateway 地址,轻量模式生效中
```

- [ ] **Step 2: 设置页重排（backend==='hermes' 分支）**

把 tab.ts 现有 hermes 区块改为方案一布局：
1. **运行模式行**:`new Setting(...).setName(t('hermes.mode'))`,desc 按 `plugin.api instanceof HermesProvider && plugin.api.mode` 显示 `modeAcp`/`modeHttp`（acp 且拿到版本时拼 `hermes.acpOk`）。
2. **CLI 路径行**:文本框 `hermesCliPath`,`setValue(settings.hermesCliPath)`,onChange 保存 + `plugin.api.setHermesCliPath(v)` + `void plugin.api.init()` 重探。
3. **模型下拉**:ACP 模式用 `getAvailableModelLabels()`（hermes/acpProvider 提供）,HTTP 模式维持现状;选中值写 `settings.model`。
4. **「高级」折叠组**:`<details>` 包裹现有 gateway 地址/API key/测试连接三行 + `hermes.advancedDesc`。
5. **thoughtLevel 下拉**:backend==='hermes' 时 `setDisabled(true)` + desc 用 `hermes.thoughtUnsupported`。

- [ ] **Step 3: 降级顶条**

view.ts 消息区顶部加 `div.wb-hermes-lite-banner`(默认 `display:none`):`provider instanceof HermesProvider && provider.mode==='http'` 时显示 `t('hermes.liteBanner')`;构造时 `provider.onModeChange(() => this.refreshBanner())`;`refreshUI()` 里也调一次。styles.css 加 `.wb-hermes-lite-banner`（淡黄底、小字、圆角、底部 margin）。

- [ ] **Step 4: 验证**

```bash
npm run build 2>&1 | tail -3 && npx jest tests/i18n.test.ts --coverage=false 2>&1 | tail -3
```
期望:build 过、i18n 测试绿。

- [ ] **Step 5: 手测（demo-vault,禁动正式 vault）**

手测清单（结果补进 `docs/manual-test-checklist.md`）:
1. 设置 → Hermes:模式行显示 ACP 完整版 ✅;折叠组默认收起。
2. 新会话问「你好」→ 正常流式;再问「列出当前目录文件」→ 工具块出现 + 批准卡(default 模式)。
3. 切 dont_ask(完全访问)重发 → 不弹卡直接执行。
4. 会话 fork(tab 右键)→ 新会话含原上下文。
5. 重开面板 → 会话历史无重复加载(回放不泄进 UI)。
6. 改名 hermes CLI 路径为不存在 → 重探后模式变 HTTP 轻量,聊天区顶条出现,发消息纯对话无工具。
7. gateway 填 `http://10.100.0.1:8642` → init 后 http 模式(远程场景)。
8. thoughtLevel 下拉置灰。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: 设置页 ACP 状态行+高级折叠 + 降级顶条 + thoughtLevel 置灰"
```

---

### Task 9: smoke 扩 hermes + 手测清单 + README What's New

**Files:**
- Create: `scripts/hermes-acp-smoke.mjs`
- Modify: `docs/manual-test-checklist.md`
- Modify: `README.md`、`README.en.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: hermes smoke 脚本**

镜像 `scripts/acp-smoke.mjs` 骨架,CLI 候选 `process.env.HERMES_PATH` → `~/.local/bin/hermes` → `hermes`;覆盖:握手、session/new(models/modes 非空)、prompt 流式有字、set_mode dont_ask 写文件无批准卡、default 写文件有批准卡(自动 allow_once)、fork 返新 id、load 回放不泄(回放事件计数>0 且全部在 load 响应前)、cancel。

```bash
node scripts/hermes-acp-smoke.mjs /tmp/hermes-smoke-vault
```
期望:全项 PASS。

- [ ] **Step 2: 手测清单增补**

把 Task 8 Step 5 的 8 条 + smoke 结果补进 `docs/manual-test-checklist.md`（格式沿用该文件既有小节）。

- [ ] **Step 3: README What's New + status（发版规矩）**

README.md 顶部 What's New 加 v2.6.0 小节（Hermes ACP 完整版:工具/批准卡/thinking/usage/fork;HTTP 轻量自动降级;远程 gateway）,status 徽章/版本引用同步;README.en.md 同步英文版。

- [ ] **Step 4: CHANGELOG 起草**

`## v2.6.0 — 未发布` 小节:新增(Hermes ACP 完整版/自动降级/远程兜底/设置页方案一)+ 已知缺口(thoughtLevel 不支持)。

- [ ] **Step 5: 总验收**

```bash
npm test 2>&1 | tail -6
npm run build 2>&1 | tail -3
node scripts/acp-smoke.mjs /tmp/cb-smoke-vault   # codebuddy 回归不退
node scripts/hermes-acp-smoke.mjs /tmp/hermes-smoke-vault
```
期望:jest 全绿、coverage 汇总不降;build 过;两个 smoke 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test+docs: hermes smoke/手测清单/README What's New v2.6.0 起草"
```

---

## 自审记录（writing-plans 收尾）

- **Spec 覆盖**:spec §2 架构→Task 1/2/3;§3 方言表→Task 3/5(+Task 0 实证门);§4 路由器→Task 6;§5 设置/迁移/UI→Task 7/8;§6 测试验收→Task 0/9;§7 YAGNI→无对应任务(正确)。
- **类型一致性**:`AcpBackendProfile.forkMode`(Task 3 定义,Task 5 消费)、`hermesModelLabel`(Task 5 定义,Task 8 消费)、`HermesProvider.init/mode/demoteToHttp/onModeChange/setHermesCliPath`(Task 6 定义,Task 7/8 消费)、`getAvailableModelLabels`(Task 5 定义,Task 8 消费)、`StreamChunk` re-export 路径(Task 2 统一)。已核一致。
- **占位符**:无 TBD/TODO;Task 0 探针若推翻方言事实 → 回修 spec 再继续(已在该任务明示)。
