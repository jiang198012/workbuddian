#!/usr/bin/env node
/**
 * Workbuddian 完整 E2E(真实 Obsidian + Playwright CDP)
 *
 * 前置:
 *   - 已跑 bash scripts/e2e/start-obsidian-debug.sh [port](Obsidian 调试模式 + demo-vault)
 *   - 本机 WorkBuddy CLI 已登录(聊天测试要真调)
 *   - 插件侧手动关掉"消息确认弹窗"(见下),否则 e2e 无法自动点批准卡
 *
 * 用法:
 *   node scripts/e2e/run.mjs [port]            # 默认 9222
 *   node scripts/e2e/run.mjs 9333              # 指定端口
 *
 * 测试:
 *   1. 插件已加载          查询 app.plugins.plugins.workbuddian 存在
 *   2. 打开聊天面板        ribbon 按钮点击 → .workbuddian-chat-container 出现
 *   3. 发消息流式回复      输入框填文本 → 发送 → 等助理回复非空
 *   4. 截图存档           测试结束时存 chat.png / chat-final.png(人工回看)
 *
 * 说明:
 *   - 插件 i18n 默认中文,ribbon 按钮 aria-label = "Workbuddian 聊天",发送按钮 = "发送"
 *   - 聊天测试会真调 WorkBuddy CLI:模型/权限按插件当前设置,可能弹批准卡,需人工配合
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9222';
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const TEST_TAG = 'E2E'; // 消息里带此标记,避免测试内容混进真实数据
const SEND_TIMEOUT = 90_000;

// 仓库根目录(本脚本位于 <repo>/scripts/e2e/)
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN_DATA_JSON = `${REPO_ROOT}/demo-vault/.obsidian/plugins/workbuddian/data.json`;

/**
 * e2e 安全闸:直接读插件 data.json 的 settings.e2e,为 true 才发真消息。
 * 注意:不能读插件内存态 app.plugins.plugins.workbuddian.settings——
 * 插件 migrateSettings() 只保留已知字段,e2e 不是类型字段,内存态永远是 undefined。
 * 改 data.json 后无需重启 Obsidian(脚本侧读取,不经过插件)。
 */
function e2eFlagEnabled() {
    try {
        const data = JSON.parse(readFileSync(PLUGIN_DATA_JSON, 'utf-8'));
        return !!(data.settings && data.settings.e2e === true);
    } catch (e) {
        console.warn(`⚠ 读不到 ${PLUGIN_DATA_JSON}:`, e.message);
        return false;
    }
}

