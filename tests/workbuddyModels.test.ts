import { loadWorkbuddyModelConfig } from '../src/providers/codebuddy/workbuddyModels';
import type { BrokerFetchParams, WorkbuddyBroker } from '../src/providers/codebuddy/workbuddyBroker';

const failure = 'WorkBuddy 原账号模型目录不可用，请检查宿主登录状态后重试；未发送用户消息。';
const product = () => ({
    models: [
        { id: 'old-primary', name: 'Old primary', supportsImages: false },
        { id: 'helper-lite', name: 'Helper', maxOutputTokens: 2048, relatedModels: { lite: 'helper-lite' } },
    ],
    agents: [
        { name: 'cli', models: ['old-primary'], tags: ['cli', 'default', 'model:craft'],
            tools: ['Read'], instructions: 'installed-prompt', modelTags: ['craft'] },
        { name: 'Explore', models: ['lite'], tags: ['cli', 'sub-agent'], tools: ['Search'] },
    ],
});
const catalog = () => ({ code: 0, data: {
    models: [
        { id: 'old-primary', name: 'Current primary', maxInputTokens: 100000, supportsImages: true },
        { id: 'future-model-77', name: 'Future model', vendor: 'vendor', maxInputTokens: 200000,
            maxOutputTokens: 16000, maxAllowedSize: 4096, temperature: 0, top_p: 0.9, top_k: 40,
            repetition_penalty: 1, credits: 'x0.5', supportsImages: true, supportsReasoning: true,
            supportsToolCall: true, onlyReasoning: false, disabledMultimodal: false, canDisableThinking: true,
            reasoning: { effort: 'high', defaultEffort: 'medium', summary: 'auto',
                supportedEfforts: ['low', 'medium', 'high'], canDisableThinking: true },
            contextWindow: { supportedLengths: [100000, 200000], defaultLength: 100000 },
            relatedModels: { lite: 'helper-lite', reasoning: 'future-model-77' } },
    ],
    agents: [{ name: 'cli', models: ['future-model-77', 'old-primary'], tags: ['cli', 'default'] }],
} });

function brokerFor(body: unknown, status = 200) {
    const calls: { params: BrokerFetchParams; signal?: AbortSignal }[] = [];
    const broker: WorkbuddyBroker = {
        async requestFetch(params, signal) {
            calls.push({ params, signal });
            return { status, headers: { 'content-type': 'application/json' },
                body_b64: Buffer.from(JSON.stringify(body)).toString('base64') };
        },
        dispose() {},
    };
    return { broker, calls };
}

