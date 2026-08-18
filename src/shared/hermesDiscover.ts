/** Hermes 本机自动发现:从 ~/.hermes(Win 为 %USERPROFILE%\.hermes)读 gateway 配置。纯 Node,无 Obsidian 依赖 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface HermesDiscovery {
    /** gateway 地址(含协议),如 http://127.0.0.1:8642 */
    gatewayUrl: string;
    /** API key */
    apiKey: string;
    /** api_server 平台是否启用 */
    enabled: boolean;
}

/** 从 .env 文本里抠 KEY=VALUE */
function envVal(text: string, key: string): string {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm'));
    return m?.[1] ?? '';
}

/** 从 config.yaml 文本里抠 platforms.api_server.extra 下的字段(极简 YAML 解析,只认两级缩进标量) */
function yamlApiServer(text: string, key: string): string {
    const m = text.match(new RegExp(`api_server:[\\s\\S]*?\\n\\s+${key}:\\s*(\\S+)`, 'i'));
    return m?.[1] ?? '';
}

/**
 * 探测本机 Hermes gateway 配置。
 * 读序:config.yaml 的 platforms.api_server.extra.{enabled,host,port,key} → .env 的 API_SERVER_{PORT,KEY} → 默认 8642。
 * 目录不存在/文件缺失返回 null(未安装)。
 */
export function discoverHermes(rootDir?: string): HermesDiscovery | null {
    const home = rootDir ?? join(homedir(), '.hermes');
    let configText = '';
    let envText = '';
    try {
        configText = readFileSync(join(home, 'config.yaml'), 'utf-8');
    } catch { /* 无 config.yaml */ }
    try {
        envText = readFileSync(join(home, '.env'), 'utf-8');
    } catch { /* 无 .env */ }
    if (!configText && !envText) return null;

    // api_server 是否启用:config.yaml 里 api_server 段下有 enabled: true
    const enabled = /api_server:[\s\S]*?\n\s+enabled:\s*true/i.test(configText);
    const host = yamlApiServer(configText, 'host') || '127.0.0.1';
    const port = yamlApiServer(configText, 'port') || envVal(envText, 'API_SERVER_PORT') || '8642';
    const key = yamlApiServer(configText, 'key') || envVal(envText, 'API_SERVER_KEY');
    return {
        gatewayUrl: `http://${host}:${port}`,
        apiKey: key,
        enabled,
    };
}
