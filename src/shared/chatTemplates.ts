/** 会话模板的纯逻辑（E：新建对话时可选预设场景，自动带 system prompt + 开场白） */

export interface ChatTemplate {
    /** 模板 id（唯一） */
    id: string;
    /** 显示名 */
    name: string;
    /** 预设常驻指令（system prompt,注入所有消息） */
    instruction: string;
    /** 开场白（新建对话后预填进输入框的引导文本,空串=不预填） */
    opener: string;
}

/** 内置会话模板。中国用户高频场景:写作 / 翻译 / 代码审查 / 通用 */
export const CHAT_TEMPLATES: ChatTemplate[] = [
    {
        id: 'writing',
        name: '写作助手',
        instruction: '你是一位中文写作助手。帮我起草、润色、改写各类文字（报告/邮件/讲话稿/总结）。语气正式得体,结构清晰。',
        opener: '帮我写/改一段文字: ',
    },
    {
        id: 'translate',
        name: '翻译助手',
        instruction: '你是一位中英互译助手。准确传达原意,保持语气和格式;不确定的地方如实说明。',
        opener: '把下面的内容翻译成中文/英文: ',
    },
    {
        id: 'review',
        name: '代码审查',
        instruction: '你是一位代码审查员。审查给出的代码,指出 bug/可读性/性能问题并给出具体改进建议。',
        opener: '审查这段代码: ',
    },
    {
        id: 'note',
        name: '笔记整理',
        instruction: '你是一位笔记整理助手。帮我梳理 vault 里的笔记,提取要点、建立关联、归纳结构。',
        opener: '整理一下我的笔记: ',
    },
];

/** 按 id 查模板;未命中返回 null */
export function findChatTemplate(id: string): ChatTemplate | null {
    return CHAT_TEMPLATES.find((t) => t.id === id) ?? null;
}
