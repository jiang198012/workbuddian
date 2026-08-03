export interface PermissionOptionData {
    optionId: string;
    kind: string;
    label: string;
}

export type PermissionDetail =
    | { kind: 'write'; path: string; lines: number }
    | { kind: 'edit'; path: string; oldText: string; newText: string }
    | { kind: 'bash'; command: string }
    | { kind: 'plan' }
    | { kind: 'generic'; summary: string };

export interface PermissionCardData {
    requestId: number;
    sessionId: string;
    toolName: string;
    detail: PermissionDetail;
    options: PermissionOptionData[];
    isPlanApproval: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function summarize(rawInput: Record<string, unknown>): string {
    try {
        const s = JSON.stringify(rawInput);
        return s.length > 200 ? s.slice(0, 197) + '...' : s;
    } catch {
        return '';
    }
}

function buildDetail(toolName: string, rawInput: Record<string, unknown>, isPlan: boolean): PermissionDetail {
    if (isPlan) return { kind: 'plan' };
    const path = typeof rawInput.file_path === 'string' ? rawInput.file_path
        : typeof rawInput.path === 'string' ? rawInput.path : '';
    if (toolName === 'Write' && typeof rawInput.content === 'string') {
        return { kind: 'write', path, lines: rawInput.content.split('\n').length };
    }
    if (toolName === 'Edit' || toolName === 'MultiEdit') {
        return {
            kind: 'edit', path,
            oldText: typeof rawInput.old_string === 'string' ? rawInput.old_string : '',
            newText: typeof rawInput.new_string === 'string' ? rawInput.new_string : '',
        };
    }
    if ((toolName === 'Bash' || toolName === 'Shell') && typeof rawInput.command === 'string') {
        return { kind: 'bash', command: rawInput.command };
    }
    return { kind: 'generic', summary: summarize(rawInput) };
}

/** session/request_permission 的 params → 批准卡数据；DeferExecuteTool（rawInput.toolName==='ExitPlanMode'）特化为计划批准 */
export function mapPermissionRequest(requestId: number, params: unknown): PermissionCardData {
    const p = asRecord(params);
    const toolCall = asRecord(p.toolCall);
    const meta = asRecord(toolCall._meta);
    const rawInput = asRecord(toolCall.rawInput);
    const metaName = meta['codebuddy.ai/toolName'];
    const toolName = typeof metaName === 'string' && metaName ? metaName
        : typeof rawInput.toolName === 'string' ? rawInput.toolName
        : typeof toolCall.title === 'string' ? toolCall.title : 'tool';
    const isPlan = toolName === 'DeferExecuteTool' || rawInput.toolName === 'ExitPlanMode';
    const options: PermissionOptionData[] = (Array.isArray(p.options) ? p.options : [])
        .map((o) => {
            const rec = asRecord(o);
            return {
                optionId: typeof rec.optionId === 'string' ? rec.optionId : '',
                kind: typeof rec.kind === 'string' ? rec.kind : '',
                label: typeof rec.name === 'string' ? rec.name : '',
            };
        })
        .filter((o) => o.optionId);
    return {
        requestId,
        sessionId: typeof p.sessionId === 'string' ? p.sessionId : '',
        toolName,
        detail: buildDetail(toolName, rawInput, isPlan),
        options,
        isPlanApproval: isPlan,
    };
}

/** client 应答线形：{"result":{"outcome":{"outcome":"selected","optionId":"..."}}}（traffic.jsonl 实证） */
export function buildPermissionResult(optionId: string): { outcome: { outcome: 'selected'; optionId: string } } {
    return { outcome: { outcome: 'selected', optionId } };
}

/** 按 kind 找 optionId；allow_once 精确匹配以免撞上 allow_always */
export function pickOptionId(
    options: PermissionOptionData[],
    kindPrefix: 'allow_once' | 'allow_always' | 'reject',
): string | undefined {
    const hit = options.find((o) => kindPrefix === 'allow_once'
        ? o.kind === 'allow_once'
        : o.kind.startsWith(kindPrefix));
    return hit?.optionId;
}
