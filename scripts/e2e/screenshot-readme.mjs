#!/usr/bin/env node
/**
 * README 首图专用:连上调试中的 Obsidian(demo-vault),打开聊天面板,
 * 清空测试对话,截一张干净的 v2.1.0 新 UI 图(仅聊天面板,含空态快速开始 chips)。
 *
 * 用法:
 *   node scripts/e2e/screenshot-readme.mjs [port] [out]
 *     默认 port=9333, out=docs/images/screenshot.png
 *
 * 不触发任何真实消息(纯 UI 截图,无 e2e 安全闸依赖)。
 */
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9333';
const OUT = process.argv[3] ?? 'docs/images/screenshot.png';
const ENDPOINT = `http://127.0.0.1:${PORT}`;

async function findMainPage(browser) {
    for (const ctx of browser.contexts()) {
        for (const page of ctx.pages()) {
            const url = page.url() || '';
            if (url.includes('obsidian.md/index.html')) {
                const title = await page.title().catch(() => '');
                if (title.includes('demo-vault')) return page;
            }
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

    // 打开聊天面板(优先插件 API,稳定)
    await page.evaluate(() => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        if (p && typeof p.activateView === 'function') p.activateView();
    });
    await page.locator('.workbuddian-chat-container').waitFor({ state: 'visible', timeout: 15_000 });

    // 清空测试对话:直接调插件 ConversationManager 删除全部会话并刷新视图
    await page.evaluate(async () => {
        const app = window.app;
        const p = app?.plugins?.plugins?.workbuddian;
        if (!p) return;
        const mgr = p.conversationManager || p.manager;
        if (mgr && typeof mgr.getAll === 'function' && typeof mgr.deleteConversation === 'function') {
            const all = mgr.getAll();
            const ids = Array.isArray(all) ? all.map((c) => (c && c.id) || c) : [];
            for (const id of ids) {
                try { mgr.deleteConversation(id); } catch (e) { console.warn('删除失败', id, e.message); }
            }
        }
        if (mgr && typeof mgr.flush === 'function') {
            try { await mgr.flush(); } catch (e) { console.warn('flush 失败', e.message); }
        }
        if (p.refreshOpenViews) p.refreshOpenViews();
    });
    await page.waitForTimeout(800);

    // 如果面板还停在已删会话,强制重开面板(先 detach 再 activate)
    const stillStale = await page.evaluate(() => {
        const el = document.querySelector('.workbuddian-chat-container');
        if (!el) return false;
        const txt = el.textContent || '';
        // 空态特征:输入框存在但几乎无历史消息文本
        const hasOld = /e2e|测试|自动化/.test(txt);
        return hasOld;
    });
    if (stillStale) {
        await page.evaluate(() => {
            const p = window.app?.plugins?.plugins?.workbuddian;
            if (p && typeof p.refreshOpenViews === 'function') p.refreshOpenViews();
        });
        await page.waitForTimeout(600);
    }

    // 等空态渲染(建议 chips 出现)
    await page.locator('.workbuddian-chat-container').waitFor({ state: 'visible', timeout: 10_000 });

    // 只截聊天面板元素(不含 Obsidian 侧栏)
    const container = page.locator('.workbuddian-chat-container');
    await container.screenshot({ path: OUT });
    console.log('已截图:', OUT);
    await browser.close();
}

main().catch((e) => {
    console.error('✗ 截图失败:', e.message);
    process.exit(1);
});
