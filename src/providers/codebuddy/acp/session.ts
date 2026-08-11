import type { StreamChunk } from '../index';
import {
    mapSessionUpdate, mapToolCallUpdate, mapUsageUpdate, mapConfigUpdate, isReplayUpdate, type AcpUpdate,
} from './events';
import {
    mapPermissionRequest, buildPermissionResult, pickOptionId, type PermissionCardData,
} from './permission';
import { appendTextChunk } from '../../../shared/responseFinalize';
import { bbLog } from '../../../shared/logBuffer';

/** session 层对传输层的最小依赖（AcpClient 天然满足；测试用 fake） */
export interface AcpClientFacade {
    request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
    /** 把"再激活 load + prompt"原子排入串行队列；fn 内发 prompt 本体须用 rawRequest 防自排队死锁 */
    enqueuePrompt<T = unknown>(fn: () => Promise<T>): Promise<T>;
    /** 绕过串行队列直接发请求：仅供 enqueuePrompt 的 fn 内部使用 */
    rawRequest<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
    notify(method: string, params: Record<string, unknown>): void;
    respond(requestId: number, result: unknown): void;
}

/** provider 与插件持久化之间的桥：main.ts 注入，读写 Conversation.acpSessionId */
export interface ConversationLookup {
    getAcpSessionId(key: string): string | undefined;
    setAcpSessionId(key: string, acpSessionId: string): void;
}

export interface TurnHandlers {
    onChunk(chunk: StreamChunk): void;
    onError(message: string): void;
    onPermissionRequest?(data: PermissionCardData): void;
    onUsage?(used: number, size: number): void;
    onConfigUpdate?(cfg: { mode?: string; model?: string; thoughtLevel?: string }): void;
}

export type SessionStatus = 'idle' | 'loading' | 'prompting' | 'awaitingPermission';

/** provider 级当前配置；对象引用在 provider/registry/各 session 间共享，改字段即对新会话生效 */
export interface SessionConfig { model: string; mode: string; mcpServers?: unknown[]; thoughtLevel?: string }

/**
 * 单会话状态机：idle → loading → idle（懒加载）；
 * idle → prompting → (awaitingPermission → prompting)* → idle（cancel 也须等 prompt 响应落账，spike 瑕疵⑤）。
 * 消息历史以插件持久化为唯一真相，session/load 回放事件一律吞掉不进 UI。
 */
export class AcpSession {
    acpSessionId: string | null = null;
    status: SessionStatus = 'idle';
    lastUsage: { used: number; size: number } | null = null;
    /** fork 轮进行中标记：fork 回报（session_info_update）可能挂在新会话 id 下，provider 据此把事件归给本会话（WB-004） */
    forkPending = false;
    private needsReload = false;
    private handlers: TurnHandlers | null = null;
    private pendingPermissions = new Map<number, PermissionCardData>();
    private toolInputs = new Map<string, unknown>(); // toolCallId → 最新 rawInput 快照（替换式，traffic 实证快照语义）
    private toolNames = new Map<string, string>(); // toolCallId → toolName（update 缺 _meta 时兜底）
    private lastForkedSessionId: string | null = null; // /branch 分叉后 CLI 经 session_info_update 回报的新会话 id
    private lastVaultPath: string | undefined; // ensureLoaded 记录，prompt 前再激活重放用
    private agentInFlight = new Set<string>(); // 在飞 Agent 工具调用（窗口内文本=子代理中继，WB-RT-007）
    private agentRelay = ''; // Agent 窗口内累积的中继文本，完成时挂为该行输出块
    private cancelPending = false; // 排队/在飞轮次被取消：到队首直接作废，不再占用 CLI

    constructor(
        readonly key: string,
        private readonly client: AcpClientFacade,
        private readonly lookup: ConversationLookup,
        private readonly config: SessionConfig,
        // 全 registry 共享：CLI 当前活动会话（最近 new/load 者）。直构造函数（测试）时各持一份，不产生串扰
        private readonly activation: { current: string | null } = { current: null },
    ) {}

    /** 是否处于轮次内（有活跃 handlers）：轮外的 config 更新由 provider 旁路直推，不经本对象（WB-007） */
    get inTurn(): boolean { return this.handlers !== null; }

