import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installedRuntime, workbuddyNativeArgs } from '../src/providers/codebuddy/workbuddyNative';

describe('WorkBuddy native Electron Node entry', () => {
    const script = 'C:\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy';
    it.each(['codebuddy.exe', 'codebuddy.cmd'])('passes the JS entry when discovery selected %s', wrapper => {
        expect(workbuddyNativeArgs(wrapper, ['--serve', '--agents', '{}'], script))
            .toEqual([script, '--serve', '--agents', '{}']);
    });
    it('does not pass the script twice for a regular Node CLI command', () => {
        expect(workbuddyNativeArgs(script, [script, '--serve'], script)).toEqual([script, '--serve']);
    });
    it('preserves a custom non-desktop CLI launch', () => {
        expect(workbuddyNativeArgs('/custom/cli', ['/custom/cli', '--serve'])).toEqual(['/custom/cli', '--serve']);
    });
});

describe('WorkBuddy Windows bundled runtime selection', () => {
    let root: string;
    let platform: PropertyDescriptor;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-native-runtime-'));
        platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
        fs.mkdirSync(path.join(root, 'Resources', 'app.asar.unpacked', 'cli', 'bin'), { recursive: true });
    });
    afterEach(() => {
        Object.defineProperty(process, 'platform', platform);
        fs.rmSync(root, { recursive: true, force: true });
    });
    it.each([
        ['WorkBuddy.exe', 'codebuddy.cmd'], ['WorkBuddy.exe', 'codebuddy.exe'],
        ['WorkBuddyAI.exe', 'codebuddy.cmd'], ['WorkBuddyAI.exe', 'codebuddy.exe'],
    ])('runs %s with the bundled JS instead of the %s wrapper', (exe, wrapper) => {
        const command = path.join(root, exe);
        const script = path.join(root, 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
        const scriptPath = path.join(path.dirname(script), wrapper);
        fs.writeFileSync(command, 'fixture runtime');
        fs.writeFileSync(script, 'fixture JS');
        fs.writeFileSync(scriptPath, 'fixture wrapper');
        const runtime = installedRuntime(scriptPath);
        expect(runtime).toEqual({ command, app: command, script });
        expect(workbuddyNativeArgs(scriptPath, ['--serve'], runtime?.script)).toEqual([script, '--serve']);
    });
    it('does not substitute an unknown executable for the explicitly selected wrapper', () => {
        const script = path.join(root, 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
        const scriptPath = path.join(path.dirname(script), 'codebuddy.cmd');
        fs.writeFileSync(path.join(root, 'Other.exe'), 'fixture runtime');
        fs.writeFileSync(script, 'fixture JS');
        const runtime = installedRuntime(scriptPath);
        expect(runtime).toBeNull();
        expect(workbuddyNativeArgs(scriptPath, ['--serve'], runtime?.script)).toEqual(['--serve']);
    });
});
