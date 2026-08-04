/** @ 补全的扩展数据源：从设置 JSON 提取子代理名与 MCP 服务器名（纯解析，容错返回空） */

export function parseAgentNames(json: string): string[] {
    try {
        const v: unknown = JSON.parse(json);
        if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
        return Object.keys(v).filter((k) => k.trim().length > 0);
    } catch {
        return [];
    }
}

export function parseMcpServerNames(json: string): string[] {
    try {
        const v: unknown = JSON.parse(json);
        if (!Array.isArray(v)) return [];
        return v.map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>).name : undefined))
            .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    } catch {
        return [];
    }
}
