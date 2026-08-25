/**
 * Hermes 路由器：本机 CLI 可用 → ACP 完整版；远程 gateway / CLI 不可用 → HTTP 轻量版。
 * 对 view 层公共契约与 CodebuddyProvider 一致；mode 只读外露（降级顶条/设置页状态行用）。
 */
import { execFile } from 'child_process';
import { bbLog, bbError } from '../../shared/logBuffer';
import { resolveHermesPath } from '../../utils/cliPath';
import { AcpStartFailure } from '../acp/provider';
import { HermesAcpProvider } from './acpProvider';
import { HermesHttpProvider } from './httpProvider';
import type { StreamChunk } from '../acp/events';

export type { StreamChunk } from '../acp/events';
export type HermesMode = 'acp' | 'http';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

function isLocalGateway(url: string): boolean {
    if (!url.trim()) return true; // 空 = 本机自动发现
    try { return LOCAL_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

/** 设置页/视图层复用：填了非本机 gateway 地址即远程场景（路由器同口径） */
export function isLocalHermesGateway(url: string): boolean { return isLocalGateway(url); }

export class HermesProvider {
    private readonly acp = new HermesAcpProvider();
    private readonly http = new HermesHttpProvider();
    private modeValue: HermesMode = 'http'; // init() 前保守为 http
    private demoted = false; // 粘性降级：本次插件生命周期内不再尝试 ACP
    private cliPath = '';
    private gatewayUrl = '';
    private modeCbs: Array<(m: HermesMode) => void> = [];

    get mode(): HermesMode { return this.modeValue; }
    onModeChange(cb: (m: HermesMode) => void): void { this.modeCbs.push(cb); }

    /** main.ts onload/设置变更后调用：探测一次定模式（降级后粘性保持 http） */
    async init(): Promise<void> {
        if (this.demoted) return;
        if (!isLocalGateway(this.gatewayUrl)) { this.setMode('http'); return; } // 远程 → 直接 http
        const cli = resolveHermesPath(this.cliPath);
        const ok = await new Promise<boolean>((resolve) => {
            execFile(cli, ['acp', '--check'], { timeout: 5000 }, (err) => resolve(!err));
        });
        this.setMode(ok ? 'acp' : 'http');
        bbLog('[WB] hermes 路由:', this.modeValue, ok ? `(${cli})` : '(CLI 自检失败)');
    }

    /** ACP 启动/运行失败 → 粘性降级 http（本次插件生命周期内不再尝试 ACP） */
    demoteToHttp(e: unknown): void {
        if (this.modeValue === 'http') return;
        this.demoted = true;
        bbError('[WB] hermes ACP 不可用，降级 HTTP 轻量模式:', e);
        this.setMode('http');
    }

    private setMode(m: HermesMode): void {
        if (m === this.modeValue) return;
        this.modeValue = m;
        for (const cb of this.modeCbs) cb(m);
    }

    private active(): HermesAcpProvider | HermesHttpProvider { return this.modeValue === 'acp' ? this.acp : this.http; }

    // ---- 契约转发（双 inner 都灌，模式翻转不丢注册）----
    setHermesCliPath(p: string): void {
        this.cliPath = p.trim();
        this.acp.setCliPath(p);
        this.demoted = false; // 用户改配置 = 显式重试信号，解除粘性降级
    }
    setGateway(url: string, key: string): void {
        this.gatewayUrl = url;
        this.http.setGateway(url, key);
        this.demoted = false;
    }
    setModel(m: string): void { this.acp.setModel(m); this.http.setModel(m); }
    setTimeout(ms: number): void { this.acp.setTimeout(ms); this.http.setTimeout(ms); }
    setPermissionMode(m: Parameters<HermesAcpProvider['setPermissionMode']>[0]): void {
        this.acp.setPermissionMode(m); this.http.setPermissionMode(m);
    }
    setThoughtLevel(l: string): void { this.acp.setThoughtLevel(l); this.http.setThoughtLevel(l); }
    setMcpServersJson(j: string): void { this.acp.setMcpServersJson(j); this.http.setMcpServersJson(j); }
    setCustomAgentsJson(j: string): void { this.acp.setCustomAgentsJson(j); this.http.setCustomAgentsJson(j); }
    setCodebuddyPath(_p: string): void {}
    setNodePath(_p: string): void {}
    setAvailableModels(m: string[]): void { this.acp.setAvailableModels(m); this.http.setAvailableModels(m); }
    getAvailableModels(): string[] { return this.active().getAvailableModels(); }
    /** 模型显示名（ACP 握手 name 字段）：HTTP 模式或无 name 时回落 id */
    getAvailableModelLabels(): Array<{ id: string; label: string }> {
        if (this.modeValue === 'acp') return this.acp.getAvailableModelLabels();
        return this.http.getAvailableModels().map((id) => ({ id, label: id }));
    }
    getScriptPath(): string { return this.active().getScriptPath(); }
    setConversationLookup(l: Parameters<HermesAcpProvider['setConversationLookup']>[0]): void {
        this.acp.setConversationLookup(l); this.http.setConversationLookup(l);
    }
    generateId(): string { return this.active().generateId(); }
    onPermissionRequest(k: string, cb: Parameters<HermesAcpProvider['onPermissionRequest']>[1]): void {
        this.acp.onPermissionRequest(k, cb); this.http.onPermissionRequest(k, cb);
    }
    onUsage(k: string, cb: Parameters<HermesAcpProvider['onUsage']>[1]): void {
        this.acp.onUsage(k, cb); this.http.onUsage(k, cb);
    }
    onConfigUpdate(k: string, cb: Parameters<HermesAcpProvider['onConfigUpdate']>[1]): void {
        this.acp.onConfigUpdate(k, cb); this.http.onConfigUpdate(k, cb);
    }
    respondPermission(id: number, o: string): void { this.acp.respondPermission(id, o); this.http.respondPermission(id, o); }
    rejectPendingPermissions(k?: string): void { this.acp.rejectPendingPermissions(k); this.http.rejectPendingPermissions(k); }
    cancel(k?: string): void { this.active().cancel(k); }
    forkSession(k: string, n: string, v?: string): Promise<string> { return this.active().forkSession(k, n, v); }
    testConnection(): Promise<{ ok: boolean; error?: string }> { return this.http.testConnection(); }

    async *sendMessage(...args: Parameters<HermesAcpProvider['sendMessage']>): AsyncGenerator<StreamChunk> {
        if (this.modeValue === 'acp') {
            try {
                yield* this.acp.sendMessage(...args);
                return;
            } catch (e) {
                // 启动失败 → 粘性降级后重抛（view 出错误卡）；轮中错误不降级
                if (e instanceof AcpStartFailure) this.demoteToHttp(e);
                throw e;
            }
        }
        yield* this.http.sendMessage(...args);
    }

    dispose(): void { this.acp.dispose(); this.http.dispose(); }
}
