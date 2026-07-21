import * as path from 'path';
import * as fs from 'fs';
import { spawn, type SpawnOptions } from 'child_process';
import { bbLog } from '../shared/logBuffer';

// ===== Node.js 可执行文件查找 =====

const NODE_EXECUTABLE = process.platform === 'win32' ? 'node.exe' : 'node';

export function findNodeExecutable(): string | null {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const nodeDirs: string[] = [];

    if (process.platform === 'win32') {
        nodeDirs.push(path.dirname(process.execPath));
        const appData = process.env.APPDATA || '';
        if (appData) {
            nodeDirs.push(appData);
            nodeDirs.push(path.join(appData, 'npm'));
        }
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localAppData = process.env.LOCALAPPDATA || '';
        nodeDirs.push(
            path.join(programFiles, 'nodejs'),
            path.join(programFilesX86, 'nodejs'),
        );
        if (localAppData) {
            nodeDirs.push(path.join(localAppData, 'Programs', 'nodejs'));
        }
        const nvmSymlink = process.env.NVM_SYMLINK;
        if (nvmSymlink) {
            nodeDirs.push(nvmSymlink);
        }

        // Managed WorkBuddy Node.js (scan version directories)
        if (home) {
            const wbNodeVersionsDir = path.join(home, '.workbuddy', 'binaries', 'node', 'versions');
            try {
                const versions = fs.readdirSync(wbNodeVersionsDir);
                for (const v of versions) {
                    nodeDirs.push(path.join(wbNodeVersionsDir, v));
                }
            } catch { /* ignore missing directory */ }
        }

        // Scan common drive letters for nodejs (handles non-C: installs)
        for (const drive of ['C:', 'D:', 'E:']) {
            if (drive + '\\' !== path.parse(programFiles).root.toUpperCase()) {
                nodeDirs.push(path.join(drive + '\\Program Files', 'nodejs'));
            }
        }
    } else {
        nodeDirs.push(
            path.join(home, '.local', 'bin'),
            path.join(home, '.npm-global', 'bin'),
            path.join(home, '.volta', 'bin'),
            path.join(home, 'bin'),
            '/usr/local/bin',
            '/opt/homebrew/bin',
        );
        const nvmBin = process.env.NVM_BIN;
        if (nvmBin) {
            nodeDirs.push(nvmBin);
        }
    }

    for (const dir of nodeDirs) {
        if (!dir) continue;
        try {
            const nodePath = path.join(dir, NODE_EXECUTABLE);
            if (fs.existsSync(nodePath) && fs.statSync(nodePath).isFile()) {
                bbLog('[WB] found node at:', nodePath);
                return nodePath;
            }
        } catch { /* ignore inaccessible path */ }
    }

    bbLog("[WB] WARNING: node not found in any search path, falling back to 'node'");
    return 'node';
}

// ===== CodeBuddy CLI 路径查找 =====

export function resolveCodebuddyPath(customPath: string): string {
    if (customPath && fs.existsSync(customPath)) {
        return customPath;
    }
    if (process.env.CODEBUDDY_PATH && fs.existsSync(process.env.CODEBUDDY_PATH)) {
        return process.env.CODEBUDDY_PATH;
    }

    const home = process.env.HOME || process.env.USERPROFILE || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidates: string[] = [];

    if (process.platform === 'win32') {
        // Windows 上优先使用可直接执行的 .exe / .cmd，避免选中无扩展名的 npm shell shim
        candidates.push(
            path.join(localAppData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
            path.join(localAppData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
            path.join(localAppData, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
        );
        if (appData) {
            candidates.push(path.join(appData, 'npm', 'codebuddy.cmd'));
            candidates.push(path.join(appData, 'npm', 'codebuddy'));
        }
        candidates.push(
            path.join(programFiles, 'nodejs', 'codebuddy.cmd'),
            path.join(programFiles, 'nodejs', 'node_modules', '.bin', 'codebuddy.cmd'),
            path.join(programFilesX86, 'nodejs', 'node_modules', '.bin', 'codebuddy.cmd'),
            path.join(programFiles, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
            path.join(programFiles, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
            path.join(programFiles, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
            path.join(programFilesX86, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
            path.join(programFilesX86, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
            path.join(programFilesX86, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
        );

        // Scan common drive letters for WorkBuddy installation
        for (const drive of ['C:', 'D:', 'E:']) {
            candidates.push(
                path.join(drive + '\\Program Files', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
                path.join(drive + '\\Program Files', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
                path.join(drive + '\\Program Files', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
            );
        }
    } else {
        candidates.push(
            '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
            path.join(home, 'Applications', 'WorkBuddy.app', 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
            path.join(home, '.local', 'bin', 'codebuddy'),
            path.join(home, '.npm-global', 'bin', 'codebuddy'),
            path.join(home, '.volta', 'bin', 'codebuddy'),
            path.join(home, 'bin', 'codebuddy'),
            '/usr/local/bin/codebuddy',
            '/opt/homebrew/bin/codebuddy',
        );
    }

    const nvmBin = process.env.NVM_BIN;
    if (nvmBin) candidates.push(path.join(nvmBin, 'codebuddy'));
    const npmPrefix = process.env.npm_config_prefix;
    if (npmPrefix) candidates.push(path.join(npmPrefix, 'bin', 'codebuddy'));

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            bbLog('[WB] resolved codebuddy path:', p);
            return p;
        }
    }

    // 搜索系统 PATH
    const envPath = process.env.PATH || '';
    const pathSep = process.platform === 'win32' ? ';' : ':';
    const exeNames = process.platform === 'win32' ? ['codebuddy.exe', 'codebuddy.cmd', 'codebuddy'] : ['codebuddy'];
    for (const dir of envPath.split(pathSep)) {
        if (!dir) continue;
        for (const name of exeNames) {
            try {
                const p = path.join(dir, name);
                if (fs.existsSync(p)) return p;
            } catch { /* ignore inaccessible path */ }
        }
    }

    return 'codebuddy';
}

// ===== 跨平台 spawn 策略辅助函数 =====

export function isWindowsWrapper(scriptPath: string): boolean {
    return scriptPath.endsWith('.cmd') || scriptPath.endsWith('.exe') || scriptPath.endsWith('.bat');
}

export function isBareFallback(scriptPath: string): boolean {
    // 兜底值 'codebuddy' 不是真实文件路径，让 OS 在 PATH 里找
    return scriptPath === 'codebuddy' || !path.isAbsolute(scriptPath);
}

export function needsWindowsShell(scriptPath: string): boolean {
    return process.platform === 'win32' && (scriptPath.endsWith('.cmd') || scriptPath.endsWith('.bat'));
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
    const node = nodeBin || findNodeExecutable() || 'node';
    return spawn(node, [scriptPath, ...args], options);
}
