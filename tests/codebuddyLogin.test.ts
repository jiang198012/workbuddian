import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { exchangeLoginToken, parseLoginServerOutput, waitForCodebuddyLogin } from '../src/shared/codebuddyLogin';

describe('CodeBuddy 一键登录', () => {
    it('从 CLI 输出解析 endpoint / Web UI（容忍 ANSI 颜色）', () => {
        const output = [
            '\x1b[36m',
            '  CodeBuddy Code HTTP Server',
            '',
            '  Endpoint    http://127.0.0.1:59995',
            '  Web UI      http://127.0.0.1:59995/?password=abc123',
            '',
            '  Password    abc123',
            '\x1b[0m',
        ].join('\n');
        expect(parseLoginServerOutput(output)).toEqual({
            endpoint: 'http://127.0.0.1:59995',
            webUiUrl: 'http://127.0.0.1:59995/?password=abc123',
        });
    });

    it('没有 Web UI（WorkBuddy 精简 CLI）时只返回 endpoint', () => {
        expect(parseLoginServerOutput('Endpoint http://127.0.0.1:58837\n')).toEqual({
            endpoint: 'http://127.0.0.1:58837',
        });
    });

    it('拒绝非回环地址，避免打开任意 URL', () => {
        expect(parseLoginServerOutput(
            'Endpoint http://evil.example:8080\nWeb UI http://evil.example:8080/?password=x\n',
        )).toEqual({});
    });

    it('轮询到登录成功即返回', async () => {
        let calls = 0;
        await waitForCodebuddyLogin('http://127.0.0.1:1', '/tmp', {
            intervalMs: 1,
            timeoutMs: 2_000,
            probe: async () => {
                calls += 1;
                return calls < 3 ? 'auth-required' : 'authenticated';
            },
        });
        expect(calls).toBe(3);
    });

    it('超时后报错', async () => {
        await expect(waitForCodebuddyLogin('http://127.0.0.1:1', '/tmp', {
            intervalMs: 1,
            timeoutMs: 10,
            probe: async () => 'auth-required',
        })).rejects.toThrow(/超时/);
    });

    it('取消后立即停止轮询', async () => {
        const controller = new AbortController();
        const pending = waitForCodebuddyLogin('http://127.0.0.1:1', '/tmp', {
            intervalMs: 50,
            timeoutMs: 10_000,
            signal: controller.signal,
            probe: async () => { controller.abort(); return 'auth-required'; },
        });
        await expect(pending).rejects.toThrow(/cancelled/);
    });
});

describe('exchangeLoginToken', () => {
    let server: Server;
    let endpoint = '';
    let received: { path?: string; headers?: Record<string, string | string[] | undefined>; body?: string } = {};
    let status = 200;
    let response: { success: boolean; token?: string } = { success: true, token: 'tok' };

    beforeEach(async () => {
        received = {};
        status = 200;
        response = { success: true, token: 'tok' };
        server = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                received = { path: req.url ?? undefined, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(response));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('用 Web UI 密码换取网关 Bearer token', async () => {
        await expect(exchangeLoginToken(endpoint, `${endpoint}/?password=p`)).resolves.toBe('tok');
        expect(received.path).toBe('/api/v1/auth/login');
        expect(received.headers?.['x-codebuddy-web-ui']).toBe('1');
        expect(JSON.parse(received.body ?? '{}')).toEqual({ password: 'p' });
    });

    it('Web UI 没有 password 参数时返回空 token（auth none 场景）', async () => {
        await expect(exchangeLoginToken(endpoint, `${endpoint}/`)).resolves.toBe('');
    });

    it('密码错误时报错', async () => {
        status = 401;
        response = { success: false };
        await expect(exchangeLoginToken(endpoint, `${endpoint}/?password=bad`))
            .rejects.toThrow(/鉴权失败/);
    });
});