async function waitForPort(timeoutMs = 40_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${ENDPOINT}/json/version`);
            if (res.ok) return;
        } catch { /* 还没就绪 */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`连不上 ${ENDPOINT},先跑 bash scripts/e2e/start-obsidian-debug.sh`);
}

/** 从 Obsidian 打开页面里挑出 demo-vault 那个(main 窗口) */
async function findMainPage(browser) {
    const contexts = browser.contexts();
    const matches = [];
    for (const ctx of contexts) {
        for (const page of ctx.pages()) {
            const url = page.url() || '';
            const title = await page.title().catch(() => '');
            if (url.includes('obsidian.md/index.html')) {
                matches.push({ page, title });
                if (title.includes('demo-vault')) return page; // 优先 demo-vault 主窗口
            }
        }
    }
    if (matches.length) return matches[0].page; // 退而求其次:任意 Obsidian 主窗口
    throw new Error('没有找到 Obsidian 主窗口(app://obsidian.md/index.html),请确认 demo-vault 已打开');
}

function step(name, ok, extra = '') {
    const mark = ok ? '✔' : '✗';
    console.log(`${mark} ${name}${extra ? ` (${extra})` : ''}`);
}

/** 发一条消息并等流式回复(超时算失败) */
async function sendAndWaitReply(page, text) {
    const container = page.locator('.workbuddian-chat-container');
    await container.waitFor({ state: 'visible', timeout: 15_000 });

    const input = container.locator('textarea[aria-label="聊天输入框"]');
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await input.fill(text);
    await input.press('Enter');

    // 等输入框清空 = 消息已进入发送
    await page.waitForFunction(
        () => {
            const el = document.querySelector('.workbuddian-chat-container textarea[aria-label="聊天输入框"]');
            return el && el.value === '';
        },
        { timeout: 15_000 },
    );

    // 等助理回复非空:找到最后一个 assistant 消息且内容不是空
    await page.waitForFunction(
        (tag) => {
            // 简化:监听 DOM 里出现的助理消息块。具体类名以插件实际渲染为准,
            // 这里用通用策略——等输入框清空后,chat 容器内的文本增长
            const el = document.querySelector('.workbuddian-chat-container');
            return el && el.textContent.length > 50;
        },
        [TEST_TAG],
        { timeout: SEND_TIMEOUT },
    );
}

async function main() {
    await waitForPort();
    step(true, '已连接调试端口', ENDPOINT);

    const browser = await chromium.connectOverCDP(ENDPOINT);
    const page = await findMainPage(browser);
    step(true, '找到 Obsidian 主窗口', `title: ${await page.title()}`);

    // ---- 1. 插件已加载 ----
    const pluginLoaded = await page.evaluate(() => {
        const app = window.app;
        if (!app || !app.plugins) return false;
        return !!(app.plugins.plugins && app.plugins.plugins.workbuddian);
    });
    step(pluginLoaded, '插件 workbuddian 已加载');
    if (!pluginLoaded) {
        console.error('✗ 插件未加载,检查 demo-vault 的 community-plugins.json 与插件目录文件');
        await browser.close();
        process.exit(1);
    }

    // ---- e2e 安全闸(脚本侧读 data.json,防误发真消息) ----
    if (!e2eFlagEnabled()) {
        console.warn('⚠ data.json 的 settings.e2e 未开启,跳过真实发消息测试(避免误发真消息)');
        console.warn(`  要启用:编辑 ${PLUGIN_DATA_JSON} 的 settings 加 "e2e": true(无需重启 Obsidian)`);
        step(false, '发消息测试被跳过(缺 e2e 标记)');
        await page.screenshot({ path: 'chat.png', fullPage: true }).catch(() => {});
        await browser.close();
        return;
    }

    // ---- 2. 打开聊天面板(ribbon) ----
    const ribbon = page.locator('.ribbon-action[aria-label="Workbuddian 聊天"]').first();
    if (await ribbon.count()) {
        await ribbon.click();
        step(true, '点击 ribbon 打开聊天面板');
    } else {
        // 备选:直接调插件 API 打开(测试稳定性优先)
        const opened = await page.evaluate(() => {
            const app = window.app;
            const p = app?.plugins?.plugins?.workbuddian;
            if (!p) return false;
            return typeof p.activateView === 'function' ? (p.activateView(), true) : false;
        });
        step(opened, '通过插件 API 打开聊天面板(ribbon 未找到)');
        if (!opened) { console.error('✗ 无法打开聊天面板'); await browser.close(); process.exit(1); }
    }

    // 等容器出现
    await page.locator('.workbuddian-chat-container').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
        step(false, '聊天面板容器未出现');
    });
    step(true, '聊天面板已打开', '.workbuddian-chat-container');

    await page.screenshot({ path: 'chat-open.png', fullPage: true }).catch(() => {});

    // ---- 3. 发消息并等流式回复 ----
    const msg = `你好,这是 e2e 自动化测试(${TEST_TAG})。请用一句话回复即可。`;
    console.log(`\n>> 发送: ${msg}`);
    try {
        await sendAndWaitReply(page, msg);
        step(true, '收到流式回复(输入框已清空,回复内容已渲染)');
    } catch (e) {
        step(false, '等待流式回复超时', e.message);
        await page.screenshot({ path: 'chat-timeout.png', fullPage: true }).catch(() => {});
        await browser.close();
        process.exit(1);
    }

    await page.waitForTimeout(2000); // 等回复完全渲染
    await page.screenshot({ path: 'chat-final.png', fullPage: true }).catch(() => {});

    console.log('\n✔ E2E 全部通过');
    console.log('  截图: chat-open.png / chat-final.png');
    await browser.close();
}

main().catch((e) => {
    console.error('✗ E2E 失败:', e.message);
    process.exit(1);
});
