#!/usr/bin/env node
/**
 * 生成 README 首屏演示 GIF:
 *   连上调试中的 Obsidian,程序化驱动"打开面板 → @引用 → AI 回答(表格/代码块)"动画,
 *   逐帧截聊天面板,ffmpeg 合成 GIF。
 *
 * 前置:Obsidian 已以 --remote-debugging-port 运行 demo-vault。
 * 用法: node scripts/e2e/make-demo-gif.mjs [port] [outDir]
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.argv[2] ?? '9333';
const OUT_DIR = process.argv[3] ?? 'docs/assets';
const FRAMES_DIR = join(OUT_DIR, '_gif-frames');
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const FPS = 10; // 输出 GIF 帧率

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
    mkdirSync(FRAMES_DIR, { recursive: true });

    const browser = await chromium.connectOverCDP(ENDPOINT);
    const page = await findMainPage(browser);
    console.log('主窗口:', await page.title());

    // 布局:面板 544×827,隐藏状态栏
    await page.setViewportSize({ width: 1200, height: 867 });
    await page.evaluate(() => { const sb = document.querySelector('.status-bar'); if (sb) sb.style.display='none'; });

    // 先注入演示对话(用户 @引用 + AI 表格/代码块回答),再打开面板
    await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (!mgr) return;
        const existing = mgr.getAll();
        const ids = Array.isArray(existing) ? existing.map(c => c && c.id) : [];
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
            'import numpy as np',
            'print(np.__version__)',
            '```',
        ].join('\n'));
        mgr.flush?.();
    });

    let frame = 0;
    const shot = async (name) => {
        frame++;
        const f = join(FRAMES_DIR, `f${String(frame).padStart(4,'0')}.png`);
        await page.locator('.workbuddian-chat-container').screenshot({ path: f });
        console.log(`  帧 ${frame}: ${name} -> ${f}`);
        return frame;
    };

    // ---- 动画序列 ----

    // 1. 打开面板(空态),停留展示空态快速开始
    await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        // 清空对话让面板为空态
        if (mgr) {
            const all = mgr.getAll();
            const ids = Array.isArray(all) ? all.map(c => c && c.id) : [];
            for (const id of ids) mgr.deleteConversation(id);
            mgr.flush?.();
        }
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach(l => l.detach());
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
        const p = window.app?.plugins?.plugins?.workbuddian;
        if (p?.activateView) p.activateView();
    });
    for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(100);
        await shot(`空态打开 ${i}`);
    }

    // 2. 输入 @ 触发引用下拉
    const input = page.locator('.workbuddian-chat-container textarea[aria-label="聊天输入框"]');
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.click();
    await input.pressSequentially('@', { delay: 60 });
    for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(120);
        await shot(`引用下拉 ${i}`);
    }

    // 3. 选中 @[[机器学习基础]],引用 chip 出现
    await page.evaluate(() => {
        const item = document.querySelector('.workbuddian-at-suggest-item');
        if (item) item.click();
    });
    for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(120);
        await shot(`选中引用 ${i}`);
    }

    // 4. 显示 AI 回答(注入的演示对话:列表 + 表格 + 代码块)
    const convId = await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (!mgr) return null;
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
            'import numpy as np',
            'print(np.__version__)',
            '```',
        ].join('\n'));
        mgr.flush?.();
        return conv.id;
    });
    // 切换到新对话 + 强制重建面板(可靠渲染)
    await page.evaluate((cid) => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (mgr && typeof mgr.switchTo === 'function') mgr.switchTo(cid);
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach((l) => l.detach());
    }, convId);
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        const p = window.app?.plugins?.plugins?.workbuddian;
        if (p && typeof p.activateView === 'function') p.activateView();
    });
    for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(140);
        await shot(`回答渲染 ${i}`);
    }

    // 5. 滚动到底部看完整表格+代码块
    await page.evaluate(() => {
        const chat = document.querySelector('.workbuddian-chat-container');
        const scrollEl = chat?.querySelector('.workbuddian-messages');
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
    for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(120);
        await shot(`滚动到回答 ${i}`);
    }

    // 6. 停留展示
    await page.waitForTimeout(300);
    await shot('完整对话');
    await page.waitForTimeout(300);
    await shot('完整对话2');

    await browser.close();
    console.log(`共 ${frame} 帧`);

    // ---- ffmpeg 合成 GIF ----
    const gifOut = join(OUT_DIR, 'workbuddian-demo.gif');
    execFileSync('ffmpeg', [
        '-y',
        '-framerate', String(FPS),
        '-i', join(FRAMES_DIR, 'f%04d.png'),
        '-filter_complex', `fps=${FPS},scale=340:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
        gifOut,
    ], { stdio: 'inherit' });
    console.log('✔ GIF 已生成:', gifOut);
}

main().catch((e) => {
    console.error('✗ GIF 生成失败:', e.message);
    process.exit(1);
});
