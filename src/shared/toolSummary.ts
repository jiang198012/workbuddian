import { t } from '../i18n';

const MAX_HEADER_CHARS = 60;

/** 中间省略：保留开头的工具名和结尾的文件名（按字符计，避免截断中文） */
export function middleEllipsis(text: string, max = MAX_HEADER_CHARS): string {
    const chars = Array.from(text);
    if (chars.length <= max) return text;
    const head = Math.ceil((max - 1) / 2);
    const tail = max - 1 - head;
    return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

/** 工具块折叠行文字（#18）：显示最近一次调用的命令或文件，多次调用时附上次数；没有内容时用通用标签。 */
export function toolsHeaderText(rowTexts: string[]): string {
    const rows = rowTexts.map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!rows.length) return t('input.toolCall');
    const latest = middleEllipsis(rows[rows.length - 1]);
    if (rows.length === 1) return latest;
    return t('input.toolCallSummary').replace('{text}', latest).replace('{count}', String(rows.length));
}