    /** 进程死亡后由 provider 标记：下次 ensureLoaded 重新 session/load（CLI 侧上下文不丢） */
    markStale(): void {
        if (this.acpSessionId) this.needsReload = true;
    }

    async ensureLoaded(vaultPath?: string, mcpServersOverride?: unknown[]): Promise<void> {
        if (this.acpSessionId && !this.needsReload) return;
        this.status = 'loading';
        this.lastVaultPath = vaultPath;
        // R10 context-saving MCP:本次加载优先用调用方按需过滤的服务器（@mcp 激活才注入），否则回退全局配置
        const mcpServers = mcpServersOverride ?? this.config.mcpServers ?? [];
        try {
            if (!this.acpSessionId) {
                // 懒加载链：插件存的 acpSessionId → 先试 v1 uuid（--session-id 时代 CLI 侧可能真存着）→ session/new 回写
                const candidate = this.lookup.getAcpSessionId(this.key) ?? this.key;
                try {
                    await this.client.request('session/load', { sessionId: candidate, cwd: vaultPath ?? '', mcpServers });
                    this.acpSessionId = candidate;
                } catch {
                    const result = await this.client.request<{ sessionId: string }>(
                        'session/new', { cwd: vaultPath ?? '', mcpServers });
                    this.acpSessionId = result.sessionId;
                }
                this.lookup.setAcpSessionId(this.key, this.acpSessionId);
            } else {
                await this.client.request('session/load', { sessionId: this.acpSessionId, cwd: vaultPath ?? '', mcpServers });
            }
            this.activation.current = this.acpSessionId; // new/load 都会把 CLI 的活动会话切到本会话
            this.needsReload = false;
            await this.applyConfig();
        } finally {
            this.status = 'idle';
        }
    }

    /** provider setModel/setPermissionMode 时对已加载会话逐一应用（按会话设置，双面板泄漏在协议层绝迹） */
    async applyRemoteConfig(): Promise<void> {
        if (!this.acpSessionId) return;
        // set_mode/set_config_option 可能同样跟随 CLI 活动会话指针（与 prompt 同病）：
        // 目标会话不是活动会话时先重发 load 激活，再灌配置（WB-RT-006/F3 完全访问仍弹卡的嫌疑路径）
        if (this.activation.current !== this.acpSessionId) {
            await this.client.request('session/load', {
                sessionId: this.acpSessionId, cwd: this.lastVaultPath ?? '', mcpServers: this.config.mcpServers ?? [],
            });
            this.activation.current = this.acpSessionId;
        }
        await this.applyConfig();
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
        try {
            if (this.config.thoughtLevel) {
                await this.client.request('session/set_config_option', { sessionId, configId: 'thought_level', value: this.config.thoughtLevel });
            }
        } catch (e) { bbLog('[WB] acp 设置思考力度失败（忽略）:', e); }
    }

