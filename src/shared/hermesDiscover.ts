/** Hermes 本机自动发现:从 HERMES_HOME / %LOCALAPPDATA%\hermes / ~/.hermes 读 gateway 配置。纯 Node,无 Obsidian 依赖 */
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

/** 从 .env 文本里抠 KEY=VALUE（去掉成对引号，Hermes 的 dotenv 解析同样会剥引号） */
function envVal(text: string, key: string): string {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm'));
    const value = m?.[1] ?? '';
    const quoted = /^(['"])(.*)\1$/.exec(value);
    return quoted ? quoted[2] : value;
}

/** 从 config.yaml 文本里抠 platforms.api_server.extra 下的字段(极简 YAML 解析,只认两级缩进标量) */
function yamlApiServer(text: string, key: string): string {
    const m = text.match(new RegExp(`api_server:[\\s\\S]*?\\n\\s+${key}:\\s*(\\S+)`, 'i'));
    return m?.[1] ?? '';
}

/**
 * 本机 Hermes 配置目录候选（按优先级）：
 *   1. HERMES_HOME（官方安装器/用户显式指定）
 *   2. %LOCALAPPDATA%\hermes（Windows 官方安装器默认位置）
 *   3. ~/.hermes（历史默认位置）
 * 只返回去重后的非空绝对/显式路径。
 */
export function hermesHomeCandidates(): string[] {
    const candidates = [
        process.env.HERMES_HOME?.trim(),
        process.env.LOCALAPPDATA?.trim() ? join(process.env.LOCALAPPDATA.trim(), 'hermes') : '',
        join(homedir(), '.hermes'),
    ];
    return [...new Set(candidates.filter((value): value is string => !!value))];
}

function readHermesHome(home: string): { configText: string; envText: string } | null {
    let configText = '';
    let envText = '';
    try {
        configText = readFileSync(join(home, 'config.yaml'), 'utf-8');
    } catch { /* 无 config.yaml */ }
    try {
        envText = readFileSync(join(home, '.env'), 'utf-8');
    } catch { /* 无 .env */ }
    return configText || envText ? { configText, envText } : null;
}

function parseHermesDiscovery(configText: string, envText: string): HermesDiscovery {
    // api_server 是否启用:config.yaml 里 api_server 段下有 enabled: true，或 .env 显式开启
    const enabled = /api_server:[\s\S]*?\n\s+enabled:\s*true/i.test(configText)
        || envVal(envText, 'API_SERVER_ENABLED').toLowerCase() === 'true';
    const host = envVal(envText, 'API_SERVER_HOST') || yamlApiServer(configText, 'host') || '127.0.0.1';
    const port = envVal(envText, 'API_SERVER_PORT') || yamlApiServer(configText, 'port') || '8642';
    const key = envVal(envText, 'API_SERVER_KEY') || yamlApiServer(configText, 'key');
    return {
        gatewayUrl: `http://${host}:${port}`,
        apiKey: key,
        enabled,
    };
}

/**
 * 探测本机 Hermes gateway 配置。
 * 读序:环境变量(.env 由 Hermes gateway 加载，优先级高于 config.yaml)
 *  → config.yaml 的 platforms.api_server.extra.{enabled,host,port,key} → 默认 8642。
 * 目录按 hermesHomeCandidates 的顺序查找；rootDir 指定时只用该目录。
 * 注意:实际监听端口/密钥取 gateway 进程环境，.env 里与 config.yaml 不一致时以 .env 为准。
 * 目录不存在/文件缺失返回 null(未安装)。
 */
export function discoverHermes(rootDir?: string): HermesDiscovery | null {
    const homes = rootDir ? [rootDir] : hermesHomeCandidates();
    for (const home of homes) {
        const texts = readHermesHome(home);
        if (texts) return parseHermesDiscovery(texts.configText, texts.envText);
    }
    return null;
}
