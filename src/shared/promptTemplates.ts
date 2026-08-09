/** 模板 prompt 的纯逻辑（A1）：预设常用 prompt,斜杠命令触发,填入输入框供编辑 */

export interface PromptTemplate {
    /** 命令名（不含 /） */
    name: string;
    /** 模板正文(填入输入框,{x} 为占位,用户可改) */
    prompt: string;
    /** 补全里显示的中文描述 */
    desc: string;
}

/** 内置模板。占位符 {内容} / {文本} 之类在填入时保留,用户自行替换 */
export const PROMPT_TEMPLATES: PromptTemplate[] = [
    {
        name: 'translate',
        prompt: '请把下面的内容翻译成中文，保持原意和语气：\n\n{待翻译文本}',
        desc: '翻译成中文',
    },
    {
        name: 'summarize',
        prompt: '请用 3-5 句话总结下面的要点：\n\n{待总结文本}',
        desc: '总结要点',
    },
    {
        name: 'rewrite',
        prompt: '请改写下面的内容，让它更简洁、更易读：\n\n{待改写文本}',
        desc: '改写润色',
    },
    {
        name: 'polish',
        prompt: '请润色下面的文字，提升表达质量，保留原意：\n\n{待润色文本}',
        desc: '润色文字',
    },
    {
        name: 'review',
        prompt: '请审查下面的代码/内容，指出问题并给出改进建议：\n\n{待审查内容}',
        desc: '审查改进',
    },
    {
        name: 'explain',
        prompt: '请用通俗易懂的方式解释下面的概念：\n\n{待解释内容}',
        desc: '通俗解释',
    },
];

/** 按命令名查模板（不区分大小写）；未命中返回 null */
export function findTemplate(name: string): PromptTemplate | null {
    const q = name.toLowerCase();
    return PROMPT_TEMPLATES.find((t) => t.name.toLowerCase() === q) ?? null;
}

/** 补全匹配：按前缀过滤模板命令 */
export function filterTemplates(query: string): PromptTemplate[] {
    const q = query.toLowerCase();
    return PROMPT_TEMPLATES.filter((t) => t.name.toLowerCase().startsWith(q));
}
