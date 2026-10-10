import type { WorkbuddyBroker } from './workbuddyBroker';

const failure = 'WorkBuddy 原账号模型目录不可用，请检查宿主登录状态后重试；未发送用户消息。';
const variants = ['lite', 'builtin-lite', 'reasoning', 'vision', 'longContext', 'subagent'];
const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const numericFields = ['maxInputTokens', 'maxOutputTokens', 'maxAllowedSize', 'temperature', 'top_p', 'top_k', 'repetition_penalty'];
const booleanFields = ['supportsImages', 'supportsReasoning', 'supportsToolCall', 'onlyReasoning', 'disabledMultimodal', 'canDisableThinking'];

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(failure);
    return value as Record<string, unknown>;
}
function text(value: unknown, limit = 256): string {
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f]/.test(value)) throw new Error(failure);
    return value;
}
function modelId(value: unknown): string {
    const id = text(value, 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id)) throw new Error(failure);
    return id;
}
function number(value: unknown, positive = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) throw new Error(failure);
    return value;
}
function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error(failure);
    return value;
}
function nested(value: unknown): Record<string, unknown> {
    const result = object(value);
    if (JSON.stringify(result).length > 4096) throw new Error(failure);
    return result;
}
function definition(value: unknown): Record<string, unknown> {
    const source = object(value), result: Record<string, unknown> = { id: modelId(source.id), name: text(source.name) };
    if (source.vendor !== undefined) result.vendor = text(source.vendor);
    for (const field of numericFields) if (source[field] !== undefined) result[field] = number(source[field], field.startsWith('max'));
    for (const field of booleanFields) if (source[field] !== undefined) result[field] = boolean(source[field]);
    if (source.credits !== undefined) result.credits = typeof source.credits === 'number' ? number(source.credits) : text(source.credits, 64);
    if (source.reasoning !== undefined) {
        const sourceReasoning = nested(source.reasoning), reasoning: Record<string, unknown> = {};
        for (const field of ['effort', 'defaultEffort']) if (sourceReasoning[field] !== undefined) {
            const effort = text(sourceReasoning[field]);
            if (!efforts.includes(effort)) throw new Error(failure);
            reasoning[field] = effort;
        }
        if (sourceReasoning.summary !== undefined) reasoning.summary = text(sourceReasoning.summary, 64);
        if (sourceReasoning.canDisableThinking !== undefined) reasoning.canDisableThinking = boolean(sourceReasoning.canDisableThinking);
        if (sourceReasoning.supportedEfforts !== undefined) {
            const values = sourceReasoning.supportedEfforts;
            if (!Array.isArray(values) || values.length > efforts.length || values.some(value => !efforts.includes(value))) throw new Error(failure);
            reasoning.supportedEfforts = [...values];
        }
        result.reasoning = reasoning;
    }
    if (source.contextWindow !== undefined) {
        const sourceWindow = nested(source.contextWindow), window: Record<string, unknown> = {};
        if (sourceWindow.defaultLength !== undefined) window.defaultLength = number(sourceWindow.defaultLength, true);
        if (sourceWindow.supportedLengths !== undefined) {
            const values = sourceWindow.supportedLengths;
            if (!Array.isArray(values) || values.length > 16) throw new Error(failure);
            window.supportedLengths = values.map(value => number(value, true));
        }
        result.contextWindow = window;
    }
    if (source.relatedModels !== undefined) {
        const sourceRelated = nested(source.relatedModels), related: Record<string, unknown> = {};
        for (const variant of variants) if (sourceRelated[variant] !== undefined) related[variant] = modelId(sourceRelated[variant]);
        result.relatedModels = related;
    }
    return result;
}

/** 原账号只读目录进入官方 CLI；仅更新模型能力与主 agent 名单，保留安装包辅助配置。 */
export async function loadWorkbuddyModelConfig(
    broker: WorkbuddyBroker, product: { models?: unknown; agents?: unknown }, signal?: AbortSignal,
): Promise<{ models: Record<string, unknown>[]; agents: Record<string, unknown>[] }> {
    try {
        const response = await broker.requestFetch({ method: 'GET', path: '/console/enterprises/personal/models',
            headers: { Accept: 'application/json' } }, signal);
        if (response.status !== 200 || typeof response.body_b64 !== 'string' || response.body_b64.length > 1_048_576) throw new Error(failure);
        const bytes = Buffer.from(response.body_b64, 'base64');
        if (bytes.length > 655_360) throw new Error(failure);
        const root = object(JSON.parse(bytes.toString('utf8'))), data = object(root.data);
        if (root.code !== 0 || !Array.isArray(data.models) || data.models.length > 512 || !Array.isArray(data.agents)) throw new Error(failure);
        const accountCli = data.agents.map(object).find(agent => agent.name === 'cli');
        if (!accountCli || !Array.isArray(accountCli.models) || !accountCli.models.length || accountCli.models.length > 256) throw new Error(failure);
        const listedIds = accountCli.models.map(modelId), accountModels = new Map<string, Record<string, unknown>>();
        for (const value of data.models) {
            const source = object(value), id = modelId(source.id);
            if (accountModels.has(id)) throw new Error(failure);
            accountModels.set(id, source);
        }
        if (listedIds.some(id => !accountModels.has(id))) throw new Error(failure);
        const ids = listedIds.filter(id => accountModels.get(id)?.disabled !== true);
        if (!ids.length) throw new Error(failure);
        if (!Array.isArray(product.models) || !Array.isArray(product.agents)) throw new Error(failure);
        const models = new Map<string, Record<string, unknown>>((JSON.parse(JSON.stringify(product.models)) as unknown[])
            .map(value => { const model = object(value); return [modelId(model.id), model]; }));
        const agents = (JSON.parse(JSON.stringify(product.agents)) as unknown[]).map(object);
        const installedCli = agents.find(agent => agent.name === 'cli');
        if (!installedCli) throw new Error(failure);
        for (const [id, source] of accountModels) if (source.disabled !== true) models.set(id, { ...models.get(id), ...definition(source) });
        installedCli.models = ids;
        return { models: [...models.values()], agents };
    } catch {
        // 目录失败必须阻止启动；上游正文或异常可能含账号信息，不传播、不回退旧目录。
        throw new Error(failure);
    }
}
