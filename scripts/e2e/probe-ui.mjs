#!/usr/bin/env node
/**
 * UI 体检脚本(UX 提升前奏)——在真实 Obsidian 里抓取面板的客观布局数据
 *
 * 用途:不靠截图(我这边读不了图),用 DOM 探针采集数值,发现布局/溢出/挤压等
 * 真实问题。跑完把输出贴回给我,我据此生成 UX 改进候选清单。
 *
 * 前置:Obsidian 调试模式已启动(demo-vault 打开),聊天面板已打开(可先手动开)
 * 用法: node scripts/e2e/probe-ui.mjs [port]
 */
import { chromium } from 'playwright-core';

const PORT = process.argv[2] ?? '9222';
const ENDPOINT = `http://127.0.0.1:${PORT}`;

async function findMainPage(browser) {
    for (const ctx of browser.contexts()) {
        for (const page of ctx.pages()) {
            const url = page.url() || '';
            if (!url.includes('obsidian.md/index.html')) continue;
            const title = await page.title().catch(() => '');
            if (title.includes('demo-vault')) return page;
        }
    }
    throw new Error('没找到 demo-vault 主窗口');
}

async function main() {
    const browser = await chromium.connectOverCDP(ENDPOINT);
    const page = await findMainPage(browser);
    console.log(`=== UI 体检(${await page.title()}) ===`);

    // 先确保聊天面板可见:存在即用,不存在则走 API 打开
    const hasPanel = await page.locator('.workbuddian-chat-container').count();
    if (!hasPanel) {
        const opened = await page.evaluate(() => {
            const p = window.app?.plugins?.plugins?.workbuddian;
            if (!p?.activateView) return false;
            p.activateView();
            return true;
        });
        console.log(opened ? '> 面板不存在,已通过 API 打开' : '> 无法打开面板');
        await page.waitForTimeout(1500);
    }

    const data = await page.evaluate(() => {
        const container = document.querySelector('.workbuddian-chat-container');
        if (!container) return { error: '无 .workbuddian-chat-container' };

        const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && r.height > 0 };
        };
        const q = (sel) => container.querySelector(sel);
        const all = (sel) => Array.from(container.querySelectorAll(sel));

        const tabBar = q('.workbuddian-tab-bar');
        const messages = q('.workbuddian-messages');
        const inputArea = q('.workbuddian-input-area');
        const inputBox = q('.workbuddian-input-box');
        const toolbar = q('.workbuddian-input-toolbar');
        const modelBtn = q('.workbuddian-model-btn');
        const sendBtn = q('.workbuddian-send-btn');

        // 主题信息:Obsidian 亮色 = body.theme-light / moonstone,暗色 = body.theme-dark / obsidian
        const bodyClass = document.body.className;
        const theme = bodyClass.includes('theme-dark') ? 'dark' : bodyClass.includes('theme-light') ? 'light' : 'unknown';

        // 标签栏:标签数量 + 是否横向溢出(scrollWidth > clientWidth)
        const tabs = all('.workbuddian-tab');
        const tabTitles = tabs.map(t => (t.querySelector('.workbuddian-tab-title')?.textContent || '').slice(0, 18));

        // 消息区
        const rows = all('.workbuddian-message-row');
        const userBubbles = all('.workbuddian-message-user');
        const assistantBubbles = all('.workbuddian-message-assistant');
        const emptyChat = q('.workbuddian-empty-chat');
        const thinkingBlocks = all('.workbuddian-thinking-block');
        const toolsBlocks = all('.workbuddian-tools-block');
        const errorCards = all('.workbuddian-error-card');
        const approvalCards = all('.workbuddian-approval-card');
        const bashBlocks = all('.workbuddian-bash-block');
        const diffBlocks = all('.workbuddian-tool-diff');

        // 输入框
        const textarea = q('textarea.workbuddian-input');
        const chipsVisible = all('.workbuddian-ref-chips:not(.workbuddian-hidden)').length;

        // 工具栏控件
        const toolbarBtns = all('.workbuddian-toolbar-btn');
        const usageRingVisible = q('.workbuddian-usage-ring') && !q('.workbuddian-usage-ring')?.classList.contains('workbuddian-hidden');

        return {
            theme,
            bodyClass,
            container: rect(container),
            tabBar: rect(tabBar),
            tabCount: tabs.length,
            tabTitles,
            tabBarOverflow: tabBar ? tabBar.scrollWidth > tabBar.clientWidth + 2 : null,
            messages: rect(messages),
            msgScroll: messages ? { clientH: messages.clientHeight, scrollH: messages.scrollHeight, atBottom: messages.scrollHeight - messages.scrollTop - messages.clientHeight < 30 } : null,
            inputArea: rect(inputArea),
            inputBox: rect(inputBox),
            toolbar: rect(toolbar),
            modelBtn: rect(modelBtn),
            modelBtnText: modelBtn?.textContent || '',
            sendBtn: rect(sendBtn),
            inputToolbarOverflow: toolbar ? toolbar.scrollWidth > toolbar.clientWidth + 2 : null,
            // 输入框内容高度 vs 可视高度(自动增高是否工作)
            textarea: textarea ? { scrollH: textarea.scrollHeight, clientH: textarea.clientHeight } : null,
            counts: {
                rows: rows.length, user: userBubbles.length, assistant: assistantBubbles.length,
                empty: !!emptyChat, thinking: thinkingBlocks.length, tools: toolsBlocks.length,
                error: errorCards.length, approval: approvalCards.length, bash: bashBlocks.length,
                diff: diffBlocks.length,
            },
            chipsVisible,
            toolbarBtnCount: toolbarBtns.length,
            usageRingVisible,
            // 空态文案(若有)
            emptyTitle: emptyChat?.querySelector('.workbuddian-empty-chat-title')?.textContent || '',
            emptySubtitle: emptyChat?.querySelector('.workbuddian-empty-chat-subtitle')?.textContent || '',
            // 最后一条消息的正文预览:只取正文容器(.workbuddian-markdown-content)的文本,
            // 排除思考块/工具块——整行 textContent 会把思考块 header("已思考▾")和思考 body
            // 也算进去,造成"思考泄漏"的假象(2026-08-09 体检踩坑)
            lastMessagePreview: (() => {
                const last = all('.workbuddian-message-row').pop();
                if (!last) return '';
                const md = last.querySelector('.workbuddian-markdown-content');
                const text = md ? (md.textContent || '') : (last.textContent || '');
                return text.slice(0, 120);
            })(),
            // 正文容器位置检查:应位于思考块/工具块之后(DOM 顺序正确 = 视觉顺序正确)
            lastMdPositionOk: (() => {
                const last = all('.workbuddian-message-row').pop();
                if (!last) return null; // 无消息
                const md = last.querySelector('.workbuddian-markdown-content');
                if (!md) return 'no-md'; // 该消息无正文(如纯工具轮)
                const thinking = last.querySelector('.workbuddian-thinking-block');
                const tools = last.querySelector('.workbuddian-tools-block');
                const blocks = [thinking, tools].filter((el) => el instanceof HTMLElement);
                if (blocks.length === 0) return 'no-blocks';
                const lastBlock = blocks[blocks.length - 1];
                return md.compareDocumentPosition(lastBlock) & Node.DOCUMENT_POSITION_FOLLOWING;
            })(),
        };
    });

    console.log(JSON.stringify(data, null, 2));

    // 少量可读结论
    if (data.tabBarOverflow) console.log('\n⚠ 标签栏横向溢出(标签多时):', data.tabTitles.join(' | '));
    if (data.inputToolbarOverflow) console.log('\n⚠ 输入工具栏溢出(控件被挤出)');
    if (data.modelBtn && data.modelBtnText && data.modelBtn.w < 30) console.log(`\n⚠ 模型按钮被压缩到 ${data.modelBtn.w}px(文本 "${data.modelBtnText}")`);
    if (data.counts.rows === 0) console.log('\nℹ 当前对话无消息(空态)');
    console.log('\n✔ 体检完成。把以上输出贴回给我。');

    await browser.close();
}

main().catch((e) => { console.error('✗ 体检失败:', e.message); process.exit(1); });
