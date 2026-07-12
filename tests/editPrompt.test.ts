import { buildEditPrompt } from '../src/shared/editPrompt';

describe('buildEditPrompt', () => {
    it('includes the selection, instruction and the only-body constraint', () => {
        const p = buildEditPrompt('原始正文', '改简洁');
        expect(p).toContain('原始正文');
        expect(p).toContain('改简洁');
        expect(p).toContain('只输出改写后的正文');
    });
});
