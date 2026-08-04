import { FALLBACK_MODEL_OPTIONS, type PermissionMode } from '../../shared/cliOptions';
import { t } from '../../i18n';
import { bbLog, bbError } from '../../shared/logBuffer';
import type { UsageInfo } from '../../types';
import { AcpClient, AcpStartError, type AcpStartTier } from './acp/client';
import {
    SessionRegistry, type ConversationLookup, type SessionConfig, type TurnHandlers,
} from './acp/session';
import { mapConfigUpdate, isReplayUpdate, type AcpUpdate } from './acp/events';
import type { PermissionCardData } from './acp/permission';
import { activeMcpServers, parseMcpServers } from '../../shared/mcpServers';

// 供测试与外部消费方沿用 v1 的 re-export 路径
export { isWindowsWrapper, isBareFallback, needsWindowsShell } from '../../utils/cliPath';

const TIMEOUT = 300_000; // 5 分钟

export interface StreamChunk {
    type: 'thinking' | 'text' | 'tool' | 'error' | 'done';
    content: string;
    toolName?: string;
    toolDetail?: string;
    /** ACP 工具调用 id：同 id 的后续 chunk 就地更新同一行（乙方案） */
    toolCallId?: string;
    /** 工具终态信号：仅 completed 时出现，携带 JSON 快照 detail 供 diff/撤销 */
    toolStatus?: 'in_progress' | 'completed';
    /** completed 工具的原始输出（rawOutput.text），目前用于 Bash 终端块 */
    toolOutput?: string;
    usage?: UsageInfo;
}

interface SessionCallbacks {
    onPermissionRequest?: (data: PermissionCardData) => void;
    onUsage?: (used: number, size: number) => void;
    onConfigUpdate?: (cfg: { mode?: string; model?: string; thoughtLevel?: string }) => void;

}

const NOOP_LOOKUP: ConversationLookup = { getAcpSessionId: () => undefined, setAcpSessionId: () => {} };

/**
 * CodebuddyProvider v2 —— ACP 持久会话架构：单进程 `codebuddy --acp` + 多 session。
 * 对外契约（StreamChunk / 公共方法签名 / 错误 throw）与 v1 保持一致，UI 层零契约改动。
 * 数据流：input.ts → sendMessage → 会话懒加载 → session/prompt → session/update 映射成 chunk 回流；
 * 权限请求/用量/配置走旁路回调。
 */
export class CodebuddyProvider {
    private timeout: number;
    private readonly client: AcpClient;
    private readonly registry: SessionRegistry;
    private readonly config: SessionConfig = { model: 'auto', mode: 'default', mcpServers: [] };
    private lookup: ConversationLookup = NOOP_LOOKUP;
    private availableModels: string[] = Object.keys(FALLBACK_MODEL_OPTIONS);
    private callbacks = new Map<string, SessionCallbacks>();

    constructor(timeout: number = TIMEOUT) {
        this.client = new AcpClient({
            onSessionUpdate: (acpSessionId, update) => this.routeSessionUpdate(acpSessionId, update),
            onPermissionRequest: (requestId, params) => this.routePermissionRequest(requestId, params),
            onAgentNotification: (method) => bbLog('[WB] acp 通知:', method),
            onModels: (models) => { this.availableModels = models; },
            onExit: (code, signal) => this.handleProcessExit(code, signal),
        });
        this.registry = new SessionRegistry(
            this.client,
            {
                getAcpSessionId: (k) => this.lookup.getAcpSessionId(k),
                setAcpSessionId: (k, id) => this.lookup.setAcpSessionId(k, id),
            },
            this.config,
        );
        this.setTimeout(timeout);
    }

    setCodebuddyPath(p: string): void { this.client.setCodebuddyPath(p); }
    setTimeout(ms: number): void {
        this.timeout = ms;
        // 轮级超时到点会 cancel；CLI 连 cancel 都不应答的挂死由 client 侧兜底断链（宽限 60s）
        this.client.promptTimeoutMs = ms + 60_000;
    }
    setNodePath(nodePath: string): void { this.client.setNodePath(nodePath); }

    setModel(model: string): void {
        this.config.model = model;
        for (const s of this.registry.all()) void s.applyRemoteConfig();
    }

    setPermissionMode(mode: PermissionMode): void {
        this.config.mode = mode;
        for (const s of this.registry.all()) void s.applyRemoteConfig();
    }

    setThoughtLevel(level: string): void {
        this.config.thoughtLevel = level;
        for (const s of this.registry.all()) void s.applyRemoteConfig();
    }

    setAvailableModels(models: string[]): void { this.availableModels = models; }
    getAvailableModels(): string[] { return [...this.availableModels]; }
    getScriptPath(): string { return this.client.getScriptPath(); }

    /** main.ts 注入：Conversation.acpSessionId 的读写桥（懒加载与回写的唯一通道） */
    setConversationLookup(lookup: ConversationLookup): void { this.lookup = lookup; }

