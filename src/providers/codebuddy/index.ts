import { spawn, type SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getErrorMessage, getNumber, getString, isObject, type UsageInfo } from '../../types';
import { type PermissionMode } from '../../shared/cliOptions';
import { findNodeExecutable, resolveCodebuddyPath } from '../../utils/cliPath';

const TIMEOUT = 300_000; // 5 分钟

// ===== 流式事件类型 =====

export interface StreamChunk {
    type: 'thinking' | 'text' | 'tool' | 'error' | 'done';
    content: string;
    toolName?: string;
    toolDetail?: string;
    usage?: UsageInfo;
}

interface MessageBlock {
    type: 'thinking' | 'text' | 'tool_call';
    thinking?: string;
    text?: string;
    name?: string;
    input?: unknown;
}

interface StreamEvent {
    type: string;
    thinking?: string;
    text?: string;
    name?: string;
    input?: unknown;
    result?: string;
    error?: string;
    message?: string;
    content?: string;
    usage?: UsageInfo;
}

/** 从事件对象里抽取 token 用量：读 usage.input_tokens，缺失或非数字返回 undefined */
export function parseUsage(raw: unknown): UsageInfo | undefined {
    if (!isObject(raw)) return undefined;
    const usage = raw.usage;
    if (!isObject(usage)) return undefined;
    const inputTokens = getNumber(usage, 'input_tokens');
    if (typeof inputTokens !== 'number') return undefined;
    return { inputTokens };
}


// ===== 消息块解析 =====

export function parseMessageBlock(block: unknown): MessageBlock | null {
    if (!isObject(block)) return null;
    const type = getString(block, 'type');
    if (type !== 'thinking' && type !== 'text' && type !== 'tool_call') return null;
    return {
        type,
        thinking: getString(block, 'thinking'),
        text: getString(block, 'text'),
        name: getString(block, 'name'),
        input: block.input,
    };
}

export function blockToChunk(block: MessageBlock): StreamChunk | null {
    if (block.type === 'thinking') {
        return { type: 'thinking', content: block.thinking || '' };
    }
    if (block.type === 'text') {
        return { type: 'text', content: block.text || '' };
    }
    const input = block.input;
    return {
        type: 'tool',
        content: '',
        toolName: block.name || 'unknown',
        toolDetail: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
    };
}

// ===== 流事件解析 =====

export function parseStreamEvent(raw: unknown): StreamEvent | null {
    if (!isObject(raw)) return null;
    const event = isObject(raw.event) ? raw.event : raw;
    if (!isObject(event)) return null;
    return {
        type: getString(event, 'type') || '',
        thinking: getString(event, 'thinking'),
        text: getString(event, 'text'),
        name: getString(event, 'name'),
        input: event.input,
        result: getString(event, 'result'),
        error: getString(event, 'error'),
        message: getString(event, 'message'),
        content: getString(event, 'content'),
        usage: parseUsage(event),
    };
}

export function parseStreamLine(line: string): StreamChunk | null {
    if (!line.trim()) return null;
    try {
        const raw = JSON.parse(line) as unknown;

        // Shape 1: assistant/user envelope with nested message.content blocks
        if (isObject(raw) && (raw.type === 'assistant' || raw.type === 'user')) {
            const message = isObject(raw.message) ? raw.message : null;
            const content = Array.isArray(message?.content) ? message.content : [];
            for (const item of content) {
                const block = parseMessageBlock(item);
                if (block) {
                    const chunk = blockToChunk(block);
                    if (chunk) return chunk;
                }
            }
            return null;
        }

        // Shape 2: direct event object
        const event = parseStreamEvent(raw);
        if (!event) return null;

        if (event.type === 'thinking') {
            return { type: 'thinking', content: event.thinking || '' };
        }
        if (event.type === 'message_delta') {
            return { type: 'text', content: event.text || '' };
        }
        if (event.type === 'tool_call') {
            const input = event.input;
            return {
                type: 'tool',
                content: '',
                toolName: event.name || 'unknown',
                toolDetail: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
            };
        }
        if (event.type === 'result') {
            return { type: 'done', content: event.result || '', usage: event.usage };
        }
        if (event.type === 'error') {
            return { type: 'error', content: event.error || event.message || '未知错误' };
        }

        // 未知事件类型, 输出原始 JSON 便于调试
        console.log('[BB] unknown event:', line.substring(0, 200));
        const fallbackText = event.text || event.content || event.message || '';
        if (fallbackText) {
            return { type: 'text', content: fallbackText };
        }
        return null;
    } catch {
        return { type: 'text', content: line };
    }
}

// ===== 判断是否需要 node 来执行 =====

export function isWindowsWrapper(scriptPath: string): boolean {
    return scriptPath.endsWith('.cmd') || scriptPath.endsWith('.exe') || scriptPath.endsWith('.bat');
}

export function isBareFallback(scriptPath: string): boolean {
    // 兜底值 'codebuddy' 不是真实文件路径，让 OS 在 PATH 里找
    return scriptPath === 'codebuddy' || !path.isAbsolute(scriptPath);
}

export function needsWindowsShell(scriptPath: string): boolean {
    return process.platform === 'win32' && (scriptPath.endsWith('.cmd') || scriptPath.endsWith('.bat'));
}

export class CodebuddyProvider {
    private timeout: number;
    private scriptPath: string;
    private activeProc: ReturnType<typeof spawn> | null = null;
    private nodePathOverride: string = '';
    private model: string = 'auto';
    private permissionMode: PermissionMode = 'default';

