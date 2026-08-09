#!/usr/bin/env node
/**
 * 拟人化测试(computer-use 风格):以"真实用户点击/输入"驱动 Obsidian 里的 Workbuddian。
 * 覆盖 UI/交互/会话管理类用例;CLI 依赖项(批准/流式)标注跳过。
 *
 * 用法: node scripts/e2e/humanlike-test.mjs [port]
 */
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9333';
const results = [];
const report = (id, name, ok, extra = '') => {
    results.push({ id, name, ok, extra });
    console.log(`${ok ? '✔' : '✗'} [${id}] ${name}${extra ? ` — ${extra}` : ''}`);
};
const skip = (id, name, why) => {
    results.push({ id, name, ok: 'SKIP', extra: why });
    console.log(`⏭ [${id}] ${name} — 跳过: ${why}`);
};

async function main() {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    let page = null;
    for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('obsidian.md')) { page = p; break; }
    if (!page) { console.error('找不到 Obsidian 主窗口'); process.exit(1); }

    // 打开主面板(dual-pane)
    await page.evaluate(() => {
        const app = window.app;
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach(l => l.detach());
        app?.plugins?.plugins?.workbuddian?.activateMainPaneView?.();
    });
    await page.waitForTimeout(1500);

    // ---- A. 布局 ----
    report('A1', '主面板 dual-pane(左侧列表+右侧聊天)',
        await page.evaluate(() => !!document.querySelector('.workbuddian-sidebar') && !!document.querySelector('.workbuddian-main-pane')));
    report('A2', '左侧栏有 搜索框 + 新建按钮',
        await page.evaluate(() => !!document.querySelector('.workbuddian-sidebar-header .workbuddian-search-input')
            && !!document.querySelector('.workbuddian-sidebar-header .workbuddian-new-chat-btn')));

    // 侧栏(窄面板保持标签)
    await page.evaluate(() => {
        const app = window.app;
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach(l => l.detach());
        app?.plugins?.plugins?.workbuddian?.activateView?.();
    });
    await page.waitForTimeout(1200);
    report('A3', '侧栏窄面板保持顶部标签(无 dual-pane)',
        await page.evaluate(() => !document.querySelector('.workbuddian-sidebar')
            && getComputedStyle(document.querySelector('.workbuddian-tab-bar')).flexDirection === 'row'));

    // 回主面板
    await page.evaluate(() => {
        const app = window.app;
        app?.workspace?.getLeavesOfType?.('workbuddian-panel').forEach(l => l.detach());
        app?.plugins?.plugins?.workbuddian?.activateMainPaneView?.();
    });
    await page.waitForTimeout(1200);

    // ---- B. 会话管理 ----
    // 用唯一会话名(时间戳)避免跨轮测试状态污染
    const tag = `拟人${Date.now() % 100000}`;
    // 新建对话
    await page.evaluate((name) => {
        const p = window.app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager;
        const c = mgr.createConversation(name);
        mgr.addMessage(c.id, 'user', '测试消息');
        mgr.flush?.();
    }, tag);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.app?.plugins?.plugins?.workbuddian?.refreshOpenViews?.());
    await page.waitForTimeout(800);
    report('B1', '新建会话出现在列表',
        await page.evaluate((name) => Array.from(document.querySelectorAll('.workbuddian-tab-title')).some(t => t.textContent?.includes(name)), tag));

    // 置顶
    await page.evaluate((name) => {
        const p = window.app?.plugins?.plugins?.workbuddian;
        const mgr = p?.manager;
        const c = mgr.getAll().find(x => x.title === name);
        if (c) mgr.togglePinned(c.id);
        mgr.flush?.();
    }, tag);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.app?.plugins?.plugins?.workbuddian?.refreshOpenViews?.());
    await page.waitForTimeout(800);
    report('B2', '置顶会话排最前 + 📌 标识',
        await page.evaluate((name) => {
            const first = document.querySelector('.workbuddian-tab');
            return first?.querySelector('.workbuddian-tab-pin') && first.textContent?.includes(name);
        }, tag));

    // 搜索过滤
    const search = page.locator('.workbuddian-sidebar-header .workbuddian-search-input');
    await search.fill(tag);
    await page.waitForTimeout(500);
    report('B3', '搜索过滤(只显示匹配会话)',
        await page.evaluate((name) => {
            const titles = Array.from(document.querySelectorAll('.workbuddian-tab-title')).map(t => t.textContent?.trim());
            return titles.length >= 1 && titles.every(t => t.includes(name));
        }, tag));
    await search.fill('');
    await page.waitForTimeout(400);

    // 删除确认(UI 层触发)
    const deleteResult = await page.evaluate((name) => {
        const tabs = Array.from(document.querySelectorAll('.workbuddian-tab'));
        const target = tabs.find(t => t.textContent?.includes(name));
        if (!target) return 'tab未找到';
        const close = target.querySelector('.workbuddian-tab-close');
        if (close) { close.dispatchEvent(new MouseEvent('click', { bubbles: true })); return '已点✕'; }
        return '✕未找到';
    }, tag);
    await page.waitForTimeout(400);
    report('B4', '删除弹出确认 Notice',
        await page.evaluate(() => {
            const notices = Array.from(document.querySelectorAll('.notice')).map(n => n.textContent || '');
            return notices.some(t => t.includes('确认删除'));
        }), deleteResult);

    // ---- C. 命令面板命令 ----
    const cmds = await page.evaluate(() => {
        const cmds = window.app?.commands?.commands ?? {};
        return Object.keys(cmds).filter(k => k.startsWith('workbuddian:'));
    });
    report('C1', '命令面板含 5 个增强命令',
        ['new-chat', 'edit-instruction', 'open-settings', 'export-current-chat', 'search-chats']
            .every(c => cmds.includes(`workbuddian:${c}`)));

    // ---- D. 模板 ----
    const input = page.locator('.workbuddian-chat-container textarea[aria-label="聊天输入框"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.click();
    await input.pressSequentially('/translate', { delay: 60 });
    await input.press('Enter');
    await page.waitForTimeout(400);
    report('D1', '/translate 填入翻译模板',
        await page.evaluate(() => {
            const ta = document.querySelector('.workbuddian-chat-container textarea[aria-label="聊天输入框"]');
            return ta?.value?.includes('翻译成中文') ?? false;
        }));
    await input.fill('');

    // ---- E. @stats 补全 ----
    await input.click();
    await input.pressSequentially('@st', { delay: 60 });
    await page.waitForTimeout(500);
    report('E1', '@st 弹出 @stats 补全',
        await page.evaluate(() => {
            const el = document.querySelector('.workbuddian-at-suggest');
            return el && !el.classList.contains('workbuddian-hidden')
                && Array.from(el.querySelectorAll('.workbuddian-at-suggest-item')).some(i => i.textContent?.includes('@stats'));
        }));
    await input.fill('');

    // ---- F. 模型菜单中文名(检查按钮文字) ----
    report('F1', '模型按钮显示中文名',
        await page.evaluate(() => {
            const btn = document.querySelector('.workbuddian-model-btn');
            return /[一-鿿]/.test(btn?.textContent ?? '');
        }));

    // ---- CLI 依赖项(标注跳过) ----
    skip('A4', '流式回复', 'CLI 未登录');
    skip('A5', '工具调用块', 'CLI 未登录');
    skip('B5', '批准卡 + 撤销', 'CLI 未登录');

    // 汇总
    const pass = results.filter(r => r.ok === true).length;
    const fail = results.filter(r => r.ok === false).length;
    const skips = results.filter(r => r.ok === 'SKIP').length;
    console.log(`\n=== 汇总: 通过 ${pass} / 失败 ${fail} / 跳过 ${skips} ===`);
    await browser.close();
    process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
