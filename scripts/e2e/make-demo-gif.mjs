#!/usr/bin/env node
/**
 * 生成 README 首屏宽幅演示 GIF(约 30 秒循环):
 *   宽幅布局(左侧笔记正文 + 右侧 Workbuddian 面板),动画展示
 *   "空态 → @引用下拉 → 选中 → AI 回答(列表/表格/代码块)→ 滚动浏览" 完整流程。
 *   帧数多、可循环播放,充分展示产品交互。
 *
 * 前置:Obsidian 已以 --remote-debugging-port 运行 demo-vault。
 * 用法: node scripts/e2e/make-demo-gif.mjs [port] [outDir]
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.argv[2] ?? '9333';
const OUT_DIR = process.argv[3] ?? 'docs/assets';
const FRAMES_DIR = join(OUT_DIR, '_gif-frames');
const ENDPOINT = `http://127.0.0.1:${PORT}`;

const FPS = 10;            // 输出帧率
const TARGET_MS = 30_000;  // 总时长 30 秒
const SCALE_W = 936;       // 输出宽度(等比缩放,约比原 720 宽 30%)

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
    // 清空旧帧
    rmSync(FRAMES_DIR, { recursive: true, force: true });
    mkdirSync(FRAMES_DIR, { recursive: true });

    const browser = await chromium.connectOverCDP(ENDPOINT);
    const page = await findMainPage(browser);
    console.log('主窗口:', await page.title());

    // 宽幅布局:窗口 1440×900,隐藏状态栏(源帧更高清)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { const sb = document.querySelector('.status-bar'); if (sb) sb.style.display='none'; });

    // 初始:左侧打开笔记正文,右侧空态面板
    await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager || p?.conversationManager;
        if (mgr) {
            const all = mgr.getAll();
            const ids = Array.isArray(all) ? all.map(c => c && c.id) : [];
            for (const id of ids) mgr.deleteConversation(id);
            mgr.flush?.();
        }
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach(l => l.detach());
        const file = app.vault.getAbstractFileByPath('微调与对齐.md');
        if (file) app.workspace.getLeaf(true).openFile(file);
        try { app.workspace.leftSplit.collapsed = true; } catch (e) {}
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        const p = window.app?.plugins?.plugins?.workbuddian;
        if (p?.activateView) p.activateView();
    });
    await page.locator('.workbuddian-chat-container').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(800);

    let frame = 0;
    // 帧时间轴(ms):手动安排各阶段,使总时长 ≈ 30s
    const timeline = [
        // 空态停留
        { ms: 3000, fn: async () => {} },
        // 输入 @,下拉弹出
        { ms: 2500, fn: async () => {
            const input = page.locator('.workbuddian-chat-container textarea[aria-label="聊天输入框"]');
            await input.click();
            await input.pressSequentially('@', { delay: 90 });
        } },
        // 下拉显示,稍停
        { ms: 2000, fn: async () => {} },
        // 选中 @[[机器学习基础]]
        { ms: 2000, fn: async () => {
            await page.evaluate(() => {
                const item = document.querySelector('.workbuddian-at-suggest-item');
                if (item) item.click();
            });
        } },
        // 注入对话 + 重建面板显示回答
        { ms: 4000, fn: async () => {
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
            await page.evaluate((cid) => {
                const app = window.app;
                const p = app?.plugins?.plugins?.workbuddian;
                const mgr = p?.manager || p?.conversationManager;
                if (mgr && typeof mgr.switchTo === 'function') mgr.switchTo(cid);
                app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach(l => l.detach());
            }, convId);
            await page.waitForTimeout(300);
            await page.evaluate(() => {
                const p = window.app?.plugins?.plugins?.workbuddian;
                if (p?.activateView) p.activateView();
            });
        } },
        // 回答渲染完成,停留
        { ms: 5000, fn: async () => {} },
        // 滚动浏览完整内容
        { ms: 6000, fn: async () => {
            const chat = page.locator('.workbuddian-chat-container');
            await chat.evaluate(el => {
                const scrollEl = el.querySelector('.workbuddian-messages');
                if (scrollEl) scrollEl.scrollTop = 0;
            });
            await page.waitForTimeout(300);
            await chat.evaluate(el => {
                const scrollEl = el.querySelector('.workbuddian-messages');
                if (scrollEl) {
                    const step = scrollEl.scrollHeight / 20;
                    let t = 0;
                    const ival = setInterval(() => {
                        scrollEl.scrollTop = Math.min(scrollEl.scrollHeight, (t++) * step);
                        if (t > 20) clearInterval(ival);
                    }, 150);
                }
            });
        } },
        // 停留展示完整
        { ms: 5000, fn: async () => {} },
    ];
    const totalMs = timeline.reduce((a, s) => a + s.ms, 0);
    console.log(`时间轴总时长: ${totalMs}ms (${(totalMs/1000).toFixed(1)}s)`);

    const shot = async (name) => {
        frame++;
        const f = join(FRAMES_DIR, `f${String(frame).padStart(4,'0')}.png`);
        // 宽幅:截整个窗口(含左侧笔记 + 右侧面板)
        await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1440, height: 900 } });
        return f;
    };

    // 按时间轴逐帧截图:每 100ms 一帧(10fps)
    for (const stage of timeline) {
        const fnResult = stage.fn();
        if (fnResult && typeof fnResult.then === 'function') await fnResult;
        const framesHere = Math.round(stage.ms / 100);
        for (let i = 0; i < framesHere; i++) {
            await shot(`stage@${stage.ms}ms`);
            await page.waitForTimeout(90);
        }
    }

    // 平滑循环:再回到空态一小段(可选,留空则直接 loop)
    await browser.close();
    console.log(`共 ${frame} 帧,实际时长 ${(frame*100/1000).toFixed(0)}s`);

    // ---- ffmpeg 合成 GIF(循环,调色板优化) ----
    const gifOut = join(OUT_DIR, 'workbuddian-demo.gif');
    execFileSync('ffmpeg', [
        '-y',
        '-framerate', String(FPS),
        '-i', join(FRAMES_DIR, 'f%04d.png'),
        '-filter_complex', `fps=${FPS},scale=${SCALE_W}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
        '-loop', '0',
        gifOut,
    ], { stdio: 'inherit' });
    console.log('✔ 宽幅 GIF 已生成:', gifOut);
    rmSync(FRAMES_DIR, { recursive: true, force: true });
}

main().catch((e) => {
    console.error('✗ GIF 生成失败:', e.message);
    process.exit(1);
});
