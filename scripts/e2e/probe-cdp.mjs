#!/usr/bin/env node
/**
 * CDP 连接探针(e2e 第一步可行性验证)
 *
 * 连接 Obsidian 的 DevTools 端口,列出所有渲染进程 target。
 * 能列出 Obsidian 页面 = 调试端口可用,Playwright 驱动真实 UI 的方案成立。
 *
 * 用法:
 *   1) bash scripts/e2e/start-obsidian-debug.sh          # 启动 Obsidian 调试模式
 *   2) node scripts/e2e/probe-cdp.mjs [port]             # 默认 9222
 */
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9222';
const ENDPOINT = `http://127.0.0.1:${PORT}`;

async function waitForPort(timeoutMs = 40_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${ENDPOINT}/json/version`);
            if (res.ok) return;
        } catch { /* 端口还没起来,继续等 */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`等待 ${timeoutMs / 1000}s 后仍连不上 ${ENDPOINT},确认 Obsidian 已用调试模式启动`);
}

try {
    await waitForPort();
    const browser = await chromium.connectOverCDP(ENDPOINT);
    const contexts = browser.contexts();
    console.log(`✔ 已连接 ${ENDPOINT}(${contexts.length} 个 context)`);

    let found = 0;
    for (const ctx of contexts) {
        for (const page of ctx.pages()) {
            const title = await page.title().catch(() => '(取标题失败)');
            const url = page.url() || '(空 URL,可能是 DevTools/后台页)';
            console.log(`  - ${url}\n    title: ${title}`);
            found++;
        }
    }

    if (found === 0) {
        console.warn('⚠ 连接成功但没有页面——Obsidian 可能还在启动中,稍后重跑本脚本');
    } else {
        console.log(`✔ 发现 ${found} 个 target,调试端口可用。接下来可以跑完整 e2e。`);
    }
    await browser.close();
} catch (e) {
    console.error('✗ 探针失败:', e.message);
    process.exit(1);
}