    /** MCP 服务器 JSON（数组）：解析失败保留旧值并记日志；空串清空 */
    setMcpServersJson(json: string): void {
        const trimmed = json.trim();
        if (!trimmed) { this.config.mcpServers = []; return; }
        try {
            JSON.parse(trimmed); // 先验 JSON 合法
            this.config.mcpServers = activeMcpServers(parseMcpServers(trimmed));
        } catch (e) {
            bbLog('[WB] mcpServersJson 解析失败，保留旧值:', e);
        }
    }

    /** 子代理 JSON（对象）：转为 CLI --agents 启动旗标；解析失败保留旧值；空串清空 */
    setCustomAgentsJson(json: string): void {
        const trimmed = json.trim();
        if (!trimmed) { this.client.setExtraArgs([]); return; }
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('agents 必须是对象');
            this.client.setExtraArgs(['--agents', trimmed]);
        } catch (e) {
            bbLog('[WB] customAgentsJson 解析失败，保留旧值:', e);
        }
    }

    generateId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // ---- 旁路回调注册（view 在 sendText 时按会话 key 注册） ----

    onPermissionRequest(sessionKey: string, cb: SessionCallbacks['onPermissionRequest']): void {
        this.callbacks.set(sessionKey, { ...this.callbacks.get(sessionKey), onPermissionRequest: cb });
    }

    onUsage(sessionKey: string, cb: SessionCallbacks['onUsage']): void {
        this.callbacks.set(sessionKey, { ...this.callbacks.get(sessionKey), onUsage: cb });
    }

    onConfigUpdate(sessionKey: string, cb: SessionCallbacks['onConfigUpdate']): void {
        this.callbacks.set(sessionKey, { ...this.callbacks.get(sessionKey), onConfigUpdate: cb });
    }

    /** 批准卡按钮应答：requestId 归哪个会话由 pending 持有情况路由 */
    respondPermission(requestId: number, optionId: string): void {
        for (const s of this.registry.all()) {
            if (s.respondPermission(requestId, optionId)) return;
        }
        bbLog('[WB] respondPermission 未找到悬挂请求:', requestId);
    }

    /** 悬挂边界：关面板/切会话/卸载前把批准请求统一答 reject，不悬挂到 CLI 侧干等 */
    rejectPendingPermissions(sessionKey?: string): void {
        for (const s of this.registry.all()) {
            if (!sessionKey || s.key === sessionKey) s.rejectPendingPermissions();
        }
    }

    /** 定向 cancel：有参只停该会话在飞轮次（双面板互不影响）；无参停全部（卸载兜底） */
    cancel(sessionId?: string): void {
        for (const s of this.registry.all()) {
            if (!sessionId || s.key === sessionId) void s.cancelTurn();
        }
    }

    /** 会话级分叉：懒加载后走 /branch，返回 CLI 分配的新 acpSessionId（启动失败沿用分级文案） */
    async forkSession(sessionKey: string, name: string, vaultPath?: string): Promise<string> {
        const session = this.registry.get(sessionKey);
        try {
            await this.client.ensureStarted();
            await session.ensureLoaded(vaultPath);
        } catch (e) {
            throw new Error(this.startErrorMessage(e));
        }
        return session.fork(name);
    }

    /** 卸载：拒悬挂批准 → terminate 进程 */
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
        images?: Array<{ data: string; mimeType: string }>,
    ): AsyncGenerator<StreamChunk> {
        // v2 退役项：addDirs（--add-dir 预授权 hack）与 permissionModeOverride（计划卡重发 workaround）
        // 仅保留签名兼容，不再消费；vault 外附件的读取授权由插件侧确认弹窗把关（WB-002）
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
        let chunkCount = 0; // 本轮实际到达的 chunk 数：零 chunk 落账是 CLI 状态机卡死的特征
        const push = (item: QueueItem) => {
            if (settled) return;
            if (item.end || item.error) settled = true;
            if (waiter) {
                const w = waiter;
                waiter = null;
                w(item);
            } else {
                queue.push(item);
            }
        };
        const pull = (): Promise<QueueItem> =>
            queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => { waiter = r; });

        const handlers: TurnHandlers = {
            onChunk: (chunk) => { chunkCount++; push({ chunk }); },
            onError: (message) => push({ error: message }),
            // 未注册批准回调时保持 undefined，session 层自动统一拒绝
            onPermissionRequest: cbs.onPermissionRequest ? (data) => cbs.onPermissionRequest!(data) : undefined,
            onUsage: (used, size) => cbs.onUsage?.(used, size),
            onConfigUpdate: (cfg) => cbs.onConfigUpdate?.(cfg),
        };

        // 单轮总超时照常计时（批准请求悬挂期间也在计）；到点 cancel + 错误卡，进程保活
        const startedAt = Date.now();
        const timer = setTimeout(() => {
            void session.cancelTurn();
            push({ error: t('provider.turnTimeout') });
        }, this.timeout);

        let promptPromise: Promise<{ stopReason: string }>;
        try {
            promptPromise = session.prompt(text, handlers, images);
        } catch (e) {
            clearTimeout(timer);
            throw e;
        }
        promptPromise.then(({ stopReason }) => {
            clearTimeout(timer);
            if (stopReason === 'end_turn') {
                if (chunkCount === 0) this.restartAfterDeadTurn(sessionId);
                push({
                    chunk: {
                        type: 'done', content: '',
                        usage: session.lastUsage ? { inputTokens: session.lastUsage.used } : undefined,
                    },
                });
                push({ end: true });
            } else if (stopReason === 'cancelled') {
                // 零 chunk 且拖了 >15s 才被取消 = 卡死后被中止（用户秒取消的正常停止不触发重启）
                if (chunkCount === 0 && Date.now() - startedAt > 15_000) this.restartAfterDeadTurn(sessionId);
                push({ end: true }); // 现有停止路径：静默结束（对齐 v1）
            } else {
                push({ error: t('provider.turnFailed').replace('{reason}', stopReason) });
            }
        }, (e: Error) => {
            clearTimeout(timer);
            // session busy 走本地化文案（async 函数的"同步"throw 实际都落到这个拒绝分支）
            push({ error: e.message === 'session busy' ? t('provider.busy') : e.message });
        });

        while (true) {
            const item = await pull();
            if (item.end) return;
            if (item.error) throw new Error(item.error);
            if (item.chunk) yield item.chunk;
        }
    }

    /** session/update 路由：按 acpSessionId 归会话；fork 回报可能挂在新 id 下，归给正在 fork 的会话；无归属记日志不再静默丢 */
    private routeSessionUpdate(acpSessionId: string, update: AcpUpdate): void {
        const target = this.registry.byAcpId(acpSessionId);
        if (target?.inTurn) {
            target.handleUpdate(update);
            return;
        }
        if (update.sessionUpdate === 'session_info_update') {
            const forking = this.registry.all().find((s) => s.forkPending);
            if (forking) {
                forking.handleUpdate(update);
                return;
            }
        }
        // CLI 会把流式事件打到"活动会话"名下而非 prompt 的 sessionId（acp-probe reactivate2 实证）：
        // tagged 会话不在轮次内时，文本/工具负载归给唯一在飞会话（prompt 已串行，至多一个），
        // 否则目标会话 handlers 为空、事件被丢，用户看到"无响应"（WB-RT-001/005 的兜底纠偏）
        const kind = update.sessionUpdate;
        const isStreamPayload = kind === 'agent_message_chunk' || kind === 'agent_thought_chunk'
            || kind === 'tool_call' || kind === 'tool_call_update';
        if (isStreamPayload) {
            const inFlight = this.registry.all().filter((s) => s.inTurn);
            if (inFlight.length === 1 && inFlight[0] !== target) {
                bbLog('[WB] 事件误标纠偏:', kind, acpSessionId, '→', inFlight[0].acpSessionId ?? '?');
                inFlight[0].handleUpdate(update);
                return;
            }
        }
        if (target) {
            // 轮外（无轮次 handlers）的 config 更新会在 session 层被丢弃：provider 旁路直推给注册方，
            // /effort 之类的 CLI 侧变更才能回流到设置（WB-007）；回放事件不直推（与 session 层口径一致）
            if (!isReplayUpdate(update)) {
                const cfg = mapConfigUpdate(update);
                if (cfg) this.callbacks.get(target.key)?.onConfigUpdate?.(cfg);
            }
            target.handleUpdate(update);
            return;
        }
        // load 回放事件到达时 acpSessionId 可能尚未回写，属预期，不算无归属（WB-RT-008 噪音）
        if (!isReplayUpdate(update)) {
            bbLog('[WB] acp update 无归属会话，已丢弃:', acpSessionId, update.sessionUpdate ?? '(unknown)');
        }
    }

    /**
     * 零 chunk 落账（end_turn/cancelled 但全程无任何事件到达）是 CLI 会话状态机卡死的特征
     *（GUI 日志实锤：AGENT_ENDED/RUN_PREPARING 被 ignored invalid transition，cancelling 卡死，
     * 后续 prompt 全部进门即丢，进程内无自愈路径）。标记全部会话待重载并重启进程，
     * 下一条消息经 session/load 恢复上下文（CLI 会话持久化在盘上）。
     */
    private restartAfterDeadTurn(sessionKey: string): void {
        bbError('[WB] 零 chunk 落账，CLI 状态机疑似卡死，重启进程自愈:', sessionKey);
        for (const s of this.registry.all()) s.markStale();
        this.client.dispose();
    }

    private routePermissionRequest(requestId: number, params: unknown): void {
        const sessionId = (params as { sessionId?: unknown } | undefined)?.sessionId;
        const session = typeof sessionId === 'string' ? this.registry.byAcpId(sessionId) : undefined;
        if (session) {
            session.handlePermissionRequest(requestId, params);
        } else {
            // 找不到归属会话：安全兜底统一拒绝
            this.client.respond(requestId, { outcome: { outcome: 'selected', optionId: 'reject' } });
        }
    }

    private handleProcessExit(code: number | null, signal: string | null): void {
        bbLog('[WB] acp 进程退出:', code, signal);
        for (const s of this.registry.all()) {
            s.markStale(); // 下次发送自动重启 + session/load 恢复（CLI 侧上下文不丢）
            s.failTurn(t('provider.processDied'));
        }
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
