import { setLang } from '../src/i18n';
import { middleEllipsis, toolsHeaderText } from '../src/shared/toolSummary';

describe('工具块折叠行摘要（#18）', () => {
    afterEach(() => setLang('zh'));

    it('没有可显示的调用时回退到通用标签', () => {
        setLang('zh');
        expect(toolsHeaderText([])).toBe('工具调用');
        expect(toolsHeaderText(['', '   '])).toBe('工具调用');
        setLang('en');
        expect(toolsHeaderText([])).toBe('Tool call');
    });

    it('只有一次调用时直接显示命令或文件', () => {
        setLang('zh');
        expect(toolsHeaderText(['Read  notes/plan.md\n'])).toBe('Read notes/plan.md');
    });

    it('多次调用时显示最近一次并附上次数', () => {
        setLang('zh');
        expect(toolsHeaderText(['Read a.md', 'Grep TODO', 'Bash ls -la'])).toBe('Bash ls -la（共 3 次）');
        setLang('en');
        expect(toolsHeaderText(['Read a.md', '', 'Bash ls -la'])).toBe('Bash ls -la (2 calls)');
    });

    it('过长时中间省略，保留开头的工具名和结尾的文件名', () => {
        const long = `Read /Users/someone/Documents/Obsidian/very/deep/folder/structure/that/keeps/going/00 AI 学习地图.md`;
        const short = middleEllipsis(long, 40);
        expect(Array.from(short)).toHaveLength(40);
        expect(short.startsWith('Read /Users/')).toBe(true);
        expect(short.endsWith('00 AI 学习地图.md')).toBe(true);
        expect(short).toContain('…');
        expect(middleEllipsis('Read a.md', 40)).toBe('Read a.md');
    });
});
