import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { forgetWorker, isOwnWorker, reapStaleWorkers, recordWorker } from '../src/providers/codebuddy/workerRecords';

const SCRIPT = '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';
const OWN_COMMAND = `/Applications/WorkBuddy.app/Contents/MacOS/Electron ${SCRIPT} --serve --port 0 --host 127.0.0.1 --setting-sources none`;

describe('WorkBuddy worker 记录与残留回收', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-records-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    const deps = (alive: number[], commands: Record<number, string | null> = {}) => ({
        isAlive: jest.fn((pid: number) => alive.includes(pid)),
        commandLine: jest.fn((pid: number) => commands[pid] ?? null),
        terminate: jest.fn(),
    });
    const files = () => fs.readdirSync(dir).sort();

    it('记录写入与删除只作用于对应 pid', () => {
        recordWorker(dir, 101, SCRIPT);
        recordWorker(dir, 202, SCRIPT);
        expect(files()).toEqual(['workbuddian-worker-101.json', 'workbuddian-worker-202.json']);
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'workbuddian-worker-101.json'), 'utf8'))).toEqual({ pid: 101, script: SCRIPT });
        forgetWorker(dir, 101);
        forgetWorker(dir, 101);
        expect(files()).toEqual(['workbuddian-worker-202.json']);
    });

    it('终止仍存活且命令行一致的残留 worker，并删除记录', () => {
        recordWorker(dir, 101, SCRIPT);
        const d = deps([101], { 101: OWN_COMMAND });
        expect(reapStaleWorkers(dir, new Set(), d)).toEqual([101]);
        expect(d.terminate).toHaveBeenCalledWith(101);
        expect(files()).toEqual([]);
    });

    it('已退出的 worker 只删除记录，不查询命令行也不发信号', () => {
        recordWorker(dir, 101, SCRIPT);
        const d = deps([]);
        expect(reapStaleWorkers(dir, new Set(), d)).toEqual([]);
        expect(d.commandLine).not.toHaveBeenCalled();
        expect(d.terminate).not.toHaveBeenCalled();
        expect(files()).toEqual([]);
    });

    it('pid 已被其他进程复用或无法核实时不终止', () => {
        recordWorker(dir, 101, SCRIPT);
        recordWorker(dir, 202, SCRIPT);
        const d = deps([101, 202], { 101: '/usr/bin/vim notes.md', 202: null });
        expect(reapStaleWorkers(dir, new Set(), d)).toEqual([]);
        expect(d.terminate).not.toHaveBeenCalled();
        expect(files()).toEqual([]);
    });

    it('跳过本轮仍在使用的 worker，忽略无关和损坏的文件', () => {
        recordWorker(dir, 101, SCRIPT);
        fs.writeFileSync(path.join(dir, 'workbuddian-worker-303.json'), '{broken');
        fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
        const d = deps([101, 303], { 101: OWN_COMMAND, 303: OWN_COMMAND });
        expect(reapStaleWorkers(dir, new Set([101]), d)).toEqual([]);
        expect(d.terminate).not.toHaveBeenCalled();
        expect(files()).toEqual(['settings.json', 'workbuddian-worker-101.json']);
    });

    it('目录不存在时什么也不做', () => {
        expect(reapStaleWorkers(path.join(dir, 'missing'), new Set(), deps([]))).toEqual([]);
    });

    it('命令行必须同时包含记录的脚本、--serve 和 --setting-sources none', () => {
        expect(isOwnWorker(OWN_COMMAND, SCRIPT)).toBe(true);
        expect(isOwnWorker(`"C:\\Program Files\\WorkBuddy\\WorkBuddy.exe" "C:\\wb\\codebuddy.js" --serve --port 0 --host 127.0.0.1 --setting-sources none`,
            'C:\\wb\\codebuddy.js')).toBe(true);
        expect(isOwnWorker(`/Applications/WorkBuddy.app/Contents/MacOS/Electron ${SCRIPT} --serve`, SCRIPT)).toBe(false);
        expect(isOwnWorker(`/usr/bin/node /other/cli --serve --setting-sources none`, SCRIPT)).toBe(false);
        expect(isOwnWorker(`/x ${SCRIPT} --server --setting-sources none`, SCRIPT)).toBe(false);
        expect(isOwnWorker(null, SCRIPT)).toBe(false);
    });
});
