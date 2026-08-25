import type { UsageInfo } from '../../types';
import { ACP_DEFAULT_PROFILE, type AcpBackendProfile } from './profile';

/** v1 契约 chunk：provider → view 的流式事件单元（引擎词表类型,各后端共用） */
export interface StreamChunk {
    type: 'thinking' | 'text' | 'tool' | 'error' | 'done';
    content: string;
    toolName?: string;
    toolDetail?: string;
    /** ACP 工具调用 id：同 id 的后续 chunk 就地更新同一行（乙方案） */
    toolCallId?: string;
    /** 工具终态信号：仅 completed 时出现,携带 JSON 快照 detail 供 diff/撤销 */
    toolStatus?: 'in_progress' | 'completed';
    /** completed 工具的原始输出（rawOutput.text）,目前用于 Bash 终端块 */
    toolOutput?: string;
    usage?: UsageInfo;
}


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
/**
 * 工具名判别顺序：① profile.normalizeToolCall 的机器名（hermes 取 rawInput.tool）→
 * ② profile.toolNameMetaKeys 命中的 _meta 键（codebuddy 的 codebuddy.ai/toolName）→ ③ title 兜底。
 */
export function extractToolName(
    toolCall: { title?: unknown; _meta?: unknown; [key: string]: unknown },
    profile: AcpBackendProfile = ACP_DEFAULT_PROFILE,
): string {
    const norm = profile.normalizeToolCall(toolCall);
    if (norm.toolName) return norm.toolName;
    const meta = toolCall._meta as Record<string, unknown> | undefined;
    for (const key of profile.toolNameMetaKeys) {
        const metaName = meta?.[key];
        if (typeof metaName === 'string' && metaName) return metaName;
    }
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

export function mapSessionUpdate(update: AcpUpdate, profile: AcpBackendProfile = ACP_DEFAULT_PROFILE): StreamChunk | null {
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
            const toolName = extractToolName(update, profile);
            const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : undefined;
            const rawInput = profile.normalizeToolCall(update).rawInput ?? update.rawInput;
            return { type: 'tool', content: '', toolName, toolCallId, toolDetail: summarizeRawInput(rawInput) };
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
export function mapToolCallUpdate(
    update: AcpUpdate,
    snapshot: unknown,
    profile: AcpBackendProfile = ACP_DEFAULT_PROFILE,
): StreamChunk | null {
    if (update.sessionUpdate !== 'tool_call_update') return null;
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!toolCallId) return null;
    const toolName = extractToolName(update, profile);
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

export function mapConfigUpdate(update: AcpUpdate): { mode?: string; model?: string; thoughtLevel?: string } | null {
    if (update.sessionUpdate === 'current_mode_update') {
        return typeof update.currentModeId === 'string' ? { mode: update.currentModeId } : null;
    }
    if (update.sessionUpdate === 'config_option_update') {
        const out: { mode?: string; model?: string; thoughtLevel?: string } = {};
        const options = Array.isArray(update.configOptions) ? update.configOptions : [];
        for (const opt of options as Array<{ id?: unknown; currentValue?: unknown }>) {
            if (opt.id === 'mode' && typeof opt.currentValue === 'string') out.mode = opt.currentValue;
            if (opt.id === 'model' && typeof opt.currentValue === 'string') out.model = opt.currentValue;
            if (opt.id === 'thought_level' && typeof opt.currentValue === 'string') out.thoughtLevel = opt.currentValue;
        }
        return Object.keys(out).length ? out : null;
    }
    return null;
}

/** session/load 回放事件的判别：_meta['codebuddy.ai'].mode === 'history'（实测于 user_message_chunk 回放）。
 * 引擎内已由 profile.isReplayUpdate 承接；本导出保留给测试与外部调用方。 */
export function isReplayUpdate(update: AcpUpdate): boolean {
    const meta = update._meta as Record<string, unknown> | undefined;
    const cb = meta?.['codebuddy.ai'] as { mode?: unknown } | undefined;
    return cb?.mode === 'history';
}
