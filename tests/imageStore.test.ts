import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extForMime, pastedImageName, isImagePath, writeImageFile, pruneImages } from '../src/shared/imageStore';

describe('imageStore', () => {
    it('extForMime maps known mimes and falls back to .png', () => {
        expect(extForMime('image/png')).toBe('.png');
        expect(extForMime('image/jpeg')).toBe('.jpg');
        expect(extForMime('image/webp')).toBe('.webp');
        expect(extForMime('image/gif')).toBe('.gif');
        expect(extForMime('IMAGE/PNG')).toBe('.png');
        expect(extForMime('application/octet-stream')).toBe('.png');
    });

    it('pastedImageName formats basename with seq and ext', () => {
        expect(pastedImageName(5, '.png')).toBe('paste-5.png');
        expect(pastedImageName('a1', '.jpg')).toBe('paste-a1.jpg');
        expect(pastedImageName(1)).toBe('paste-1.png');
    });

    it('isImagePath detects image extensions case-insensitively', () => {
        expect(isImagePath('/a/b.png')).toBe(true);
        expect(isImagePath('/a/b.JPG')).toBe(true);
        expect(isImagePath('/a/b.webp')).toBe(true);
        expect(isImagePath('/a/b.txt')).toBe(false);
        expect(isImagePath('/a/b')).toBe(false);
    });

    it('writeImageFile creates dir and writes bytes, returns path', () => {
        const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'imgstore-')), 'nested');
        const p = writeImageFile(dir, new Uint8Array([1, 2, 3, 4]), 'x.png');
        expect(p).toBe(path.join(dir, 'x.png'));
        expect(Array.from(fs.readFileSync(p))).toEqual([1, 2, 3, 4]);
    });

    it('pruneImages keeps newest keepN and deletes older', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgprune-'));
        for (let i = 0; i < 5; i++) {
            const p = path.join(dir, `f${i}.png`);
            fs.writeFileSync(p, 'x');
            fs.utimesSync(p, new Date(1000 + i * 1000), new Date(1000 + i * 1000));
        }
        pruneImages(dir, 2);
        expect(fs.readdirSync(dir).sort()).toEqual(['f3.png', 'f4.png']);
    });

    it('pruneImages is a no-op on a missing directory', () => {
        expect(() => pruneImages('/no/such/dir/xyz', 5)).not.toThrow();
    });
});
