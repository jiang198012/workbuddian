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

export function mapSessionUpdate(update: AcpUpdate): StreamChunk | null {    switch (update.sessionUpdate) {
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
            const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : undefined;
            return { type: 'tool', content: '', toolName, toolCallId, toolDetail: summarizeRawInput(update.rawInput) };
        }
        // usage/config 走旁路；info/checkpoint/commands/user echo 不进 UI；
        // tool_call_update 由 mapToolCallUpdate 处理（需要调用方的快照累积）
        default:
            return null;
    }
}

/**
 * tool_call_update 映射：snapshot 为该 toolCallId 的最新 rawInput 快照（调用方负责替换式累积）。
 * 流式中（无 status）出摘要 chunk；status:'completed' 出 JSON 快照 chunk 供 diff/撤销。
 */
export function mapToolCallUpdate(update: AcpUpdate, snapshot: unknown): StreamChunk | null {
    if (update.sessionUpdate !== 'tool_call_update') return null;
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!toolCallId) return null;
    const toolName = extractToolName(update);
    if (update.status === 'completed') {
        let toolDetail = '';
        try {
            toolDetail = JSON.stringify(snapshot) ?? '';
        } catch {
            // 循环引用等异常情况：留空，UI 只更新行文本
        }
        const chunk: StreamChunk = { type: 'tool', content: '', toolName, toolCallId, toolStatus: 'completed', toolDetail };
        const rawOutput = update.rawOutput as { type?: unknown; text?: unknown } | undefined;
        if (rawOutput?.type === 'text' && typeof rawOutput.text === 'string') {
            chunk.toolOutput = rawOutput.text;
        }
        return chunk;
    }
    return { type: 'tool', content: '', toolName, toolCallId, toolDetail: summarizeRawInput(snapshot) };
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
