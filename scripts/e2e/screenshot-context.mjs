#!/usr/bin/env node
/**
 * README 宽图(含 Obsidian 界面):体现对笔记内容的操控能力。
 *   布局:左侧打开笔记正文("微调与对齐.md"),右侧 Workbuddian 侧边栏面板。
 *   对话:@[[笔记]] 引用 → AI 读取笔记内容作为上下文 → 基于内容回答。
 *
 * 用法:
 *   node scripts/e2e/screenshot-context.mjs [port] [out]
 */
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9333';
const OUT = process.argv[3] ?? '/tmp/wb-context-shot.png';
const ENDPOINT = `http://127.0.0.1:${PORT}`;

async function findMainPage(browser) {
    for (const ctx of browser.contexts()) {
        for (const page of ctx.pages()) {
            if (page.url().includes('obsidian.md/index.html')) return page;
        }
    }
    const all = browser.contexts().flatMap((c) => c.pages());
    if (all.length) return all[0];
    throw new Error('没有找到 Obsidian 主窗口');
}

async function main() {
    const browser = await chromium.connectOverCDP(ENDPOINT);
    const page = await findMainPage(browser);
    console.log('主窗口:', await page.title());

    // 1. 注入"操控笔记"对话(内容体现 @ 引用 → 读取笔记 → 基于内容回答)
    const convId = await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (!mgr) return null;
        const existing = mgr.getAll();
        const ids = Array.isArray(existing) ? existing.map((c) => (c && c.id) || c) : [];
        for (const id of ids) mgr.deleteConversation(id);

        const conv = mgr.createConversation('微调笔记问答');
        mgr.addMessage(conv.id, 'user', '@[[微调与对齐]] 帮我总结这篇笔记的微调方式，并指出哪个适合我的场景');
        mgr.addMessage(conv.id, 'assistant', [
            '我读完了 [[微调与对齐]] 的全文。笔记里的微调方式有三类：',
            '',
            '1. **全参数微调** —— 效果好但贵',
            '2. **参数高效微调（LoRA 等）** —— 只训练少量参数，省显存、易切换',
            '3. **指令微调** —— 用「指令-回答」数据教模型听懂人话',
            '',
            '另外笔记在「待厘清的问题」里提到：LoRA 微调效果不理想时，先调数据还是先调秩（rank）？',
            '',
            '如果你的场景是**显存有限 + 需要快速切换任务**，LoRA 更合适；如果追求极致效果且资源充足，再考虑全参数微调。',
        ].join('\n'));
        mgr.flush?.();
        return conv.id;
    });
    if (!convId) { console.error('✗ 注入失败'); await browser.close(); process.exit(1); }

    // 2. 打开左侧笔记正文 + 关闭主面板,在右侧栏打开 Workbuddian
    await page.evaluate(async () => {
        const app = window.app;
        // 关掉所有 workbuddian 面板(避免复用)
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach((l) => l.detach());
        // 在左侧打开笔记正文
        const file = app.vault.getAbstractFileByPath('微调与对齐.md');
        if (file) {
            const leaf = app.workspace.getLeaf(true);
            await leaf.openFile(file);
        }
        // 折叠左侧栏窄栏(文件树)让出更多给笔记
        try { app.workspace.leftSplit.collapsed = true; } catch (e) {}
        // 右侧栏打开 Workbuddian
        const p = app.plugins?.plugins?.workbuddian;
        if (p && typeof p.activateView === 'function') p.activateView();
    });
    await page.waitForTimeout(1500);
    await page.locator('.workbuddian-chat-container').waitFor({ state: 'visible', timeout: 15_000 });

    // 3. 切到刚注入的对话,强制重开确保全量渲染
    await page.evaluate((cid) => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (mgr && typeof mgr.switchTo === 'function') mgr.switchTo(cid);
    }, convId);
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        const app = window.app;
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach((l) => l.detach());
        const p = app?.plugins?.plugins?.workbuddian;
        if (p && typeof p.activateView === 'function') p.activateView();
    });
    await page.waitForTimeout(1500);
    await page.locator('.workbuddian-chat-container').waitFor({ state: 'visible', timeout: 15_000 });

    // 3.5 注入引用 chip(输入框填 @[[微调与对齐]],体现"引用笔记内容作为上下文")
    await page.evaluate(() => {
        const app = window.app;
        const leaves = app?.workspace?.getLeavesOfType?.('workbuddian-panel') || [];
        const view = leaves[0]?.view;
        if (view) {
            view.inputEl.value = '@[[微调与对齐]] ';
            view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // 临时放宽 chip 宽度让文件名完整显示(仅影响截图)
        const style = document.createElement('style');
        style.textContent = '.workbuddian-ref-chip { max-width: 160px !important; }';
        document.head.appendChild(style);
    });
    await page.waitForTimeout(800);

    // 4. 全窗截图(左侧笔记正文 + 右侧聊天面板 + 引用 chip)
    await page.screenshot({ path: OUT });
    console.log('宽图已截图:', OUT);
    await browser.close();
}

main().catch((e) => {
    console.error('✗ 截图失败:', e.message);
    process.exit(1);
});
