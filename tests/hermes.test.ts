import { HermesHttpProvider } from '../src/providers/hermes/httpProvider';

// fetch mock:模拟 OpenAI SSE 流式响应
function sseResponse(chunks: string[]): Response {
    const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('');
    const body = `${lines}data: [DONE]\n\n`;
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('HermesHttpProvider (MVP)', () => {
    it('parses SSE stream into text chunks', async () => {
        const p = new HermesHttpProvider();
        p.setGateway('http://127.0.0.1:8642', 'test-key');
        globalThis.fetch = jest.fn().mockResolvedValue(sseResponse(['你好', '，世界'])) as unknown as typeof fetch;
        const out: string[] = [];
        for await (const chunk of p.sendMessage('k', 'hi')) {
            if (chunk.type === 'text') out.push(chunk.content);
        }
        expect(out).toEqual(['你好', '，世界']);
    });

    it('uses the per-conversation model override for a request', async () => {
        const p = new HermesHttpProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(sseResponse(['ok'])) as unknown as typeof fetch;
        for await (const _ of p.sendMessage('k', 'hi', undefined, undefined, undefined, undefined, undefined, { model: 'custom-model' })) { /* drain */ }
        const init = (globalThis.fetch as jest.Mock).mock.calls[0][1] as { body: string };
        expect(JSON.parse(init.body).model).toBe('custom-model');
    });

    it('throws on HTTP error', async () => {
        const p = new HermesHttpProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
        await expect((async () => { for await (const _ of p.sendMessage('k', 'x')) { /* drain */ } })()).rejects.toThrow('401');
    });

    it('cancel aborts in-flight request', async () => {
        const p = new HermesHttpProvider();
        // mock fetch 尊重 abort 信号:signal abort 时 reject
        globalThis.fetch = jest.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })) as unknown as typeof fetch;
        const gen = p.sendMessage('k', 'x');
        const first = gen.next();
        p.cancel();
        const r = await first;
        expect(r.value?.type).toBe('done'); // abort 后 yield done chunk 收尾
        expect((await gen.next()).done).toBe(true); // 完成生成器，执行 finally 清除超时器
    });

    it('lists models from the current provider instead of the first provider with models', async () => {
        const p = new HermesHttpProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
            model: 'deepseek-flash', provider: 'deepseek-hermes',
            providers: [
                { slug: 'copilot', is_current: false, authenticated: true, models: ['gpt-5.6-sol', 'claude-opus-5'] },
                { slug: 'deepseek', is_current: false, authenticated: true, models: ['deepseek-flash', 'deepseek-v4-pro'] },
                { slug: 'kimi-for-coding', is_current: false, authenticated: true, models: ['kimi-k3'] },
            ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
        await expect(p.listModels()).resolves.toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    });

    it('prefers is_current provider when the gateway exposes it', async () => {
        const p = new HermesHttpProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
            model: 'x', provider: '',
            providers: [
                { slug: 'copilot', is_current: false, models: ['gpt-5.6-sol'] },
                { slug: 'deepseek', is_current: true, models: ['deepseek-flash'] },
            ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
        await expect(p.listModels()).resolves.toEqual(['deepseek-flash']);
    });

    it('falls back to the top-level current model when no provider entry matches', async () => {
        const p = new HermesHttpProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
            model: 'deepseek-flash', provider: 'custom-profile',
            providers: [{ slug: 'copilot', is_current: false, models: ['gpt-5.6-sol'] }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
        await expect(p.listModels()).resolves.toEqual(['deepseek-flash']);
    });

    it('testConnection ok on 200', async () => {
        const p = new HermesHttpProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response('{"data":[]}', { status: 200 })) as unknown as typeof fetch;
        expect((await p.testConnection()).ok).toBe(true);
    });

    it('testConnection 401 reports key mismatch', async () => {
        const p = new HermesHttpProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 })) as unknown as typeof fetch;
        const r = await p.testConnection();
        expect(r.ok).toBe(false);
        expect(r.error).toContain('401');
    });
});
