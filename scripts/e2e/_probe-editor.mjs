import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
let page = null;
for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('obsidian.md')) { page = p; break; }
// 打开一个笔记,拿编辑器,探 CM 访问
const info = await page.evaluate(() => {
    const app = window.app;
    const leaf = app.workspace.getMostRecentLeaf();
    const view = leaf?.view;
    const editor = view?.editor;
    if (!editor) return { hasEditor: false };
    const cm = editor.cm; // Obsidian 私有属性(CM6 EditorView)
    return {
        hasEditor: true,
        hasCm: !!cm,
        cmKeys: cm ? Object.keys(cm).slice(0, 8) : [],
        hasCoords: cm && typeof cm.coordsAtPos === 'function',
        hasPosAtCoords: cm && typeof cm.posAtCoords === 'function',
    };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
