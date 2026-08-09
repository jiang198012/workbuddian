import { buildVaultStats } from '../src/shared/vaultStats';

const files = [
    { path: '笔记/机器学习.md', content: '# ML\n## 分类 #ai #ml\n正文 #ai' },
    { path: '笔记/深度学习.md', content: '# DL\n正文 #ml #deep' },
    { path: '日记/2026-08-09.md', content: '# 日记 #daily' },
    { path: 'README.md', content: '# README' },
    { path: '图片.png', content: '' },
];

describe('buildVaultStats (vault 上下文统计)', () => {
    it('counts files and notes, ignoring non-md', () => {
        const out = buildVaultStats(files, 0);
        expect(out).toContain('文件总数: 5');
        expect(out).toContain('Markdown 笔记: 4');
        expect(out).toContain('目录数: 3'); // 笔记/ 日记/ (根目录)
    });

    it('aggregates top tags, skipping frontmatter', () => {
        const withFm = [
            { path: 'a.md', content: '---\ntags: [x]\n---\n# Body #real' },
        ];
        const out = buildVaultStats(withFm, 0);
        expect(out).toContain('#real × 1');
        expect(out).not.toContain('#x'); // frontmatter 标签不进统计
    });

    it('ranks tags by frequency', () => {
        const out = buildVaultStats(files, 0);
        // #ai × 2 与 #ml × 2 排在 #deep × 1 前
        expect(out.indexOf('#ai × 2')).toBeLessThan(out.indexOf('#deep × 1'));
        expect(out.indexOf('#ml × 2')).toBeLessThan(out.indexOf('#daily × 1'));
    });

    it('handles empty vault', () => {
        const out = buildVaultStats([], 0);
        expect(out).toContain('文件总数: 0');
        expect(out).toContain('(无标签)');
    });
});
