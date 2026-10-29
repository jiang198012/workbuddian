/**
 * Hermes 路由器：本机 CLI 可用 → ACP 完整版；远程 gateway / CLI 不可用 → HTTP 轻量版。
 * 对 view 层公共契约与 CodebuddyProvider 一致；mode 只读外露（降级顶条/设置页状态行用）。
 */
import { execFile, spawn } from 'child_process';
import { isAbsolute } from 'path';
import { bbLog, bbError } from '../../shared/logBuffer';
import { needsWindowsShell, resolveHermesPath } from '../../utils/cliPath';
import { AcpStartFailure } from '../acp/provider';
import { HermesAcpProvider } from './acpProvider';
import { HermesHttpProvider } from './httpProvider';
import type { StreamChunk } from '../acp/events';

export type { StreamChunk } from '../acp/events';
export type HermesMode = 'acp' | 'http';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);
const ACP_CHECK_TIMEOUT_MS = 15_000;
const DEFAULT_GATEWAY = 'http://127.0.0.1:8642';
/** gateway 冷启动窗口：Hermes 0.22 起 ACP 会话依赖 gateway，必须等它真正监听 */
const GATEWAY_START_TIMEOUT_MS = 20_000;

function isLocalGateway(url: string): boolean {
    if (!url.trim()) return true; // 空 = 本机自动发现
    try { return LOCAL_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchTimeout(ms: number): AbortSignal {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    return c.signal;
}

/** gateway 是否已在监听：任何 HTTP 响应（含 401）都算在线，无需先有正确 key */
async function gatewayListening(baseUrl: string): Promise<boolean> {
    try {
        await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, { signal: fetchTimeout(2_000) });
        return true;
    } catch { return false; }
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
    private initPromise: Promise<void> | null = null;
    private gatewayStarting: Promise<void> | null = null;

    get mode(): HermesMode { return this.modeValue; }
    onModeChange(cb: (m: HermesMode) => void): void { this.modeCbs.push(cb); }

    /**
     * main.ts onload/设置变更后调用：探测一次定模式（降级后粘性保持 http）。
     * 并发调用共享同一 Promise；sendMessage 也会 await 它，避免"插件刚加载就发消息"
     * 时用默认 http 模式打到还没启动的 gateway（表现为 Failed to fetch）。
     */
    init(): Promise<void> {
        if (this.demoted) return Promise.resolve();
        if (!this.initPromise) {
            this.initPromise = this.doInit().catch((e) => {
                // 探测本身失败不能阻塞聊天：退回 http 并把原因留在日志里
                bbError('[WB] hermes 初始化失败，使用 HTTP 模式:', e);
                this.setMode('http');
            });
        }
        return this.initPromise;
    }

    private async doInit(): Promise<void> {
        if (this.demoted) return;
        if (!isLocalGateway(this.gatewayUrl)) { this.setMode('http'); return; } // 远程 → 直接 http
        // Hermes 0.22+ 的 ACP 只是 gateway 的视图：gateway 不在时 session/new 会直接报
        // "Gateway inaccessible: service_start_failed"。先确保它活着（launchd 不可用的机器
        // 上由插件拉起 `hermes gateway run`），再决定 acp/http。
        await this.ensureLocalGateway();
        if (this.demoted) return;
        const cli = resolveHermesPath(this.cliPath);
        const ok = await new Promise<boolean>((resolve) => {
            execFile(cli, ['acp', '--check'], { timeout: ACP_CHECK_TIMEOUT_MS }, (err) => {
                // 失败详情必须进日志：设置页只显示"未检测到 CLI"，无详情无法排查（v2.6.0 教训）
                if (err) bbLog('[WB] hermes CLI 自检失败:', cli, String(err));
                resolve(!err);
            });
        });
        if (this.demoted) return;
        this.setMode(ok ? 'acp' : 'http');
        bbLog('[WB] hermes 路由:', this.modeValue, ok ? `(${cli})` : '(CLI 自检失败)');
    }

    /** 本机 gateway 没监听时后台拉起 `hermes gateway run`；失败只记日志，不抛给 UI */
    private ensureLocalGateway(): Promise<void> {
        if (this.gatewayStarting) return this.gatewayStarting;
        const base = this.gatewayUrl.trim() || DEFAULT_GATEWAY;
        this.gatewayStarting = (async () => {
            if (await gatewayListening(base)) return;
            const cli = resolveHermesPath(this.cliPath);
            // 未安装时 resolveHermesPath 回落裸命令；此时拉起必然 ENOENT，别白等 20s
            if (!isAbsolute(cli)) { bbLog('[WB] 未找到 hermes CLI，跳过 gateway 自启动:', cli); return; }
            bbLog('[WB] hermes gateway 未运行，尝试后台启动:', cli);
            try {
                const child = spawn(cli, ['gateway', 'run'], {
                    detached: true,
                    stdio: 'ignore',
                    env: { ...process.env },
                    shell: needsWindowsShell(cli),
                    windowsHide: true,
                });
                child.on('error', (e) => bbError('[WB] hermes gateway 启动失败:', e));
                child.unref(); // 不随 Obsidian 退出；下次启动由端口探测复用
            } catch (e) {
                bbError('[WB] hermes gateway 无法启动:', e);
                return;
            }
            const deadline = Date.now() + GATEWAY_START_TIMEOUT_MS;
            while (Date.now() < deadline) {
                await delay(500);
                if (await gatewayListening(base)) { bbLog('[WB] hermes gateway 已就绪:', base); return; }
            }
            bbError('[WB] hermes gateway 启动超时，请手动运行 `hermes gateway run`:', base);
        })().finally(() => { this.gatewayStarting = null; });
        return this.gatewayStarting;
    }

    /** 配置变更后重新探测：清掉旧 init 结果，下一次 init/sendMessage 重新定模式 */
    private resetInit(): void {
        this.initPromise = null;
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
        this.resetInit();
    }
    setGateway(url: string, key: string): void {
        this.gatewayUrl = url;
        this.http.setGateway(url, key);
        this.demoted = false;
        this.resetInit();
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
    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        await this.init();
        return this.http.testConnection();
    }

    async *sendMessage(...args: Parameters<HermesAcpProvider['sendMessage']>): AsyncGenerator<StreamChunk> {
        // 插件刚加载时 init() 还在探测：此处等它落定，避免首条消息误走 http 打到没启动的 gateway
        await this.init();
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
