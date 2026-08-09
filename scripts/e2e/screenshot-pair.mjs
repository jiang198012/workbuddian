#!/usr/bin/env node
/**
 * README 图②图③(窄幅 544×827,宽高比一致):
 *   图② 对话工作流:多轮对话 + @引用 + Markdown 表格 + 代码块 + 工具栏 + 会话标签
 *   图③ @ 引用聚合:空态 + 输入 @ 弹出四源聚合下拉(Agents/MCP/vault 文件)
 *
 * 用法:
 *   node scripts/e2e/screenshot-pair.mjs [port] [outDemo] [outAt]
 */
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9333';
const OUT_DEMO = process.argv[3] ?? '/tmp/wb-pair-demo.png';
const OUT_AT = process.argv[4] ?? '/tmp/wb-pair-at.png';
const ENDPOINT = `http://127.0.0.1:${PORT}`;

// 目标:聊天面板 544 × 827(窄幅竖图)
const WIN_W = 1200;   // 面板宽固定 544
const WIN_H = 867;    // 面板高 = 窗口高 - 40

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

async function resetRightPanel(page) {
    await page.evaluate(() => {
        const app = window.app;
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach((l) => l.detach());
        try { app.workspace.leftSplit.collapsed = true; } catch (e) {}
        const p = app?.plugins?.plugins?.workbuddian;
        if (p && typeof p.activateView === 'function') p.activateView();
    });
    await page.waitForTimeout(1200);
    await page.locator('.workbuddian-chat-container').waitFor({ state: 'visible', timeout: 15_000 });
}

async function injectDemoConversation(page) {
    return page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (!mgr) return null;
        const existing = mgr.getAll();
        const ids = Array.isArray(existing) ? existing.map((c) => (c && c.id) || c) : [];
        for (const id of ids) mgr.deleteConversation(id);

        const conv = mgr.createConversation('学习路径梳理');
        mgr.addMessage(conv.id, 'user', '@[[机器学习基础]] 帮我制定学习计划');
        mgr.addMessage(conv.id, 'assistant', [
            '已读取 [[机器学习基础]] 的目录。建议按这个顺序：',
            '',
            '1. 线性回归与分类',
            '2. 神经网络基础',
            '3. 优化算法',
            '',
            '| 阶段 | 内容 | 时间 |',
            '| --- | --- | --- |',
            '| 入门 | 线性回归 | 第 1 周 |',
            '| 进阶 | 神经网络 | 第 2 周 |',
            '| 实战 | 项目练习 | 第 3 周 |',
            '',
            '```python',
            '# 快速验证环境',
            'import numpy as np',
            'print(np.__version__)',
            '```',
            '',
            '要不要我把计划存成一篇新笔记？',
        ].join('\n'));
        mgr.addMessage(conv.id, 'user', '好，存成笔记吧');
        mgr.addMessage(conv.id, 'assistant', '已创建「学习计划.md」，包含上面三个阶段。随时可以继续调整。');
        mgr.flush?.();
        return conv.id;
    });
}

