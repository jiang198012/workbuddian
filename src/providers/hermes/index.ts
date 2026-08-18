/**
 * Hermes provider(MVP):经本地 Hermes gateway 的 OpenAI 兼容 HTTP API 对话。
 * 与 CodebuddyProvider 同契约(StreamChunk / 公共方法签名),供 view 层无差别调用。
 *
 * MVP 范围:POST /v1/chat/completions 流式 → text/done chunk;GET /v1/models 拉模型列表。
 * 不支持:工具块/批准卡/思考块/分叉(走 runs+events 才支持,留完整版)。
 */
import { bbLog, bbError } from '../../shared/logBuffer';
import type { UsageInfo } from '../../types';
import type { PermissionMode } from '../../shared/cliOptions';

export interface StreamChunk {
    type: 'thinking' | 'text' | 'tool' | 'error' | 'done';
    content: string;
    toolName?: string;
    toolDetail?: string;
    toolCallId?: string;
    toolStatus?: 'in_progress' | 'completed';
    toolOutput?: string;
    usage?: UsageInfo;
}

const DEFAULT_BASE = 'http://127.0.0.1:8642';

/** 带超时的 AbortSignal(AbortSignal.timeout 类型不在当前 TS lib,手写等价) */
function timeoutSignal(ms: number): AbortSignal {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), ms);
    (timer as unknown as { unref?: () => void }).unref?.(); // 不阻塞进程退出
    return c.signal;
}

export class HermesProvider {
    private timeout = 300_000;
    private baseUrl = DEFAULT_BASE;
    private apiKey = '';
    private model = 'auto';
    private abortController: AbortController | null = null;
    private availableModels: string[] = [];

    setGateway(baseUrl: string, apiKey: string): void {
        const changed = this.baseUrl !== (baseUrl || DEFAULT_BASE).replace(/\/$/, '') || this.apiKey !== apiKey.trim();
        this.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
        this.apiKey = apiKey.trim();
        // gateway 变了就重拉模型列表(异步,不阻塞)
        if (changed) void this.refreshModels();
    }

    /** 拉取并缓存模型列表;供外部主动刷新 */
    async refreshModels(): Promise<void> {
        const models = await this.listModels();
        if (models.length) this.availableModels = models;
    }
    setTimeout(ms: number): void { this.timeout = ms; }
    setModel(model: string): void { this.model = model; }

    /** 拉模型列表:优先 /api/model/options(当前 provider 的真实模型,与 Hermes Desktop 一致),回退 /v1/models */
    async listModels(): Promise<string[]> {
        try {
            // /api/model/options:当前 provider(is_current)的 models 是真实可用列表
            const res = await fetch(`${this.baseUrl}/api/model/options`, {
                headers: this.authHeaders(),
                signal: timeoutSignal(10_000),
            });
            if (res.ok) {
                const data = await res.json();
                const providers = (data?.providers ?? []) as Array<{ is_current?: boolean; models?: unknown }>;
                const current = providers.find((p) => p.is_current) ?? providers.find((p) => Array.isArray(p.models) && p.models.length);
                const models = (current?.models ?? []) as unknown[];
                const ids = models.filter((m): m is string => typeof m === 'string');
                if (ids.length) return ids;
            }
        } catch (e) {
            bbLog('[WB] hermes /api/model/options 失败,回退 /v1/models:', e);
        }
        // 回退:/v1/models(只有聚合名 hermes-agent)
        try {
            const res = await fetch(`${this.baseUrl}/v1/models`, {
                headers: this.authHeaders(),
                signal: timeoutSignal(10_000),
            });
            if (!res.ok) return [];
            const data = await res.json();
            const list = (data?.data ?? []) as Array<{ id?: string }>;
            return list.map((m) => m.id).filter((x): x is string => typeof x === 'string');
        } catch (e) {
            bbLog('[WB] hermes 拉模型失败:', e);
            return [];
        }
    }

    /** 发送消息:OpenAI 兼容流式,逐 chunk yield text;done 收尾(多余参数仅签名兼容,忽略) */
    async *sendMessage(
        sessionKey: string,
        text: string,
        vaultPath?: string,
        addDirs?: string[],
        permissionModeOverride?: PermissionMode,
        images?: Array<{ data: string; mimeType: string }>,
        mcpNames?: string[],
    ): AsyncGenerator<StreamChunk> {
        void sessionKey; void vaultPath; void addDirs; void permissionModeOverride; void images; void mcpNames;
        this.abortController = new AbortController();
        const timer = setTimeout(() => this.abortController?.abort(), this.timeout);
        try {
            const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
                body: JSON.stringify({
                    model: this.model === 'auto' ? undefined : this.model,
                    messages: [{ role: 'user', content: text }],
                    stream: true,
                }),
                signal: this.abortController.signal,
            });
            if (!res.ok || !res.body) {
                const errText = await res.text().catch(() => '');
                throw new Error(`Hermes 请求失败: HTTP ${res.status}${errText ? ` ${errText.slice(0, 120)}` : ''}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                // SSE:按行拆 data: 事件
                let idx: number;
                while ((idx = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx + 1);
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (payload === '[DONE]') break;
                    try {
                        const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
                        const delta = obj.choices?.[0]?.delta?.content;
                        if (delta) yield { type: 'text', content: delta };
                    } catch { /* 半行 JSON 忽略,等下一片 */ }
                }
            }
            yield { type: 'done', content: '' };
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                yield { type: 'done', content: '' }; // 取消/超时按 done 收尾
            } else {
                bbError('[WB] hermes 发送失败:', e);
                throw e;
            }
        } finally {
            clearTimeout(timer);
            this.abortController = null;
        }
    }

    /** 取消在飞请求 */
    cancel(_sessionKey?: string): void { this.abortController?.abort(); }

    /** 连接测试(设置页用):/v1/models 通则连得上 */
    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            const res = await fetch(`${this.baseUrl}/v1/models`, {
                headers: this.authHeaders(),
                signal: timeoutSignal(10_000),
            });
            if (res.status === 401 || res.status === 403) return { ok: false, error: 'API key 不匹配(401/403)' };
            if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
            return { ok: true };
        } catch (e) {
            return { ok: false, error: `连不上 gateway(${this.baseUrl}):${(e as Error).message}` };
        }
    }

    private authHeaders(): Record<string, string> {
        return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
    }

    // ---- 契约兼容:Hermes MVP 不支持的能力,空实现/简化 ----
    setCodebuddyPath(_p: string): void {}
    setNodePath(_p: string): void {}
    setPermissionMode(_mode: PermissionMode): void {}
    setThoughtLevel(_level: string): void {}
    setAvailableModels(_m: string[]): void {}
    getAvailableModels(): string[] { return [...this.availableModels]; }
    getScriptPath(): string { return ''; }
    setConversationLookup(_l: unknown): void {}
    setMcpServersJson(_j: string): void {}
    setCustomAgentsJson(_j: string): void {}
    generateId(): string { return `hermes-${Math.random().toString(36).slice(2, 10)}`; }
    onPermissionRequest(_k: string, _cb: unknown): void {}
    onUsage(_k: string, _cb: unknown): void {}
    onConfigUpdate(_k: string, _cb: unknown): void {}
    respondPermission(_id: number, _optionId: string): void {}
    rejectPendingPermissions(_k?: string): void {}
    async forkSession(_k: string, _n: string, _v?: string): Promise<string> {
        throw new Error('Hermes 不支持会话分叉');
    }
    dispose(): void { this.cancel(); }
}
