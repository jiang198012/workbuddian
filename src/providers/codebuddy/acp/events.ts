import type { StreamChunk } from '../index';

export interface AcpUpdate {
    sessionUpdate?: string;
    [key: string]: unknown;
}

function textOf(update: AcpUpdate): string | null {
    const content = update.content as { type?: unknown; text?: unknown } | undefined;
    if (content?.type === 'text' && typeof content.text === 'string') return content.text;
    return null;
}

/** 工具名以 _meta['codebuddy.ai/toolName'] 为准，title 兜底（实测 tool_call 事件两者都有，title 可能是通用名） */
export function extractToolName(toolCall: { title?: unknown; _meta?: unknown; [key: string]: unknown }): string {
    const meta = toolCall._meta as Record<string, unknown> | undefined;
    const metaName = meta?.['codebuddy.ai/toolName'];
    if (typeof metaName === 'string' && metaName) return metaName;
    if (typeof toolCall.title === 'string' && toolCall.title) return toolCall.title;
    return 'tool';
}

/** rawInput 摘要：优先 file_path/path，其次 command，再退化为截断 JSON */
export function summarizeRawInput(rawInput: unknown): string {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) return '';
    const input = rawInput as Record<string, unknown>;
    for (const key of ['file_path', 'path', 'command']) {
        const v = input[key];
        if (typeof v === 'string' && v) return v;
    }
    if (!Object.keys(input).length) return '';
    try {
        const s = JSON.stringify(input);
        return s.length > 120 ? s.slice(0, 117) + '...' : s;
    } catch {
        return '';
    }
}

/** tool_call_update 的 rawInput 增量累积：对象浅合并，非对象增量整体替换 */
export function mergeRawInput(prev: unknown, increment: unknown): unknown {
    if (!increment || typeof increment !== 'object' || Array.isArray(increment)) return increment ?? prev;
    const base = prev && typeof prev === 'object' && !Array.isArray(prev) ? prev as Record<string, unknown> : {};
    return { ...base, ...(increment as Record<string, unknown>) };
}

export function mapSessionUpdate(update: AcpUpdate): StreamChunk | null {
    switch (update.sessionUpdate) {
        case 'agent_thought_chunk': {
            const text = textOf(update);
            return text === null ? null : { type: 'thinking', content: text };
        }
        case 'agent_message_chunk': {
            const text = textOf(update);
            return text === null ? null : { type: 'text', content: text };
        }
        case 'tool_call': {
            const toolName = extractToolName(update);
            return { type: 'tool', content: '', toolName, toolDetail: summarizeRawInput(update.rawInput) };
        }
        // tool_call_update 只进内部状态；usage/config 走旁路；info/checkpoint/commands/user echo 不进 UI
        default:
            return null;
    }
}

export function mapUsageUpdate(update: AcpUpdate): { used: number; size: number } | null {
    if (update.sessionUpdate !== 'usage_update') return null;
    const { used, size } = update;
    if (typeof used !== 'number' || typeof size !== 'number') return null;
    return { used, size };
}

export function mapConfigUpdate(update: AcpUpdate): { mode?: string; model?: string } | null {
    if (update.sessionUpdate === 'current_mode_update') {
        return typeof update.currentModeId === 'string' ? { mode: update.currentModeId } : null;
    }
    if (update.sessionUpdate === 'config_option_update') {
        const out: { mode?: string; model?: string } = {};
        const options = Array.isArray(update.configOptions) ? update.configOptions : [];
        for (const opt of options as Array<{ id?: unknown; currentValue?: unknown }>) {
            if (opt.id === 'mode' && typeof opt.currentValue === 'string') out.mode = opt.currentValue;
            if (opt.id === 'model' && typeof opt.currentValue === 'string') out.model = opt.currentValue;
        }
        return Object.keys(out).length ? out : null;
    }
    return null;
}

/** session/load 回放事件的判别：_meta['codebuddy.ai'].mode === 'history'（实测于 user_message_chunk 回放） */
export function isReplayUpdate(update: AcpUpdate): boolean {
    const meta = update._meta as Record<string, unknown> | undefined;
    const cb = meta?.['codebuddy.ai'] as { mode?: unknown } | undefined;
    return cb?.mode === 'history';
}
