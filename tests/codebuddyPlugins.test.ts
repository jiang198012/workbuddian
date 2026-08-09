import { discoverPlugins, codebuddyPluginsRoot } from '../src/shared/codebuddyPlugins';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('discoverPlugins (R7 CodeBuddy 插件发现)', () => {
    it('discovers plugins grouped by marketplace, reading plugin.json', () => {
        // 构造临时插件目录结构
        const root = mkdtempSync(join(tmpdir(), 'wb-plugins-'));
        const mk = (market: string, plugin: string, manifest: Record<string, unknown>) => {
            const dir = join(root, 'marketplaces', market, 'plugins', plugin, '.codebuddy-plugin');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest));
        };
        mk('official', 'context7', { name: 'context7', description: '文档查询 MCP' });
        mk('official', 'clangd', { name: 'clangd-lsp', description: 'C++ 语言服务器' });
        mk('team', 'agent-browser', { name: 'agent-browser', description: '浏览器代理' });

        const plugins = discoverPlugins(root);
        expect(plugins).toHaveLength(3);
        // 市场/插件目录的 readdir 顺序不保证,断言集合相等
        expect(plugins.map((p) => p.name).sort()).toEqual(['agent-browser', 'clangd-lsp', 'context7']);
        expect(plugins.find((p) => p.name === 'context7')?.marketplace).toBe('official');
        expect(plugins.find((p) => p.name === 'context7')?.description).toBe('文档查询 MCP');
    });

    it('skips marketplaces without plugins dir and dirs without manifest', () => {
        const root = mkdtempSync(join(tmpdir(), 'wb-plugins2-'));
        // 一个市场有 plugins,一个市场空,一个 zip 残留
        const hasmanDir = join(root, 'marketplaces', 'official', 'plugins', 'hasman', '.codebuddy-plugin');
        mkdirSync(hasmanDir, { recursive: true });
        writeFileSync(join(hasmanDir, 'plugin.json'), JSON.stringify({ name: 'hasman', description: 'x' }));
        mkdirSync(join(root, 'marketplaces', 'empty'), { recursive: true });
        mkdirSync(join(root, 'marketplaces', 'official.zip'), { recursive: true });
        // 无 manifest 的插件目录
        mkdirSync(join(root, 'marketplaces', 'official', 'plugins', 'nomanifest'), { recursive: true });

        const plugins = discoverPlugins(root);
        expect(plugins.map((p) => p.name)).toEqual(['hasman']);
    });

    it('returns [] for missing root', () => {
        expect(discoverPlugins(join(tmpdir(), 'nonexistent-wb-plugins'))).toEqual([]);
    });

    it('codebuddyPluginsRoot points to ~/.codebuddy/plugins', () => {
        expect(codebuddyPluginsRoot()).toBe(join(process.env.HOME ?? '', '.codebuddy', 'plugins'));
    });
});
