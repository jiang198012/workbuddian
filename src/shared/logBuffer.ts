/**
 * 内存环形日志缓冲：把 [WB] 运行日志存进上限 300 条的缓冲，供设置页「查看日志」展示。
 * 普通日志只入缓冲、不打 console（避免控制台噪音）；错误另走 console.error。
 * 纯内存，重载 Obsidian 即清空，不写盘、不污染 vault。
 */
const MAX_ENTRIES = 300;
const buffer: string[] = [];

function stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function safeStringify(v: unknown): string {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
}

function push(line: string): void {
    buffer.push(line);
    if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

/** 普通日志：只存缓冲（设置页「查看日志」可看），不打 console，避免控制台噪音 */
export function bbLog(...args: unknown[]): void {
    push(`[${stamp()}] ${args.map(safeStringify).join(' ')}`);
}

/** 错误日志：存缓冲（标 ERR）+ 打 console.error */
export function bbError(...args: unknown[]): void {
    push(`[${stamp()}] ERR ${args.map(safeStringify).join(' ')}`);
    console.error(...args);
}

/** 取全部日志（副本，最旧在前） */
export function getLogs(): string[] {
    return buffer.slice();
}

/** 清空日志缓冲 */
export function clearLogs(): void {
    buffer.length = 0;
}
