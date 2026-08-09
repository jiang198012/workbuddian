/** CodeBuddy 插件发现的纯逻辑（R7）：扫描 marketplaces 目录读插件清单。纯 Node(fs/path),无 obsidian import */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface CodebuddyPluginInfo {
    name: string;
    description: string;
    marketplace: string;
    /** 插件 manifest 所在目录（供 CLI 命令引用） */
    dir: string;
}

/** 从 plugin.json 里安全读字符串字段 */
function str(d: Record<string, unknown>, key: string): string {
    const v = d[key];
    return typeof v === 'string' ? v : '';
}

/**
 * 扫描 CodeBuddy 插件市场的所有插件。
 * 目录结构: <pluginsRoot>/marketplaces/<市场名>/plugins/<插件名>/.codebuddy-plugin/plugin.json
 * 返回按市场分组的插件列表;目录缺失返回 []。
 */
export function discoverPlugins(pluginsRoot: string = codebuddyPluginsRoot()): CodebuddyPluginInfo[] {
    const out: CodebuddyPluginInfo[] = [];
    const marketsDir = join(pluginsRoot, 'marketplaces');
    let markets: string[];
    try {
        markets = readdirSync(marketsDir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.endsWith('.zip'))
            .map((e) => e.name);
    } catch {
        return [];
    }
    for (const market of markets) {
        const pluginsDir = join(marketsDir, market, 'plugins');
        let pluginDirs: string[];
        try {
            pluginDirs = readdirSync(pluginsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
        } catch {
            continue; // 该市场无 plugins 目录，跳过
        }
        for (const pdir of pluginDirs) {
            const manifestPath = join(pluginsDir, pdir, '.codebuddy-plugin', 'plugin.json');
            let raw: unknown;
            try {
                raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
            } catch {
                continue; // 无合法 manifest，跳过
            }
            if (!raw || typeof raw !== 'object') continue;
            const rec = raw as Record<string, unknown>;
            const name = str(rec, 'name') || pdir;
            out.push({
                name,
                description: str(rec, 'description'),
                marketplace: market,
                dir: join(pluginsDir, pdir),
            });
        }
    }
    return out;
}

/** CodeBuddy 插件根目录(默认 ~/.codebuddy/plugins) */
export function codebuddyPluginsRoot(): string {
    return join(homeDir(), '.codebuddy', 'plugins');
}

function homeDir(): string {
    return process.env.HOME ?? process.env.USERPROFILE ?? '';
}
