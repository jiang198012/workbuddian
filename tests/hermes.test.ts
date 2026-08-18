import { HermesProvider } from '../src/providers/hermes';

// fetch mock:模拟 OpenAI SSE 流式响应
function sseResponse(chunks: string[]): Response {
    const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('');
    const body = `${lines}data: [DONE]\n\n`;
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('HermesProvider (MVP)', () => {
    it('parses SSE stream into text chunks', async () => {
        const p = new HermesProvider();
        p.setGateway('http://127.0.0.1:8642', 'test-key');
        globalThis.fetch = jest.fn().mockResolvedValue(sseResponse(['你好', '，世界'])) as unknown as typeof fetch;
        const out: string[] = [];
        for await (const chunk of p.sendMessage('k', 'hi')) {
            if (chunk.type === 'text') out.push(chunk.content);
        }
        expect(out).toEqual(['你好', '，世界']);
    });

    it('throws on HTTP error', async () => {
        const p = new HermesProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
        await expect((async () => { for await (const _ of p.sendMessage('k', 'x')) { /* drain */ } })()).rejects.toThrow('401');
    });

    it('cancel aborts in-flight request', async () => {
        const p = new HermesProvider();
        // mock fetch 尊重 abort 信号:signal abort 时 reject
        globalThis.fetch = jest.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })) as unknown as typeof fetch;
        const gen = p.sendMessage('k', 'x');
        const first = gen.next();
        p.cancel();
        const r = await first;
        expect(r.value?.type).toBe('done'); // abort 后 yield done chunk 收尾
    });

    it('testConnection ok on 200', async () => {
        const p = new HermesProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response('{"data":[]}', { status: 200 })) as unknown as typeof fetch;
        expect((await p.testConnection()).ok).toBe(true);
    });

    it('testConnection 401 reports key mismatch', async () => {
        const p = new HermesProvider();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 })) as unknown as typeof fetch;
        const r = await p.testConnection();
        expect(r.ok).toBe(false);
        expect(r.error).toContain('401');
    });
});
