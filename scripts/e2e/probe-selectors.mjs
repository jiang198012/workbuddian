#!/usr/bin/env node
/**
 * E2E 选择器探测(手动运行,调试用)
 *
 * 在已连接的 Obsidian 里打印关键 UI 选择器是否成立:
 *   - 插件实例是否存在(app.plugins.plugins.workbuddian)
 *   - ribbon 按钮(Workbuddian 聊天)数量
 *   - 若聊天面板已开:.workbuddian-chat-container 数量、textarea 数量、发送按钮 aria-label
 *   - settings.e2e 当前值(控制 e2e 是否发真消息)
 *
 * 用法: node scripts/e2e/probe-selectors.mjs [port]
 */
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9222';
const ENDPOINT = `http://127.0.0.1:${PORT}`;

async function main() {
    const browser = await chromium.connectOverCDP(ENDPOINT);
    const contexts = browser.contexts();
    let found = false;

    for (const ctx of contexts) {
        for (const page of ctx.pages()) {
            if (!(page.url() || '').includes('obsidian.md/index.html')) continue;
            found = true;
            const title = await page.title().catch(() => '');
            console.log(`\n=== 窗口: ${title} ===`);

            const info = await page.evaluate(() => {
                const app = window.app;
                const p = app?.plugins?.plugins?.workbuddian;
                const result = { plugin: !!p };
                if (p) {
                    result.settingsE2e = p.settings ? p.settings.e2e : undefined;
                    result.activateView = typeof p.activateView;
                }
                return result;
            });
            console.log('插件实例:', info.plugin);
            if (info.plugin) {
                console.log('settings.e2e:', info.settingsE2e);
                console.log('activateView 类型:', info.activateView);
            }

            const ribbonCount = await page.locator('.ribbon-action[aria-label="Workbuddian 聊天"]').count();
            console.log('ribbon 按钮(Workbuddian 聊天)数量:', ribbonCount);

            const containerCount = await page.locator('.workbuddian-chat-container').count();
            console.log('.workbuddian-chat-container 数量:', containerCount);
            if (containerCount) {
                const ta = await page.locator('.workbuddian-chat-container textarea[aria-label="聊天输入框"]').count();
                const sendBtn = await page.locator('.workbuddian-chat-container button[aria-label="发送"]').count();
                console.log('  输入框 textarea:', ta);
                console.log('  发送按钮:', sendBtn);
            }
        }
    }

    if (!found) console.error('✗ 没找到 Obsidian 主窗口,先确认调试模式已启动');
    await browser.close();
}

main().catch((e) => { console.error('✗ 探测失败:', e.message); process.exit(1); });
