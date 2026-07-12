import { fileBasename, buildAttachmentBlock } from '../src/shared/attachments';

describe('fileBasename', () => {
    it('extracts the filename from a POSIX path', () => {
        expect(fileBasename('/Users/x/doc.pdf')).toBe('doc.pdf');
    });
    it('extracts the filename from a Windows path', () => {
        expect(fileBasename('C:\\Users\\x\\report.docx')).toBe('report.docx');
    });
    it('returns the input unchanged when there is no separator', () => {
        expect(fileBasename('file.txt')).toBe('file.txt');
    });
});

describe('buildAttachmentBlock', () => {
    it('returns an empty string when there are no attachments', () => {
        expect(buildAttachmentBlock([])).toBe('');
    });
    it('lists each attached path as a bullet under a header', () => {
        const block = buildAttachmentBlock(['/a/b.txt', '/c/d.png']);
        expect(block.startsWith('用户附加了以下文件')).toBe(true);
        expect(block).toContain('- /a/b.txt');
        expect(block).toContain('- /c/d.png');
    });
});
