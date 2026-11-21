import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

/**
 * 本插件自建 WorkBuddy worker 的 pid 记录。
 * 渲染进程被直接销毁（关窗、崩溃）时异步清理执行不到，worker 会成为孤儿；下次启动据此回收。
 */
const RECORD_NAME = /^workbuddian-worker-(\d+)\.json$/;
const recordPath = (dir: string, pid: number) => path.join(dir, `workbuddian-worker-${pid}.json`);

export interface WorkerProcessProbe {
    isAlive(pid: number): boolean;
    commandLine(pid: number): string | null;
    terminate(pid: number): void;
}

export function recordWorker(dir: string, pid: number, script: string): void {
    fs.writeFileSync(recordPath(dir, pid), JSON.stringify({ pid, script }), { mode: 0o600 });
}

export function forgetWorker(dir: string, pid: number): void {
    try { fs.unlinkSync(recordPath(dir, pid)); } catch { /* 已删除 */ }
}

/** 命令行须同时含记录的脚本、`--serve` 和 `--setting-sources none`，防止 pid 被复用后误杀。 */
export function isOwnWorker(commandLine: string | null, script: string): boolean {
    return !!commandLine && !!script && commandLine.includes(script)
        && /(?:^|\s)--serve(?:\s|$)/.test(commandLine)
        && /(?:^|\s)--setting-sources\s+none(?:\s|$)/.test(commandLine);
}

/** 终止仍存活且核实为本插件 worker 的残留进程；已退出、pid 被复用或无法核实时只删记录。 */
export function reapStaleWorkers(dir: string, inUse: ReadonlySet<number>, probe: WorkerProcessProbe = systemProbe): number[] {
    const reaped: number[] = [];
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return reaped; }
    for (const name of names) {
        const match = RECORD_NAME.exec(name);
        if (!match) continue;
        const pid = Number(match[1]);
        if (!Number.isSafeInteger(pid) || pid <= 0 || inUse.has(pid)) continue;
        let script = '';
        try {
            const record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
            if (record?.pid === pid && typeof record.script === 'string') script = record.script;
        } catch { /* 损坏记录直接删除 */ }
        if (script && pid !== process.pid && probe.isAlive(pid) && isOwnWorker(probe.commandLine(pid), script)) {
            try { probe.terminate(pid); reaped.push(pid); } catch { /* 已退出 */ }
        }
        forgetWorker(dir, pid);
    }
    return reaped;
}

const systemProbe: WorkerProcessProbe = {
    isAlive(pid) {
        try { process.kill(pid, 0); return true; } catch { return false; }
    },
    commandLine(pid) {
        try {
            const output = process.platform === 'win32'
                ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
                    { encoding: 'utf8', timeout: 5_000, windowsHide: true })
                : execFileSync('/bin/ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 5_000 });
            return output.trim() || null;
        } catch { return null; }
    },
    terminate(pid) { process.kill(pid, 'SIGTERM'); },
};
