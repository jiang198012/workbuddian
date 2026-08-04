import type { AcpClient, AcpClientEvents } from '../../src/providers/codebuddy/acp/client';
import type { StreamChunk } from '../../src/providers/codebuddy';

/**
 * fake AcpClient harness：provider 层测试共享。
 * 调用方需先 `jest.mock('../src/providers/codebuddy/acp/client', ...)`（partial mock，AcpClient 换 jest.fn），
 * 再把 mock 后的类传进来。
 */
export type FakeRequest = jest.Mock<Promise<unknown>, [string, Record<string, unknown>]>;

export interface FakeClientKit {
    fake: {
        setCodebuddyPath: jest.Mock; setNodePath: jest.Mock; getScriptPath: jest.Mock;
        running: boolean; ensureStarted: jest.Mock; request: FakeRequest;
        enqueuePrompt: jest.Mock; rawRequest: jest.Mock;
        notify: jest.Mock; respond: jest.Mock; dispose: jest.Mock; setExtraArgs: jest.Mock;
    };
    events: () => AcpClientEvents;
    newSessionCount: () => number;
}

export function makeFakeClient(MockAcpClient: jest.MockedClass<typeof AcpClient>): FakeClientKit {
    let captured: AcpClientEvents | null = null;
    let newCount = 0;
    const fake = {
        setCodebuddyPath: jest.fn(),
        setNodePath: jest.fn(),
        setExtraArgs: jest.fn(),
        getScriptPath: jest.fn(() => '/fake/codebuddy'),
        running: true,
        ensureStarted: jest.fn(async () => {}),
        request: jest.fn(async (method: string, _params: Record<string, unknown>) => {
            if (method === 'session/new') return { sessionId: `acp-${++newCount}` };
            if (method === 'session/load') throw new Error('session not found');
            if (method === 'session/prompt') return { stopReason: 'end_turn' };
            return {};
        }) as FakeRequest,
        // 串行队列的测试替身：立即执行（不经队列），rawRequest 转发到 request mock 以套用同一套 stub
        enqueuePrompt: jest.fn(async (fn: () => Promise<unknown>) => fn()),
        rawRequest: jest.fn(),
        notify: jest.fn(),
        respond: jest.fn(),
        dispose: jest.fn(),
    };
    (fake.rawRequest as jest.Mock).mockImplementation((method: string, params: Record<string, unknown>) => fake.request(method, params));
    MockAcpClient.mockImplementation((events: AcpClientEvents) => {
        captured = events;
        return fake as unknown as AcpClient;
    });
    return { fake, events: () => captured!, newSessionCount: () => newCount };
}

export function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

export async function flush(ticks = 5): Promise<void> {
    for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
}

export async function consume(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
    const chunks: StreamChunk[] = [];
    for await (const chunk of gen) chunks.push(chunk);
    return chunks;
}

export const PERMISSION_PARAMS = {
    sessionId: 'acp-1',
    options: [
        { kind: 'allow_always', name: 'Always Allow', optionId: 'allow_always' },
        { kind: 'allow_once', name: 'Allow', optionId: 'allow' },
        { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
    ],
    toolCall: { toolCallId: 'c1', rawInput: { file_path: 'a.md', content: 'x' }, _meta: { 'codebuddy.ai/toolName': 'Write' } },
};
