import { resolveCodebuddyPath, resolveHermesPath } from '../src/utils/cliPath';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
const existsSync = fs.existsSync as jest.Mock;

/** 构造"脚本路径 → product.json 产品名"的读取 mock（product.json 位于脚本的上一级目录） */
function productReader(entries: Array<[script: string, productName: string]>): (p: string) => string {
    return (p: string) => {
        for (const [script, productName] of entries) {
            if (p === path.join(path.dirname(script), '..', 'product.json')) return JSON.stringify({ productName });
        }
        throw new Error('not a known CLI');
    };
}

describe('CodeBuddy CLI discovery', () => {
    const originalEnv = process.env;
    const originalPlatform = process.platform;
    beforeEach(() => jest.resetAllMocks());
    afterEach(() => {
        process.env = originalEnv;
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it.each(['darwin', 'win32'])('prefers official CodeBuddy CLI and keeps explicit paths on %s', (platform) => {
        Object.defineProperty(process, 'platform', { value: platform });
        process.env = { HOME: '/fake', APPDATA: '/fake/appdata', LOCALAPPDATA: '/fake/local', PATH: '' };
        const standalone = platform === 'win32' ? '/fake/appdata/npm/codebuddy.cmd' : '/fake/.local/bin/codebuddy';
        const bundled = platform === 'win32'
            ? '/fake/local/Programs/WorkBuddy/Resources/app.asar.unpacked/cli/bin/codebuddy.exe'
            : '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p);
        (fs.readFileSync as unknown as jest.Mock).mockImplementation(productReader([
            [standalone, 'CodeBuddy'],
            [bundled, 'WorkBuddy'],
        ]));
        existsSync.mockImplementation((p) => p === standalone || p === bundled);
        // 官方 CLI 优先；显式路径永远原样返回
        expect(resolveCodebuddyPath('')).toBe(standalone);
        expect(resolveCodebuddyPath(standalone)).toBe(standalone);
        expect(resolveCodebuddyPath(bundled)).toBe(bundled);
        // 官方 CLI 不存在时回退 WorkBuddy 内置 CLI
        existsSync.mockImplementation((p) => p === bundled);
        expect(resolveCodebuddyPath('')).toBe(bundled);
        // CODEBUDDY_PATH 显式指定时优先于自动发现
        process.env.CODEBUDDY_PATH = bundled;
        expect(resolveCodebuddyPath('')).toBe(bundled);
    });

    it.each(['darwin', 'win32'])('finds official CLI on PATH before the bundled one on %s', (platform) => {
        Object.defineProperty(process, 'platform', { value: platform });
        const executable = platform === 'win32' ? 'codebuddy.cmd' : 'codebuddy';
        const official = path.join('/custom/npm/bin', executable);
        const bundled = path.join('/custom/workbuddy/bin', executable);
        process.env = {
            HOME: '/fake',
            PATH: ['/custom/npm/bin', '/custom/workbuddy/bin'].join(platform === 'win32' ? ';' : ':'),
        };
        existsSync.mockImplementation((p) => p === official || p === bundled);
        (fs.statSync as jest.Mock).mockImplementation((p) => ({ isFile: () => p === official || p === bundled }));
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p);
        (fs.readFileSync as unknown as jest.Mock).mockImplementation(productReader([
            [official, 'CodeBuddy'],
            [bundled, 'WorkBuddy'],
        ]));
        expect(resolveCodebuddyPath('')).toBe(official);
        // 官方的 product.json 不可识别时回退 bundled
        (fs.readFileSync as unknown as jest.Mock).mockImplementation(productReader([[bundled, 'WorkBuddy']]));
        expect(resolveCodebuddyPath('')).toBe(bundled);
    });

    it.each([
        { productName: 'CodeBuddy' },
        { productName: 'WorkBuddy' },
        { productName: 'WorkBuddy AI' },
        { authentication: { id: 'workbuddy-desktop' } },
        { authentication: { id: 'workbuddy-desktop-ai' } },
        { authentication: { id: 'Tencent-Cloud.coding-copilot' } },
    ].flatMap((product) => ['custom install', 'PATH'].map((source) => [source, product] as const)))('discovers a known CLI product from %s using %j', (source, product) => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const script = path.join('/custom/vendor', 'bin', 'codebuddy.cmd');
        process.env = {
            HOME: '/fake',
            PATH: source === 'PATH' ? '/custom/vendor/bin' : '',
            npm_config_prefix: source === 'custom install' ? '/custom/vendor' : '',
        };
        existsSync.mockImplementation((p) => p === script);
        (fs.statSync as jest.Mock).mockImplementation((p) => ({ isFile: () => p === script }));
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p);
        (fs.readFileSync as unknown as jest.Mock).mockImplementation((p) => {
            if (p === path.join('/custom/vendor', 'product.json')) return JSON.stringify(product);
            throw new Error('not a known CLI');
        });
        // 自动候选中的 npm 前缀采用无扩展名入口；PATH 则优先 Windows 包装器。
        if (source === 'custom install') {
            const entry = path.join('/custom/vendor', 'bin', 'codebuddy');
            existsSync.mockImplementation((p) => p === entry);
            expect(resolveCodebuddyPath('')).toBe(entry);
        } else expect(resolveCodebuddyPath('')).toBe(script);
    });

    it.each([
        { productName: 'WorkBuddy AI beta' },
        { productName: 'workbuddy' },
        { authentication: { id: 'workbuddy-desktop-ai-other' } },
    ])('does not automatically select unrelated or prefix-only metadata %j', (product) => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        process.env = { HOME: '/fake', PATH: '/custom/vendor/bin' };
        const bundled = path.join('/custom/vendor', 'bin', 'codebuddy.cmd');
        existsSync.mockImplementation((p) => p === bundled);
        (fs.statSync as jest.Mock).mockImplementation((p) => ({ isFile: () => p === bundled }));
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p);
        (fs.readFileSync as unknown as jest.Mock).mockReturnValue(JSON.stringify(product));
        expect(resolveCodebuddyPath('')).toBe('');
    });

    it('detects WorkBuddy installed in Program Files (x86) on another drive', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        process.env = { USERPROFILE: 'C:\\Users\\fake', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', PATH: '' };
        const bundled = path.join('D:\\Program Files (x86)', 'WorkBuddy', 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
        existsSync.mockImplementation((p) => p === bundled);
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p);
        expect(resolveCodebuddyPath('')).toBe(bundled);
    });
});

