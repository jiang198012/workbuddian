import * as path from 'path';
import * as fs from 'fs';
import { spawn, type SpawnOptions } from 'child_process';
import { bbLog } from '../shared/logBuffer';

/** 本模块只做一件事：在不同安装方式（WorkBuddy 桌面版 / npm 全局 / nvm / volta / 手工目录）下找到 node 与 codebuddy 的真实路径 */

// 注意：platform/HOME 必须调用期读取——测试会在运行时 mock process.platform 与 process.env
const isWin = () => process.platform === 'win32';
const home = () => process.env.HOME || process.env.USERPROFILE || '';
const nodeBinName = () => (isWin() ? 'node.exe' : 'node');

function env(name: string): string {
    return process.env[name] || '';
}

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/** 候选列表里第一个真实存在的文件；都不存在返回 null */
function firstHit(candidates: string[]): string | null {
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

/** 在系统 PATH 里找可执行文件（Windows 依次试 .exe/.cmd/无扩展名） */
function findOnPath(names: string[]): string | null {
    const sep = isWin() ? ';' : ':';
    for (const dir of (env('PATH')).split(sep)) {
        if (!dir) continue;
        for (const name of names) {
            const p = path.join(dir, name);
            if (isFile(p)) return p;
        }
    }
    return null;
}

// ===== Node.js 可执行文件查找 =====

function nodeCandidates(): string[] {
    if (!isWin()) {
        return [
            path.join(home(), '.local', 'bin'),
            path.join(home(), '.npm-global', 'bin'),
            path.join(home(), '.volta', 'bin'),
            path.join(home(), 'bin'),
            '/usr/local/bin',
            '/opt/homebrew/bin',
            env('NVM_BIN'),
        ].map((dir) => dir && path.join(dir, nodeBinName()));
    }

    const dirs = [path.dirname(process.execPath)];
    const appData = env('APPDATA');
    if (appData) dirs.push(appData, path.join(appData, 'npm'));
    const pf = env('ProgramFiles') || 'C:\\Program Files';
    const pf86 = env('ProgramFiles(x86)') || 'C:\\Program Files (x86)';
    dirs.push(path.join(pf, 'nodejs'), path.join(pf86, 'nodejs'));
    const lad = env('LOCALAPPDATA');
    if (lad) dirs.push(path.join(lad, 'Programs', 'nodejs'));
    if (env('NVM_SYMLINK')) dirs.push(env('NVM_SYMLINK'));

    // WorkBuddy 自带 Node（按版本目录扫描）
    if (home()) {
        const versionsDir = path.join(home(), '.workbuddy', 'binaries', 'node', 'versions');
        try {
            for (const v of fs.readdirSync(versionsDir)) dirs.push(path.join(versionsDir, v));
        } catch { /* 目录不存在属正常 */ }
    }
    // 非 C 盘安装（跳过与 ProgramFiles 同根的盘）
    for (const drive of ['C:', 'D:', 'E:']) {
        if (`${drive}\\` !== path.parse(pf).root.toUpperCase()) {
            dirs.push(path.join(`${drive}\\Program Files`, 'nodejs'));
        }
    }
    return dirs.map((dir) => dir && path.join(dir, nodeBinName()));
}

export function findNodeExecutable(): string | null {
    const hit = firstHit(nodeCandidates().filter(isFile));
    if (hit) {
        bbLog('[WB] found node at:', hit);
        return hit;
    }
    bbLog("[WB] WARNING: node not found in any search path, falling back to 'node'");
    return 'node';
}

// ===== CodeBuddy CLI 路径查找 =====

const WB_CLI_REL = ['Resources', 'app.asar.unpacked', 'cli', 'bin'] as const;

function codebuddyCandidates(): string[] {
    if (!isWin()) {
        return [
            '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
            path.join(home(), 'Applications', 'WorkBuddy.app', 'Contents', ...WB_CLI_REL, 'codebuddy'),
            path.join(home(), '.local', 'bin', 'codebuddy'),
            path.join(home(), '.npm-global', 'bin', 'codebuddy'),
            path.join(home(), '.volta', 'bin', 'codebuddy'),
            path.join(home(), 'bin', 'codebuddy'),
            '/usr/local/bin/codebuddy',
            '/opt/homebrew/bin/codebuddy',
        ];
    }

    const lad = env('LOCALAPPDATA');
    const appData = env('APPDATA');
    const pf = env('ProgramFiles') || 'C:\\Program Files';
    const pf86 = env('ProgramFiles(x86)') || 'C:\\Program Files (x86)';
    const list: string[] = [];

    // Windows 上优先可直接执行的 .exe / .cmd，避免选中无扩展名的 npm shell shim
    const wbExe = (root: string, names: string[]) => names.map((n) => path.join(root, ...WB_CLI_REL, n));
    if (lad) list.push(...wbExe(path.join(lad, 'Programs', 'WorkBuddy'), ['codebuddy.exe', 'codebuddy.cmd', 'codebuddy']));
    if (appData) list.push(path.join(appData, 'npm', 'codebuddy.cmd'), path.join(appData, 'npm', 'codebuddy'));
    list.push(
        path.join(pf, 'nodejs', 'codebuddy.cmd'),
        path.join(pf, 'nodejs', 'node_modules', '.bin', 'codebuddy.cmd'),
        path.join(pf86, 'nodejs', 'node_modules', '.bin', 'codebuddy.cmd'),
        ...wbExe(path.join(pf, 'WorkBuddy'), ['codebuddy.exe', 'codebuddy.cmd', 'codebuddy']),
        ...wbExe(path.join(pf86, 'WorkBuddy'), ['codebuddy.exe', 'codebuddy.cmd', 'codebuddy']),
    );
    for (const drive of ['C:', 'D:', 'E:']) {
        list.push(...wbExe(path.join(`${drive}\\Program Files`, 'WorkBuddy'), ['codebuddy.exe', 'codebuddy.cmd', 'codebuddy']));
    }
    return list;
}

export function resolveCodebuddyPath(customPath: string): string {
    // 优先级：用户指定 > 环境变量 > 常见安装位置 > PATH > 裸命令兜底
    if (customPath && fs.existsSync(customPath)) return customPath;
    const fromEnv = env('CODEBUDDY_PATH');
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

    const extra = [
        env('NVM_BIN') && path.join(env('NVM_BIN'), 'codebuddy'),
        env('npm_config_prefix') && path.join(env('npm_config_prefix'), 'bin', 'codebuddy'),
    ];
    const hit = firstHit([...codebuddyCandidates(), ...extra]);
    if (hit) {
        bbLog('[WB] resolved codebuddy path:', hit);
        return hit;
    }

    const onPath = findOnPath(isWin() ? ['codebuddy.exe', 'codebuddy.cmd', 'codebuddy'] : ['codebuddy']);
    return onPath ?? 'codebuddy';
}

// ===== 跨平台 spawn 策略辅助函数 =====

const WRAPPER_EXTS = new Set(['.cmd', '.exe', '.bat']);

export function isWindowsWrapper(scriptPath: string): boolean {
    return WRAPPER_EXTS.has(path.extname(scriptPath).toLowerCase());
}

export function isBareFallback(scriptPath: string): boolean {
    // 兜底值 'codebuddy' 不是真实文件路径，让 OS 在 PATH 里找
    return scriptPath === 'codebuddy' || !path.isAbsolute(scriptPath);
}

export function needsWindowsShell(scriptPath: string): boolean {
    const ext = path.extname(scriptPath).toLowerCase();
    return isWin() && (ext === '.cmd' || ext === '.bat');
}

/**
 * 根据脚本路径类型选择正确的 spawn 方式：
 * - Windows 包装器（.cmd/.exe/.bat）或裸命令直接 spawn
 * - 纯脚本通过 node 可执行文件运行
 */
export function spawnCli(
    scriptPath: string,
    args: string[],
    options: SpawnOptions,
    nodeBin?: string
): ReturnType<typeof spawn> {
    if (isWindowsWrapper(scriptPath) || isBareFallback(scriptPath)) {
        return spawn(scriptPath, args, options);
    }
    return spawn(nodeBin || findNodeExecutable() || 'node', [scriptPath, ...args], options);
}
