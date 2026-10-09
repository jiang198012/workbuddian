import { resolveCodebuddyPath, resolveHermesPath } from '../src/utils/cliPath';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
const existsSync = fs.existsSync as jest.Mock;

describe('WorkBuddy account-preserving discovery (#10)', () => {
    const originalEnv = process.env;
    const originalPlatform = process.platform;
    beforeEach(() => jest.resetAllMocks());
    afterEach(() => {
        process.env = originalEnv;
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it.each(['darwin', 'win32'])('keeps WorkBuddy on %s and only uses another CLI when explicitly selected', (platform) => {
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p);
        Object.defineProperty(process, 'platform', { value: platform });
        process.env = { HOME: '/fake', APPDATA: '/fake/appdata', LOCALAPPDATA: '/fake/local', PATH: '' };
        const standalone = platform === 'win32' ? '/fake/appdata/npm/codebuddy.cmd' : '/fake/.local/bin/codebuddy';
        const bundled = platform === 'win32'
            ? '/fake/local/Programs/WorkBuddy/Resources/app.asar.unpacked/cli/bin/codebuddy.exe'
            : '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';
        existsSync.mockImplementation((p) => p === standalone || p === bundled);
        expect(resolveCodebuddyPath('')).toBe(bundled);
        expect(resolveCodebuddyPath(standalone)).toBe(standalone);
        expect(resolveCodebuddyPath(bundled)).toBe(bundled);
        existsSync.mockImplementation((p) => p === standalone);
        expect(resolveCodebuddyPath('')).toBe('');
        expect(resolveCodebuddyPath(bundled)).toBe(bundled);
        process.env.CODEBUDDY_PATH = bundled;
        expect(resolveCodebuddyPath('')).toBe(bundled);
    });

    it.each(['darwin', 'win32'])('finds WorkBuddy later on PATH without selecting an unrelated CLI on %s', (platform) => {
        Object.defineProperty(process, 'platform', { value: platform });
        const executable = platform === 'win32' ? 'codebuddy.cmd' : 'codebuddy';
        const bundled = path.join('/custom/workbuddy', executable);
        const standalone = path.join('/custom/npm', executable);
        process.env = { HOME: '/fake', PATH: ['/custom/npm', '/custom/workbuddy'].join(platform === 'win32' ? ';' : ':') };
        existsSync.mockImplementation((p) => p === bundled || p === standalone);
        (fs.statSync as jest.Mock).mockImplementation((p) => ({ isFile: () => p === bundled || p === standalone }));
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p === bundled
            ? '/WorkBuddy/Resources/app.asar.unpacked/cli/bin/codebuddy' : p);
        expect(resolveCodebuddyPath('')).toBe(bundled);
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p === bundled
            ? '/OtherProduct/Resources/app.asar.unpacked/cli/bin/codebuddy' : p);
        expect(resolveCodebuddyPath('')).toBe('');
    });

    it.each([
        { productName: 'WorkBuddy' },
        { productName: 'WorkBuddy AI' },
        { authentication: { id: 'workbuddy-desktop' } },
        { authentication: { id: 'workbuddy-desktop-ai' } },
    ].flatMap((product) => ['custom install', 'PATH'].map((source) => [source, product] as const)))('discovers an exact known product from %s using %j', (source, product) => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const bundled = path.join('/custom/vendor', 'bin', 'codebuddy.cmd');
        process.env = { HOME: '/fake', PATH: source === 'PATH' ? '/custom/vendor/bin' : '', npm_config_prefix: source === 'custom install' ? '/custom/vendor' : '' };
        existsSync.mockImplementation((p) => p === bundled);
        (fs.statSync as jest.Mock).mockImplementation((p) => ({ isFile: () => p === bundled }));
        (fs.realpathSync as unknown as jest.Mock).mockImplementation((p) => p);
        (fs.readFileSync as jest.Mock).mockImplementation((p) => {
            if (p === path.join('/custom/vendor', 'product.json')) return JSON.stringify(product);
            throw new Error('not a WorkBuddy installation');
        });
        // 自动候选中的 npm 前缀采用无扩展名入口；PATH 则优先 Windows 包装器。
        if (source === 'custom install') {
            const script = path.join('/custom/vendor', 'bin', 'codebuddy');
            existsSync.mockImplementation((p) => p === script);
            expect(resolveCodebuddyPath('')).toBe(script);
        } else expect(resolveCodebuddyPath('')).toBe(bundled);
    });

    it.each([
        { productName: 'CodeBuddy' },
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
        (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(product));
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