describe('resolveHermesPath', () => {
    const HOME = process.platform === 'win32' ? 'C:\\Users\\fake' : '/home/fake';
    let savedHome: string | undefined;
    let savedUserProfile: string | undefined;

    beforeEach(() => {
        existsSync.mockReset().mockReturnValue(false);
        savedHome = process.env.HOME;
        savedUserProfile = process.env.USERPROFILE;
        process.env.HOME = HOME;
        delete process.env.USERPROFILE;
    });
    afterEach(() => {
        if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
        if (savedUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUserProfile;
    });

    it('自定义覆盖原样返回（trim，不校验存在性）', () => {
        expect(resolveHermesPath('  /opt/hermes/bin/hermes ')).toBe('/opt/hermes/bin/hermes');
    });
    it('命中 ~/.local/bin/hermes', () => {
        const hit = path.join(HOME, '.local', 'bin', process.platform === 'win32' ? 'hermes.exe' : 'hermes');
        existsSync.mockImplementation((p) => p === hit);
        expect(resolveHermesPath('')).toBe(hit);
    });
    it('~/.local/bin 未命中时命中 ~/.hermes/bin/hermes', () => {
        const hit = path.join(HOME, '.hermes', 'bin', process.platform === 'win32' ? 'hermes.exe' : 'hermes');
        existsSync.mockImplementation((p) => p === hit);
        expect(resolveHermesPath('')).toBe(hit);
    });
    it('全部未命中 → bare fallback hermes（交 PATH 解析）', () => {
        // statSync 被 jest.mock 打成 undefined：isFile 走 catch → PATH 探测安全落空
        expect(resolveHermesPath('')).toBe('hermes');
    });
});
