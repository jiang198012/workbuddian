/** MCP 服务器设置的纯逻辑：JSON ⇄ 结构化条目（单一真相 = settings.mcpServersJson 字符串） */

export interface McpServerEnv { name: string; value: string }

export interface McpServerEntry {
    name: string;
    command: string;
    args: string[];
    env: McpServerEnv[];
    /** 停用标记：保留在设置 JSON 里，注入 CLI 前被过滤 */
    disabled?: boolean;
}

/** 解析设置 JSON 为条目数组；env 兼容 record 与 {name,value}[] 两种形态；非法返回 [] */
export function parseMcpServers(json: string): McpServerEntry[] {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(raw)) return [];
    const out: McpServerEntry[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        if (typeof rec.name !== 'string' || !rec.name) continue;
        out.push({
            name: rec.name,
            command: typeof rec.command === 'string' ? rec.command : '',
            args: Array.isArray(rec.args) ? rec.args.filter((a): a is string => typeof a === 'string') : [],
            env: normalizeEnv(rec.env),
            disabled: rec.disabled === true ? true : undefined,
        });
    }
    return out;
}

function normalizeEnv(env: unknown): McpServerEnv[] {
    if (Array.isArray(env)) {
        return env
            .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
            .map((e) => ({ name: String(e.name ?? ''), value: String(e.value ?? '') }))
            .filter((e) => e.name.length > 0);
    }
    if (env && typeof env === 'object') {
        return Object.entries(env as Record<string, unknown>).map(([name, value]) => ({ name, value: String(value) }));
    }
    return [];
}

/** 序列化回设置 JSON（紧凑单行）；disabled 为 true 才落该键 */
export function serializeMcpServers(servers: McpServerEntry[]): string {
    return JSON.stringify(servers.map((s) => ({
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
        ...(s.disabled ? { disabled: true } : {}),
    })));
}

/** 注入 CLI 前过滤停用项（并剥掉 disabled 键） */
export function activeMcpServers(servers: McpServerEntry[]): Array<Record<string, unknown>> {
    return servers
        .filter((s) => !s.disabled)
        .map((s) => ({ name: s.name, command: s.command, args: s.args, env: s.env }));
}

/** 从消息文本提取所有 @mcp/名称 引用（去重，按出现顺序）——R10 context-saving MCP */
export function extractMcpNames(text: string): string[] {
    const names: string[] = [];
    for (const match of text.matchAll(/@mcp\/([A-Za-z0-9._-]+)/g)) {
        if (!names.includes(match[1])) names.push(match[1]);
    }
    return names;
}

/** 从启用列表中筛出指定名称的服务器（保留原序）；名字不区分大小写 */
export function filterMcpServersByNames(servers: McpServerEntry[], names: string[]): McpServerEntry[] {
    if (!names.length) return [];
    const lower = names.map((n) => n.toLowerCase());
    return servers.filter((s) => lower.includes(s.name.toLowerCase()));
}

/** 从剪贴板文本解析：支持 {"mcpServers":{...}} 包装与单服务器 {name,command,...} 两种形态 */
export function parseClipboardServers(text: string): McpServerEntry[] {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return [];
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const rec = raw as Record<string, unknown>;
        if (rec.mcpServers && typeof rec.mcpServers === 'object' && !Array.isArray(rec.mcpServers)) {
            // {"mcpServers": {"name": {...}}} 包装形态
            return Object.entries(rec.mcpServers as Record<string, unknown>).map(([name, cfg]) => {
                const c = (cfg && typeof cfg === 'object' ? cfg : {}) as Record<string, unknown>;
                return {
                    name,
                    command: typeof c.command === 'string' ? c.command : '',
                    args: Array.isArray(c.args) ? c.args.filter((a): a is string => typeof a === 'string') : [],
                    env: normalizeEnv(c.env),
                };
            });
        }
        // 单服务器形态
        return parseMcpServers(JSON.stringify([raw]));
    }
    return parseMcpServers(text);
}