    async prompt(text: string, handlers: TurnHandlers, images?: Array<{ data: string; mimeType: string }>): Promise<{ stopReason: string }> {
        if (this.status !== 'idle') throw new Error('session busy');
        if (!this.acpSessionId) throw new Error('session not loaded');
        const acpId = this.acpSessionId;
        // status 从调用时起占住（busy 护栏）；handlers 与再激活到队首才生效——
        // 排队期间到达的事件不属于本轮，不该进这一轮的 handlers
        this.status = 'prompting';
        try {
            const prompt: Array<Record<string, unknown>> = images?.length
                ? [...images.map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType })), { type: 'text', text }]
                : [{ type: 'text', text }];
            const result = await this.client.enqueuePrompt(async () => {
                // 排队期间被取消（如标题轮被用户消息抢占）：到队首直接作废，不占 CLI（吐字响应优先）
                if (this.cancelPending) return { stopReason: 'cancelled' };
                this.handlers = handlers;
                this.toolInputs.clear();
                this.toolNames.clear();
                this.agentInFlight.clear();
                this.agentRelay = '';
                // CLI 的流式事件与模型上下文跟随"最近 new/load 的会话"而非 prompt 的 sessionId
                //（acp-probe reactivate2/titlefix 实证）：到队首才再激活，排队期间指针不会被抢走。
                // 不激活则本轮事件被打到别的会话名下、模型用错上下文（WB-RT-001/005）
                if (this.activation.current !== acpId) {
                    bbLog('[WB] prompt 前重新激活会话:', acpId);
                    this.status = 'loading'; // 回放事件经 handleUpdate 的 loading 守卫丢弃
                    try {
                        await this.client.request('session/load', {
                            sessionId: acpId, cwd: this.lastVaultPath ?? '', mcpServers: this.config.mcpServers ?? [],
                        });
                        this.activation.current = acpId;
                    } finally {
                        this.status = 'prompting';
                    }
                }
                // 必须走 rawRequest：request('session/prompt') 会再排队，造成自等待死锁
                return this.client.rawRequest<{ stopReason?: string }>('session/prompt', {
                    sessionId: acpId,
                    prompt,
                });
            });
            return { stopReason: typeof result.stopReason === 'string' ? result.stopReason : 'end_turn' };
        } finally {
            if (this.pendingPermissions.size) this.rejectPendingPermissions();
            this.status = 'idle';
            this.handlers = null;
            this.cancelPending = false;
        }
    }

    handleUpdate(update: AcpUpdate): void {
        if (this.status === 'loading' || isReplayUpdate(update)) return;
        // 分叉回报须在 handlers 空检查之前捕获：fork 轮走丢弃 handlers，id 不能跟着被丢
        if (update.sessionUpdate === 'session_info_update') {
            const meta = update._meta as Record<string, unknown> | undefined;
            const forked = meta?.['codebuddy.ai/newSessionId'];
            if (meta?.['codebuddy.ai/sessionReset'] && typeof forked === 'string') {
                this.lastForkedSessionId = forked;
            }
        }
        const handlers = this.handlers;
        if (!handlers) return;
        if (update.sessionUpdate === 'tool_call_update') {
            const id = typeof update.toolCallId === 'string' ? update.toolCallId : '';
            if (!id) return;
            // 只在事件自带 rawInput 时更新快照：不带 rawInput 的更新（常见于 completed）不能冲掉已累积的数据，
            // 否则完成态丢失路径/diff 数据源（WB-003）
            if (update.rawInput !== undefined) this.toolInputs.set(id, update.rawInput); // 快照替换，非合并
            const chunk = mapToolCallUpdate(update, this.toolInputs.get(id));
            if (chunk) {
                if (!update._meta && this.toolNames.has(id)) chunk.toolName = this.toolNames.get(id)!;
                if (update.status === 'completed') {
                    // 诊断：完成态是否有 diff 数据源（WB-RT-003/004 若再失败先看这行）
                    bbLog('[WB] 工具完成:', chunk.toolName ?? '?', '| 快照:', this.toolInputs.has(id) ? '有' : '无');
                    if (this.agentInFlight.delete(id) && this.agentRelay) {
                        // Agent 完成：窗口内累积的子代理中继挂为该行输出块，正文由主代理总结承担（WB-RT-007）
                        chunk.toolOutput = this.agentRelay;
                        this.agentRelay = '';
                    }
                }
                handlers.onChunk(chunk);
            }
            return;
        }
        const usage = mapUsageUpdate(update);
        if (usage) {
            this.lastUsage = usage;
            handlers.onUsage?.(usage.used, usage.size);
            return;
        }
        const config = mapConfigUpdate(update);
        if (config) {
            handlers.onConfigUpdate?.(config);
            return;
        }
        const chunk = mapSessionUpdate(update);
        if (chunk) {
            if (chunk.type === 'tool' && typeof update.toolCallId === 'string') {
                this.toolNames.set(update.toolCallId, chunk.toolName ?? 'tool');
                this.toolInputs.set(update.toolCallId, update.rawInput ?? {});
                if (chunk.toolName === 'Agent') this.agentInFlight.add(update.toolCallId);
            }
            if (chunk.type === 'text' && this.agentInFlight.size > 0) {
                // Agent 调用窗口内的文本是子代理中继：不入正文主流（主代理完成后会自行总结，两遍都进正文即 WB-RT-007 的重复），
                // 累积后挂为 Agent 行的输出块
                this.agentRelay = appendTextChunk(this.agentRelay, chunk.content);
                return;
            }
            handlers.onChunk(chunk);
        }
    }

    handlePermissionRequest(requestId: number, params: unknown): void {
        const data = mapPermissionRequest(requestId, params);
        // 批准卡是 default 模式下 rawInput 最可靠的来源：按 toolCallId 水合快照与工具名，
        // completed 事件（常不带 rawInput）据此出 diff/撤销（WB-003）
        const toolCall = (params as { toolCall?: unknown } | undefined)?.toolCall;
        const tc = toolCall && typeof toolCall === 'object' && !Array.isArray(toolCall)
            ? toolCall as Record<string, unknown> : {};
        const toolCallId = typeof tc.toolCallId === 'string' ? tc.toolCallId : '';
        if (toolCallId) {
            if (tc.rawInput !== undefined) this.toolInputs.set(toolCallId, tc.rawInput);
            this.toolNames.set(toolCallId, data.toolName);
        }
        const handlers = this.handlers;
        if (!handlers?.onPermissionRequest) {
            // 未注册批准回调（含 sendText 之外的调用方）：安全兜底统一拒绝，不悬挂
            this.client.respond(requestId, buildPermissionResult(pickOptionId(data.options, 'reject') ?? 'reject'));
            return;
        }
        // 完全访问（bypassPermissions）：CLI 侧 mode 虽已生效，但部分工具链仍会发权限请求
        // （历史 WB-R2-001：完全访问仍弹 Write/Edit 批准卡）。这里兜底自动选 allow_always，
        // 不再弹卡；rawInput 快照已在上方采集，diff/撤销数据不受影响。
        if (this.config.mode === 'bypassPermissions') {
            const allowAlways = pickOptionId(data.options, 'allow_always');
            if (allowAlways) {
                this.client.respond(requestId, buildPermissionResult(allowAlways));
                return;
            }
            const allowOnce = pickOptionId(data.options, 'allow_once');
            if (allowOnce) {
                this.client.respond(requestId, buildPermissionResult(allowOnce));
                return;
            }
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

    /** 会话级分叉：发 /branch prompt，从 session_info_update 捕获 newSessionId；fork 轮 chunk 全部丢弃 */
    async fork(name: string): Promise<string> {
        if (this.status !== 'idle') throw new Error('session busy');
        if (!this.acpSessionId) throw new Error('session not loaded');
        this.lastForkedSessionId = null;
        const sink: TurnHandlers = { onChunk: () => {}, onError: () => {} };
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('fork timeout (60s)')), 60_000);
        });
        this.forkPending = true; // 回报事件可能挂在新会话 id 下，provider 据此归给本会话
        bbLog('[WB] fork 开始:', this.acpSessionId, name);
        try {
            await Promise.race([this.prompt(`/branch ${name}`, sink), timeout]);
        } catch (e) {
            // 保留底层原因（超时 / prompt 自身报错），不再压成无差别的 fork failed
            bbLog('[WB] fork 失败:', e);
            throw new Error(`fork failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.forkPending = false;
            clearTimeout(timer!);
        }
        if (!this.lastForkedSessionId) {
            bbLog('[WB] fork 失败: prompt 完成但未收到 session_info_update 回报');
            throw new Error('fork failed: no session_info_update');
        }
        bbLog('[WB] fork 成功:', this.acpSessionId, '→', this.lastForkedSessionId);
        return this.lastForkedSessionId;
    }

    async cancelTurn(): Promise<void> {
        if (this.status !== 'prompting' && this.status !== 'awaitingPermission') return;
        this.rejectPendingPermissions();
        this.cancelPending = true; // 还在排队的轮次到队首直接作废（prompt 的 finally 统一清旗标）
        if (this.acpSessionId) this.client.notify('session/cancel', { sessionId: this.acpSessionId });
        // status 归 idle 由 prompt() 的 finally 在 cancelled 响应落账时完成——这里不抢跑（spike 瑕疵⑤）
    }

    failTurn(message: string): void {
        this.handlers?.onError(message);
    }
}

export class SessionRegistry {
    private sessions = new Map<string, AcpSession>();
    /** 全注册表共享的"CLI 当前活动会话"指针：任何 new/load 都会切换它（探针实证） */
    private readonly activation = { current: null as string | null };

    constructor(
        private readonly client: AcpClientFacade,
        private readonly lookup: ConversationLookup,
        private readonly config: SessionConfig,
    ) {}

    get(key: string): AcpSession {
        let s = this.sessions.get(key);
        if (!s) {
            s = new AcpSession(key, this.client, this.lookup, this.config, this.activation);
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
