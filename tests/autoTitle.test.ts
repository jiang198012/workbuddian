import { fallbackTitle, sanitizeTitle, shouldApplyAutoTitle } from '../src/shared/autoTitle';

describe('fallbackTitle', () => {
    it('truncates at 30 chars with ellipsis', () => {
        expect(fallbackTitle('短消息')).toBe('短消息');
        expect(fallbackTitle('a'.repeat(40))).toBe('a'.repeat(30) + '...');
    });
});

describe('sanitizeTitle', () => {
    it('takes first line, strips quotes and trailing punctuation, caps at 20', () => {
        expect(sanitizeTitle('「AI 学习地图」\n\n更多内容')).toBe('AI 学习地图');
        expect(sanitizeTitle('  "My Title。"  ')).toBe('My Title');
        expect(sanitizeTitle('t'.repeat(30))).toBe('t'.repeat(20));
    });
    it('returns empty for blank input', () => {
        expect(sanitizeTitle('')).toBe('');
        expect(sanitizeTitle('\n\n')).toBe('');
    });
});

describe('shouldApplyAutoTitle', () => {
    it('applies only when current title is still the fallback', () => {
        const text = '帮我总结一下这篇笔记的主要内容';
        expect(shouldApplyAutoTitle(fallbackTitle(text), text)).toBe(true);
        expect(shouldApplyAutoTitle('用户改过的标题', text)).toBe(false);
    });
});
