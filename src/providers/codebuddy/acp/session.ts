import type { StreamChunk } from '../index';
import {
    mapSessionUpdate, mapToolCallUpdate, mapUsageUpdate, mapConfigUpdate, isReplayUpdate, type AcpUpdate,
} from './events';
import {
    mapPermissionRequest, buildPermissionResult, pickOptionId, type PermissionCardData,
} from './permission';
import { bbLog } from '../../../shared/logBuffer';

/** session 层对传输层的最小依赖（AcpClient 天然满足；测试用 fake） */
export interface AcpClientFacade {
    request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
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
    onConfigUpdate?(cfg: { mode?: string; model?: string }): void;
}

export type SessionStatus = 'idle' | 'loading' | 'prompting' | 'awaitingPermission';

/** provider 级当前配置；对象引用在 provider/registry/各 session 间共享，改字段即对新会话生效 */
export interface SessionConfig { model: string; mode: string }

/**
 * 单会话状态机：idle → loading → idle（懒加载）；
 * idle → prompting → (awaitingPermission → prompting)* → idle（cancel 也须等 prompt 响应落账，spike 瑕疵⑤）。
 * 消息历史以插件持久化为唯一真相，session/load 回放事件一律吞掉不进 UI。
 */
export class AcpSession {
    acpSessionId: string | null = null;
    status: SessionStatus = 'idle';
    lastUsage: { used: number; size: number } | null = null;
    private needsReload = false;
    private handlers: TurnHandlers | null = null;
    private pendingPermissions = new Map<number, PermissionCardData>();
    private toolInputs = new Map<string, unknown>(); // toolCallId → 最新 rawInput 快照（替换式，traffic 实证快照语义）
    private toolNames = new Map<string, string>(); // toolCallId → toolName（update 缺 _meta 时兜底）

    constructor(
        readonly key: string,
        private readonly client: AcpClientFacade,
        private readonly lookup: ConversationLookup,
        private readonly config: SessionConfig,
    ) {}

    /** 进程死亡后由 provider 标记：下次 ensureLoaded 重新 session/load（CLI 侧上下文不丢） */
    markStale(): void {
        if (this.acpSessionId) this.needsReload = true;
    }

    async ensureLoaded(vaultPath?: string): Promise<void> {
        if (this.acpSessionId && !this.needsReload) return;
        this.status = 'loading';
        try {
            if (!this.acpSessionId) {
                // 懒加载链：插件存的 acpSessionId → 先试 v1 uuid（--session-id 时代 CLI 侧可能真存着）→ session/new 回写
                const candidate = this.lookup.getAcpSessionId(this.key) ?? this.key;
                try {
                    await this.client.request('session/load', { sessionId: candidate, cwd: vaultPath ?? '', mcpServers: [] });
                    this.acpSessionId = candidate;
                } catch {
                    const result = await this.client.request<{ sessionId: string }>(
                        'session/new', { cwd: vaultPath ?? '', mcpServers: [] });
                    this.acpSessionId = result.sessionId;
                }
                this.lookup.setAcpSessionId(this.key, this.acpSessionId);
            } else {
                await this.client.request('session/load', { sessionId: this.acpSessionId, cwd: vaultPath ?? '', mcpServers: [] });
            }
            this.needsReload = false;
            await this.applyConfig();
        } finally {
            this.status = 'idle';
        }
    }

    /** provider setModel/setPermissionMode 时对已加载会话逐一应用（按会话设置，双面板泄漏在协议层绝迹） */
    async applyRemoteConfig(): Promise<void> {
        if (this.acpSessionId) await this.applyConfig();
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

    async prompt(text: string, handlers: TurnHandlers): Promise<{ stopReason: string }> {
        if (this.status !== 'idle') throw new Error('session busy');
        if (!this.acpSessionId) throw new Error('session not loaded');
        this.status = 'prompting';
        this.handlers = handlers;
        this.toolInputs.clear();
        this.toolNames.clear();
        try {
            const result = await this.client.request<{ stopReason?: string }>('session/prompt', {
                sessionId: this.acpSessionId,
                prompt: [{ type: 'text', text }],
            });
            return { stopReason: typeof result.stopReason === 'string' ? result.stopReason : 'end_turn' };
        } finally {
            if (this.pendingPermissions.size) this.rejectPendingPermissions();
            this.status = 'idle';
            this.handlers = null;
        }
    }

    handleUpdate(update: AcpUpdate): void {
        if (this.status === 'loading' || isReplayUpdate(update)) return;
        const handlers = this.handlers;
        if (!handlers) return;
        if (update.sessionUpdate === 'tool_call_update') {
            const id = typeof update.toolCallId === 'string' ? update.toolCallId : '';
            if (!id) return;
            this.toolInputs.set(id, update.rawInput); // 快照替换，非合并
            const chunk = mapToolCallUpdate(update, update.rawInput);
            if (chunk) {
                if (!update._meta && this.toolNames.has(id)) chunk.toolName = this.toolNames.get(id)!;
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
            }
            handlers.onChunk(chunk);
        }
    }

    handlePermissionRequest(requestId: number, params: unknown): void {
        const data = mapPermissionRequest(requestId, params);
        const handlers = this.handlers;
        if (!handlers?.onPermissionRequest) {
            // 未注册批准回调（含 sendText 之外的调用方）：安全兜底统一拒绝，不悬挂
            this.client.respond(requestId, buildPermissionResult(pickOptionId(data.options, 'reject') ?? 'reject'));
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
        // status 归 idle 由 prompt() 的 finally 在 cancelled 响应落账时完成——这里不抢跑（spike 瑕疵⑤）
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