describe('WorkBuddy 原账号模型目录配置', () => {
    it('只通过原账号 broker 读取目录，并保序更新完整主 agent', async () => {
        const { broker, calls } = brokerFor(catalog());
        const signal = new AbortController().signal;
        const result = await loadWorkbuddyModelConfig(broker, product(), signal);
        expect(calls).toEqual([{ params: { method: 'GET', path: '/console/enterprises/personal/models',
            headers: { Accept: 'application/json' } }, signal }]);
        expect(result.agents).toEqual([
            { name: 'cli', models: ['future-model-77', 'old-primary'], tags: ['cli', 'default', 'model:craft'],
                tools: ['Read'], instructions: 'installed-prompt', modelTags: ['craft'] },
            { name: 'Explore', models: ['lite'], tags: ['cli', 'sub-agent'], tools: ['Search'] },
        ]);
    });

    it('保留辅助模型，同时覆盖旧能力并支持未随安装包发布的新 ID', async () => {
        const { broker } = brokerFor(catalog());
        const result = await loadWorkbuddyModelConfig(broker, product());
        expect(result.models[0]).toEqual({ id: 'old-primary', name: 'Current primary', maxInputTokens: 100000, supportsImages: true });
        expect(result.models[1]).toEqual({ id: 'helper-lite', name: 'Helper', maxOutputTokens: 2048, relatedModels: { lite: 'helper-lite' } });
        expect(result.models[2]).toEqual({ id: 'future-model-77', name: 'Future model', vendor: 'vendor',
            maxInputTokens: 200000, maxOutputTokens: 16000, maxAllowedSize: 4096,
            temperature: 0, top_p: 0.9, top_k: 40, repetition_penalty: 1, credits: 'x0.5',
            supportsImages: true, supportsReasoning: true, supportsToolCall: true, onlyReasoning: false,
            disabledMultimodal: false, canDisableThinking: true,
            reasoning: { effort: 'high', defaultEffort: 'medium', summary: 'auto',
                supportedEfforts: ['low', 'medium', 'high'], canDisableThinking: true },
            contextWindow: { supportedLengths: [100000, 200000], defaultLength: 100000 },
            relatedModels: { lite: 'helper-lite', reasoning: 'future-model-77' } });
    });

    it('丢弃上游路由、凭据、指令和自动追加目录标记，包括嵌套危险字段', async () => {
        const response: any = catalog();
        Object.assign(response.data.models[1], { tags: ['chat', 'custom'], aliases: ['auto'],
            endpoint: 'https://untrusted.invalid', url: 'https://untrusted.invalid', apiKey: 'fixture-secret',
            authentication: { token: 'fixture-secret' }, headers: { Authorization: 'fixture-secret' },
            commands: ['inject'], instructions: 'inject', reasoning: { effort: 'high', headers: { Authorization: 'fixture-secret' } },
            contextWindow: { defaultLength: 100000, endpoint: 'https://untrusted.invalid' },
            relatedModels: { lite: 'helper-lite', commands: 'inject' } });
        const result = await loadWorkbuddyModelConfig(brokerFor(response).broker, product());
        expect(result.models[2]).toEqual(expect.objectContaining({ id: 'future-model-77',
            reasoning: { effort: 'high' }, contextWindow: { defaultLength: 100000 }, relatedModels: { lite: 'helper-lite' } }));
        expect(JSON.stringify(result.models)).not.toMatch(/fixture-secret|untrusted|inject|"tags"|"aliases"/);
    });

    it('返回独立配置副本，调用方修改不污染安装包对象', async () => {
        const installed = product();
        const result = await loadWorkbuddyModelConfig(brokerFor(catalog()).broker, installed);
        (result.agents[1].models as string[]).push('changed');
        (result.agents[0].tools as string[]).push('changed');
        (result.models[1].relatedModels as Record<string, string>).lite = 'changed';
        expect(installed.agents[0].models).toEqual(['old-primary']);
        expect(installed.agents[0].tools).toEqual(['Read']);
        expect(installed.agents[1].models).toEqual(['lite']);
        expect(installed.models[1].relatedModels).toEqual({ lite: 'helper-lite' });
    });

    it('过滤目录中的停用模型，仍保留其它可用模型及上游顺序', async () => {
        const response: any = catalog();
        response.data.models.push({ id: 'off', name: 'Off', disabled: true });
        response.data.agents[0].models = ['off', 'future-model-77', 'old-primary'];
        const result = await loadWorkbuddyModelConfig(brokerFor(response).broker, product());
        expect(result.agents[0].models).toEqual(['future-model-77', 'old-primary']);
        expect(result.models.map(model => model.id)).toEqual(['old-primary', 'helper-lite', 'future-model-77']);
        expect(result.agents[1].models).toEqual(['lite']);
    });

    it('过滤停用项时仍拒绝其它缺少定义的目录 ID', async () => {
        const response: any = catalog();
        response.data.models.push({ id: 'off', name: 'Off', disabled: true });
        response.data.agents[0].models = ['off', 'missing', 'old-primary'];
        await expect(loadWorkbuddyModelConfig(brokerFor(response).broker, product())).rejects.toThrow(failure);
    });

    it.each([
        ['非成功业务码', { code: 1, data: catalog().data }],
        ['缺少业务码', { data: catalog().data }],
        ['缺少 data.models', { code: 0, data: { agents: catalog().data.agents } }],
        ['缺少 cli agent', { code: 0, data: { models: catalog().data.models, agents: [] } }],
        ['空主目录', { code: 0, data: { models: catalog().data.models, agents: [{ name: 'cli', models: [] }] } }],
        ['目录 ID 缺少定义', { code: 0, data: { models: [], agents: catalog().data.agents } }],
        ['目录模型全部停用', { code: 0, data: { models: [{ id: 'off', name: 'Off', disabled: true }], agents: [{ name: 'cli', models: ['off'] }] } }],
    ])('%s 时明确失败，不返回安装包旧目录', async (_name, body) => {
        await expect(loadWorkbuddyModelConfig(brokerFor(body).broker, product())).rejects.toThrow(failure);
    });

    it.each([401, 403, 500])('HTTP %s 时不读取成功形状或回退旧目录', async status => {
        await expect(loadWorkbuddyModelConfig(brokerFor(catalog(), status).broker, product())).rejects.toThrow(failure);
    });

    it.each([
        ['id', '../escape'], ['name', ''], ['vendor', 4], ['maxInputTokens', -1], ['maxOutputTokens', 'large'],
        ['temperature', '0'], ['supportsImages', 'true'], ['credits', { secret: 'fixture-secret' }],
        ['reasoning', { supportedEfforts: ['fixture-secret'] }], ['contextWindow', { supportedLengths: [0] }],
        ['relatedModels', { lite: '../escape' }],
    ])('拒绝 %s 的无效能力值', async (field, value) => {
        const response: any = catalog(); response.data.models[1][field] = value;
        await expect(loadWorkbuddyModelConfig(brokerFor(response).broker, product())).rejects.toThrow(failure);
    });

    it('不传播 broker 原始异常或响应正文', async () => {
        const broker: WorkbuddyBroker = { async requestFetch() { throw new Error('fixture-secret'); }, dispose() {} };
        await expect(loadWorkbuddyModelConfig(broker, product())).rejects.toThrow(failure);
        const malformed: WorkbuddyBroker = { async requestFetch() { return { status: 200, headers: {},
            body_b64: Buffer.from('fixture-secret malformed JSON').toString('base64') }; }, dispose() {} };
        await expect(loadWorkbuddyModelConfig(malformed, product())).rejects.toThrow(failure);
    });
});
