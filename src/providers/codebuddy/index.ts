import { spawn, type SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getErrorMessage, getNumber, getString, isObject, type UsageInfo } from '../../types';
import { t } from '../../i18n';
import { type PermissionMode } from '../../shared/cliOptions';
import { findNodeExecutable, resolveCodebuddyPath } from '../../utils/cliPath';
import { bbLog } from '../../shared/logBuffer';

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

export function parseStreamLine(line: string, streaming = false): StreamChunk | null {
    if (!line.trim()) return null;
    try {
        const raw = JSON.parse(line) as unknown;

        // Shape 1: assistant/user envelope with nested message.content blocks
        if (isObject(raw) && (raw.type === 'assistant' || raw.type === 'user')) {
            const message = isObject(raw.message) ? raw.message : null;
            const content = Array.isArray(message?.content) ? message.content : [];
            for (const item of content) {
                const block = parseMessageBlock(item);
                if (!block) continue;
                // streaming 模式下 text/thinking 已由增量 delta 逐字吐过，envelope 末尾会
                // 重复整段正文，跳过以免翻倍；工具块（tool_call）不走 delta，仍需保留
                if (streaming && (block.type === 'text' || block.type === 'thinking')) continue;
                const chunk = blockToChunk(block);
                if (chunk) return chunk;
            }
            return null;
        }

        // Shape 3: --include-partial-messages 的 SSE 增量事件，逐字流式的来源
        // { type:'stream_event', event:{ type:'content_block_delta', delta:{ type:'text_delta'|'thinking_delta', ... } } }
        if (isObject(raw) && raw.type === 'stream_event' && isObject(raw.event)) {
            const ev = raw.event;
            if (getString(ev, 'type') === 'content_block_delta' && isObject(ev.delta)) {
                const delta = ev.delta;
                const dtype = getString(delta, 'type');
                if (dtype === 'text_delta') {
                    const text = getString(delta, 'text');
                    return text ? { type: 'text', content: text } : null;
                }
                if (dtype === 'thinking_delta') {
                    const thinking = getString(delta, 'thinking');
                    return thinking ? { type: 'thinking', content: thinking } : null;
                }
            }
            // 其它 stream_event（message_start/stop、content_block_start/stop、input_json_delta）无需展示
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
            return { type: 'error', content: event.error || event.message || t('common.unknownError') };
        }

        // 未知事件类型, 输出原始 JSON 便于调试
        bbLog('[WB] unknown event:', line.substring(0, 200));
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

    async *sendMessage(sessionId: string, text: string, vaultPath?: string, addDirs: string[] = []): AsyncGenerator<StreamChunk> {
        const scriptPath = this.scriptPath;
        const procOptions: SpawnOptions = {
            timeout: this.timeout,
            // stdin 打开为管道：prompt 通过 stdin 喂给 CLI，不走命令行参数
            stdio: ['pipe', 'pipe', 'pipe'],
        };
        if (vaultPath) {
            procOptions.cwd = vaultPath;
        }

        // --print --output-format stream-json: 结构化流式输出
        // --include-partial-messages: 吐 SSE 增量事件（content_block_delta），实现逐字流式；
        //   否则 CLI 只在末尾整段给完整 assistant 消息，界面会一次性冒出全文而非逐字
        const cliArgs = ['--print', '--output-format', 'stream-json', '--include-partial-messages'];
        // 附件在 vault 外时：--add-dir 放开这些目录的访问边界；--allowedTools 再用「限定到该
        //   目录」的只读规则 Read(dir/**) 免掉非交互(--print)模式下弹不出来的审批——否则外部
        //   文件既进不了边界、Read 又会因无法审批而失败。
        //   安全：只授权到附件所在目录的只读。实测「全局 Read」会突破 --add-dir 边界读任意文件，
        //   故必须限定目录；也不用 -y / bypassPermissions，避免放开写和执行。
        //   两者都是变长参数，必须放在 --session-id 之前，让后续 flag 终结它们，避免吞掉末尾 message。
        if (addDirs.length) {
            cliArgs.push('--add-dir', ...addDirs);
            cliArgs.push('--allowedTools', ...addDirs.map(d => `Read(${d.replace(/\\/g, '/')}/**)`));
        }
        // prompt 不再作为位置参数：改从 stdin 传入（见下方 proc.stdin 写入）。
        // 大笔记 / 大 @ 引用会让整条命令行超过 Windows 上限（cmd.exe 8191 / CreateProcess
        // 32767 字符）→ spawn ENAMETOOLONG；stdin 无此长度限制。CLI 默认 --input-format text，
        // 不带位置参数时从 stdin 读 prompt（官方 headless 用法：echo "..." | codebuddy -p）。
        cliArgs.push('--session-id', sessionId, '--model', this.model, '--permission-mode', this.permissionMode);

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

        // 把整段 prompt 写入 CLI 的 stdin 后关闭；不 end 则 CLI 会一直等输入不返回。
        const stdin = proc.stdin;
        if (stdin) {
            // 进程若提前退出（如 ENOENT），写 stdin 会抛 EPIPE；吞掉即可——
            // 真正的启动失败由下面的 proc.on('error') 统一上报，不在这里重复处理。
            stdin.on('error', () => { /* ignore EPIPE from an already-exited process */ });
            stdin.write(text);
            stdin.end();
        }

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
                const chunk = parseStreamLine(line, true);
                if (chunk) {
                    hasOutput = true;
                    const preview = typeof chunk.content === 'string' ? chunk.content.substring(0, 80) : JSON.stringify(chunk.content).substring(0, 80);
                    bbLog('[WB] chunk:', chunk.type, preview);
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
            bbLog('[WB] stderr:', errOut);
        });

        proc.on('close', (code, signal) => {
            bbLog('[WB] exit:', code, signal ? 'signal:' + signal : '', '| err:', errOut.substring(0, 200));
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
            bbLog('[WB] spawn err:', e.message, '| scriptPath:', scriptPath);
            closed = true;
            if (resolveQueue) {
                let hint = e.message;
                if (e.message.includes('ENOENT')) {
                    if (scriptPath === 'codebuddy') {
                        hint = t('provider.cliNotFound');
                    } else if (!isWindowsWrapper(scriptPath) && !isBareFallback(scriptPath)) {
                        hint = t('provider.nodeNotFound').replace('{path}', scriptPath);
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
                    const chunk = parseStreamLine(buffer, true);
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
