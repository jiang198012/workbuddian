import * as fs from 'fs';
import * as path from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

const MIME_EXT: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
};

/** MIME → 扩展名，未知回退 .png */
export function extForMime(mime: string): string {
    return MIME_EXT[mime.toLowerCase()] || '.png';
}

/** 粘贴图基名；seq 由调用方传入保证唯一，本函数纯格式化便于测试 */
export function pastedImageName(seq: number | string, ext = '.png'): string {
    return `paste-${seq}${ext}`;
}

/** 按扩展名判断是否图片（决定缩略图 / 文字 chip） */
export function isImagePath(p: string): boolean {
    return IMAGE_EXTS.has(path.extname(p).toLowerCase());
}

/** 确保 dir 存在、写文件、返回绝对路径 */
export function writeImageFile(dir: string, bytes: Uint8Array, name: string): string {
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, name);
    fs.writeFileSync(full, bytes);
    return full;
}

/** 按 mtime 保留最近 keepN 个、删除更旧的（仅作用于 dir 内文件） */
export function pruneImages(dir: string, keepN: number): void {
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return; // 目录不存在 → no-op
    }
    const files = names
        .map((n) => path.join(dir, n))
        .filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } })
        .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime); // 新 → 旧
    for (const { p } of files.slice(keepN)) {
        try { fs.unlinkSync(p); } catch { /* 忽略 */ }
    }
}