async function main() {
    const browser = await chromium.connectOverCDP(ENDPOINT);
    const page = await findMainPage(browser);
    console.log('主窗口:', await page.title());

    // 设置窗口尺寸(面板 544×827) + 隐藏 Obsidian 状态栏(避免混入截图底部)
    await page.setViewportSize({ width: WIN_W, height: WIN_H });
    await page.evaluate(() => {
        const sb = document.querySelector('.status-bar');
        if (sb) sb.style.display = 'none';
    });
    await page.waitForTimeout(500);

    // ================= 图②:对话工作流 =================
    const convId = await injectDemoConversation(page);
    if (!convId) { console.error('✗ 注入对话失败'); await browser.close(); process.exit(1); }
    await resetRightPanel(page);
    await page.evaluate((cid) => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (mgr && typeof mgr.switchTo === 'function') mgr.switchTo(cid);
    }, convId);
    await page.waitForTimeout(600);
    await resetRightPanel(page);
    await page.waitForTimeout(1000);
    await page.locator('.workbuddian-chat-container').screenshot({ path: OUT_DEMO });
    console.log('图②(对话工作流)已截图:', OUT_DEMO);

    // ================= 图③:@ 引用聚合 + 对话历史 + chips =================
    // 注入演示 MCP + Agent 配置(改插件内存态 settings,下拉会实时读)
    await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        if (!p) return;
        p.settings.customAgentsJson = JSON.stringify({
            reviewer: { description: '代码审查', prompt: '你是代码审查员' },
            writer: { description: '写作助手', prompt: '你是写作专家' },
        });
        p.settings.mcpServersJson = JSON.stringify([
            { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
            { name: 'fetch', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
        ]);
    });
    // 注入一段简短对话历史(展示上下文连贯),然后重开面板
    const atConvId = await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (!mgr) return null;
        const existing = mgr.getAll();
        const ids = Array.isArray(existing) ? existing.map((c) => (c && c.id) || c) : [];
        for (const id of ids) mgr.deleteConversation(id);
        const conv = mgr.createConversation('会议纪要整理');
        mgr.addMessage(conv.id, 'user', '@[[RAG 检索增强生成]] 帮我整理这篇笔记的要点');
        mgr.addMessage(conv.id, 'assistant', '已读取笔记。核心是检索增强生成：**检索**相关文档 → **增强**上下文 → **生成**回答。');
        mgr.flush?.();
        return conv.id;
    });
    await page.evaluate(() => {
        const app = window.app;
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach((l) => l.detach());
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        const p = window.app?.plugins?.plugins?.workbuddian;
        if (p && typeof p.activateView === 'function') p.activateView();
    });
    await page.waitForTimeout(1500);
    const container = page.locator('.workbuddian-chat-container');
    await container.waitFor({ state: 'visible', timeout: 15_000 });

    // 先刷新视图让对话历史完整渲染
    await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        if (p && typeof p.refreshOpenViews === 'function') p.refreshOpenViews();
    });
    await page.waitForTimeout(800);

    // 注入引用 chip + 附件 chip(操纵 view 实例),此时视图已就绪
    await page.evaluate((cid) => {
        const app = window.app;
        const leaves = app?.workspace?.getLeavesOfType?.('workbuddian-panel') || [];
        const view = leaves[0]?.view;
        if (!view) return;
        // 确保切到注入的对话
        const mgr = app?.plugins?.plugins?.workbuddian?.manager
            || app?.plugins?.plugins?.workbuddian?.conversationManager;
        if (mgr && typeof mgr.switchTo === 'function') mgr.switchTo(cid);
        // 引用 chip:输入框填入 @[[笔记]] 并派发 input,oninput 自动渲染
        view.inputEl.value = '@[[微调与对齐]] @[[机器学习基础]]';
        view.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        // 附件 chip:注入 attachments + 手动构造 DOM(仿真实渲染)
        view.attachments.push('/demo-vault/ogenda-2.md');
        if (view.attachChipsEl) {
            view.attachChipsEl.removeClass?.('workbuddian-hidden');
            const chip = view.attachChipsEl.createDiv?.({ cls: 'workbuddian-ref-chip' });
            if (chip) {
                chip.createSpan({ cls: 'workbuddian-ref-chip-name', text: 'ogenda-2.md' });
                const close = chip.createSpan({ cls: 'workbuddian-ref-chip-close' });
                close.setAttr?.('aria-label', '移除附件');
            }
        }
    }, atConvId);
    await page.waitForTimeout(1000);

    // 临时放宽 chip 宽度让文件名完整显示(仅影响截图,不改产品代码)
    await page.evaluate(() => {
        const style = document.createElement('style');
        style.id = 'wb-shot-chip-width';
        style.textContent = '.workbuddian-ref-chip { max-width: 160px !important; }';
        document.head.appendChild(style);
    });
    await page.waitForTimeout(200);

    await container.screenshot({ path: OUT_AT });
    console.log('图③(对话历史 + chips)已截图:', OUT_AT);

    await browser.close();
}

main().catch((e) => {
    console.error('✗ 截图失败:', e.message);
    process.exit(1);
});
