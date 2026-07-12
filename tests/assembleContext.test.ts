import { assembleContextText } from '../src/core/context/assembleContext';

describe('assembleContextText', () => {
    const VAULT_PREFIX = (vp: string, text: string) =>
        `当前 Obsidian Vault 路径: ${vp}\n工作目录即 vault 根目录，请基于 vault 中的文件回答问题。\n\n---\n\n${text}`;

    it('无 vault 注入时只返回原文', () => {
        expect(assembleContextText('hi', undefined, true, '', '')).toBe('hi');
        expect(assembleContextText('hi', '/v', false, '', '')).toBe('hi');
    });

    it('vault 注入时加前缀块', () => {
        expect(assembleContextText('hi', '/v', true, '', '')).toBe(VAULT_PREFIX('/v', 'hi'));
    });

    it('追加当前笔记链接', () => {
        expect(assembleContextText('hi', undefined, false, '当前：《A》', ''))
            .toBe('hi\n\n---\n\n当前：《A》');
    });

    it('追加引用块', () => {
        expect(assembleContextText('hi', undefined, false, '', 'REF'))
            .toBe('hi\n\n---\n\nREF');
    });

    it('三段齐全按 vault→笔记→引用 顺序拼接', () => {
        expect(assembleContextText('hi', '/v', true, '当前：《A》', 'REF'))
            .toBe(VAULT_PREFIX('/v', 'hi') + '\n\n---\n\n当前：《A》\n\n---\n\nREF');
    });
});
