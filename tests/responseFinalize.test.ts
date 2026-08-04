import { pickFinalContent, appendTextChunk } from '../src/shared/responseFinalize';

describe('pickFinalContent', () => {
    it('prefers streamed body text', () => {
        expect(pickFinalContent('body', 'res')).toBe('body');
    });
    it('falls back to the result-event text when there is no body', () => {
        expect(pickFinalContent('', 'res')).toBe('res');
    });
    it('returns empty string when nothing was produced', () => {
        // thinking 不是参数：内部推理永不升格为正文（WB-009 Reject 后泄露英文意图）
        expect(pickFinalContent('', '')).toBe('');
    });
});

describe('appendTextChunk', () => {
    it('appends normal delta chunks', () => {
        expect(appendTextChunk('你好', '，世界')).toBe('你好，世界');
    });
    it('returns incoming when nothing accumulated yet', () => {
        expect(appendTextChunk('', '第一段')).toBe('第一段');
        expect(appendTextChunk('已有', '')).toBe('已有');
    });
    it('replaces when incoming is a snapshot extending the accumulated text', () => {
        const accumulated = '这是一段较长的累计正文，超过三十二个字符用于测试快照语义';
        const incoming = accumulated + '，新增尾巴';
        expect(appendTextChunk(accumulated, incoming)).toBe(incoming);
    });
    it('skips a large chunk that exactly duplicates the accumulated tail (relay+summary 两路投递)', () => {
        const paragraph = '审查结论：这段代码存在三个需要修复的问题，分别是空指针、越界与资源泄漏。'; // ≥32 字符
        expect(paragraph.length).toBeGreaterThanOrEqual(32);
        expect(appendTextChunk(paragraph, paragraph)).toBe(paragraph);
    });
    it('does not dedupe short chunks (模型可能正常连续输出相同短词)', () => {
        expect(appendTextChunk('ha', 'ha')).toBe('haha');
    });
});
