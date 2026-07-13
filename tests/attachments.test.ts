import { fileBasename, fileDir, attachmentDirs, buildAttachmentBlock } from '../src/shared/attachments';

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

describe('fileDir', () => {
    it('returns the parent directory of a POSIX path', () => {
        expect(fileDir('/Users/x/Desktop/doc.pdf')).toBe('/Users/x/Desktop');
    });
    it('returns the parent directory of a Windows path', () => {
        expect(fileDir('C:\\Users\\x\\report.docx')).toBe('C:\\Users\\x');
    });
    it('keeps the root for a file directly under root', () => {
        expect(fileDir('/foo.txt')).toBe('/');
    });
    it('returns the input unchanged when there is no separator', () => {
        expect(fileDir('file.txt')).toBe('file.txt');
    });
});

describe('attachmentDirs', () => {
    it('returns an empty array for no attachments', () => {
        expect(attachmentDirs([])).toEqual([]);
    });
    it('maps each path to its parent directory', () => {
        expect(attachmentDirs(['/a/b.txt', '/c/d.png'])).toEqual(['/a', '/c']);
    });
    it('deduplicates directories shared by multiple files', () => {
        expect(attachmentDirs(['/a/b.txt', '/a/c.png', '/d/e.md'])).toEqual(['/a', '/d']);
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