    constructor(timeout: number = TIMEOUT) {
        this.timeout = timeout;
        this.scriptPath = resolveCodebuddyPath('');
    }

    setCodebuddyPath(p: string): void {
        this.scriptPath = resolveCodebuddyPath(p);
    }

    setTimeout(ms: number): void {
        this.timeout = ms;
    }

    setNodePath(nodePath: string): void {
        this.nodePathOverride = nodePath;
    }

    setModel(model: string): void {
        this.model = model;
    }

    setPermissionMode(mode: PermissionMode): void {
        this.permissionMode = mode;
    }

    generateId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r: number = (Math.random() * 16) | 0;
            const v: number = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    async *sendMessage(sessionId: string, text: string, vaultPath?: string): AsyncGenerator<StreamChunk> {
        const scriptPath = this.scriptPath;
        const procOptions: SpawnOptions = {
            timeout: this.timeout,
            stdio: ['ignore', 'pipe', 'pipe'],
        };
        if (vaultPath) {
            procOptions.cwd = vaultPath;
        }

        // --print --output-format stream-json: 结构化流式输出
        const cliArgs = ['--print', '--output-format', 'stream-json', '--session-id', sessionId, '--model', this.model, '--permission-mode', this.permissionMode, text];

        // Node 18+ Windows 下 spawn .cmd/.bat 需要 shell: true
        if (needsWindowsShell(scriptPath)) {
            procOptions.shell = true;
        }

        // 根据实际路径类型选择启动方式：
        // - .cmd/.exe/.bat → 直接 spawn（Windows 可执行/包装脚本）
        // - 兜底 'codebuddy' → 直接 spawn（让 OS 在 PATH 中查找）
        // - 纯脚本文件（无扩展名或 .js）→ spawn via node
        let proc: ReturnType<typeof spawn>;
        if (isWindowsWrapper(scriptPath) || isBareFallback(scriptPath)) {
            proc = spawn(scriptPath, cliArgs, procOptions);
        } else {
            const nodeBin = this.nodePathOverride || findNodeExecutable() || 'node';
            proc = spawn(nodeBin, [scriptPath, ...cliArgs], procOptions);
        }
        this.activeProc = proc;

        let buffer = '';
        let errOut = '';
        let hasOutput = false;
        const chunkQueue: StreamChunk[] = [];
        let resolveQueue: ((r: IteratorResult<StreamChunk>) => void) | null = null;
        let closed = false;

        proc.stdout.on('data', (d: Buffer) => {
            buffer += d.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const chunk = parseStreamLine(line);
                if (chunk) {
                    hasOutput = true;
                    const preview = typeof chunk.content === 'string' ? chunk.content.substring(0, 80) : JSON.stringify(chunk.content).substring(0, 80);
                    console.log('[BB] chunk:', chunk.type, preview);
                    if (resolveQueue) {
                        resolveQueue({ value: chunk, done: false });
                        resolveQueue = null;
                    } else {
                        chunkQueue.push(chunk);
                    }
                }
            }
        });

        proc.stderr.on('data', (d: Buffer) => {
            errOut += d.toString();
            console.log('[BB] stderr:', errOut);
        });

        proc.on('close', (code, signal) => {
            console.log('[BB] exit:', code, signal ? 'signal:' + signal : '', '| err:', errOut.substring(0, 200));
            closed = true;
            if (this.activeProc === proc) {
                this.activeProc = null;
            }
            if (resolveQueue) {
                if (errOut && !hasOutput) {
                    resolveQueue({ value: { type: 'error', content: errOut }, done: true });
                } else {
                    resolveQueue({ value: { type: 'done', content: '' }, done: true });
                }
                resolveQueue = null;
            }
        });

        proc.on('error', (e) => {
            if (this.activeProc === proc) {
                this.activeProc = null;
            }
            console.log('[BB] spawn err:', e.message, '| scriptPath:', scriptPath);
            closed = true;
            if (resolveQueue) {
                let hint = e.message;
                if (e.message.includes('ENOENT')) {
                    if (scriptPath === 'codebuddy') {
                        hint = '找不到 codebuddy CLI。请确认已安装 WorkBuddy 桌面版，或在插件设置中指定 codebuddy 路径。';
                    } else if (!isWindowsWrapper(scriptPath) && !isBareFallback(scriptPath)) {
                        hint = `找不到 Node.js 来运行 codebuddy (路径: ${scriptPath})。请确认已安装 Node.js。`;
                    }
                }
                resolveQueue({ value: { type: 'error', content: hint }, done: true });
                resolveQueue = null;
            }
        });

        // 主循环
        while (true) {
            if (chunkQueue.length > 0) {
                const nextChunk = chunkQueue.shift();
                if (nextChunk) {
                    yield nextChunk;
                    continue;
                }
            }
            if (closed) {
                if (buffer.trim()) {
                    const chunk = parseStreamLine(buffer);
                    if (chunk) yield chunk;
                }
                break;
            }
            const next = await new Promise<IteratorResult<StreamChunk>>((r) => {
                resolveQueue = r;
            });
            if (next.done) {
                if (next.value?.type === 'error') throw new Error(next.value.content);
                break;
            }
            yield next.value;
        }
    }

    cancel(): void {
        if (this.activeProc) {
            this.activeProc.kill();
        }
    }
}
