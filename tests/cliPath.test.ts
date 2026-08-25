import { resolveHermesPath } from '../src/utils/cliPath';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
const existsSync = fs.existsSync as jest.Mock;

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
