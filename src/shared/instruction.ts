/** 聊天输入去首尾空白后以 # 开头 → 返回其后指令文本（trim；单个 # 返回 ''）；否则 null */
export function parseInstructionInput(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('#')) return null;
    return trimmed.slice(1).trim();
}

/** 常驻指令 → 注入用的前置块；空（trim 后）返回 '' */
export function buildInstructionBlock(instruction: string): string {
    const s = instruction.trim();
    return s ? `[用户常驻指令]\n${s}` : '';
}
