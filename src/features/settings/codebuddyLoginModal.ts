import { App, Modal, Notice } from 'obsidian';
import type WorkbuddianPlugin from '../../main';
import { CodebuddyProvider } from '../../providers/codebuddy';
import { resolveCodebuddyPath } from '../../utils/cliPath';
import {
    codebuddyLoginSupport, startCodebuddyLoginServer, waitForCodebuddyLogin, type CodebuddyLoginServer,
} from '../../shared/codebuddyLogin';
import { getErrorMessage } from '../../types';
import { t } from '../../i18n';

/** 在系统浏览器中打开 CodeBuddy 登录页（Obsidian 桌面版优先用 Electron shell） */
function openExternal(url: string): void {
    try {
        const electron = require('electron') as {
            shell?: { openExternal(target: string): Promise<void> | void };
        };
        if (electron.shell?.openExternal) { void electron.shell.openExternal(url); return; }
    } catch { /* 非 Electron 环境回落 window.open */ }
    window.open(url, '_blank');
}

/**
 * 傻瓜式登录：启动官方 CLI 的临时 Web UI → 自动打开浏览器登录页 →
 * 轮询 ACP 登录状态 → 成功后重启 provider。
 */
export class CodebuddyLoginModal extends Modal {
    private server: CodebuddyLoginServer | null = null;
    private readonly abort = new AbortController();
    private closed = false;
    private statusEl: HTMLElement | null = null;
    private openButton: HTMLButtonElement | null = null;

    constructor(app: App, private readonly plugin: WorkbuddianPlugin, private readonly onClosed?: () => void) {
        super(app);
    }

    onOpen(): void {
        void this.start();
    }

    onClose(): void {
        this.closed = true;
        this.abort.abort();
        const server = this.server;
        this.server = null;
        if (server) void server.dispose();
        this.contentEl.empty();
        this.onClosed?.();
    }

    private setStatus(text: string): void {
        this.statusEl?.setText(text);
    }

    private async start(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: t('login.title') });

        // 不能一键登录时只给说明和关闭：不显示“浏览器会自动打开”和永远点不动的按钮（#17）
        const cli = resolveCodebuddyPath(this.plugin.settings.codebuddyPath);
        const support = codebuddyLoginSupport(cli);
        if (support !== 'official') {
            contentEl.createEl('p', { text: t(support === 'workbuddy' ? 'login.workbuddyBundled' : 'login.needOfficial') });
            contentEl.createDiv({ cls: 'wb-login-actions' })
                .createEl('button', { text: t('login.close') }).onclick = () => this.close();
            return;
        }

        contentEl.createEl('p', { text: t('login.desc') });
        this.statusEl = contentEl.createEl('p', { cls: 'wb-login-status', text: t('login.starting') });
        const actions = contentEl.createDiv({ cls: 'wb-login-actions' });
        actions.createEl('button', { text: t('login.cancel') }).onclick = () => this.close();

        const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath;
        if (!vaultPath) { this.setStatus(t('login.noVault')); return; }

        try {
            this.server = await startCodebuddyLoginServer({
                cliPath: cli,
                nodePath: this.plugin.settings.nodePath,
                cwd: vaultPath,
                signal: this.abort.signal,
            });
            if (this.closed) { await this.server.dispose(); this.server = null; return; }

            // 登录服务就绪后才出现“重新打开登录页”，此前没有可打开的页面
            this.openButton = actions.createEl('button', { text: t('login.open'), cls: 'mod-cta', prepend: true });
            this.openButton.onclick = () => { if (this.server) openExternal(this.server.url); };
            this.setStatus(t('login.waiting'));
            openExternal(this.server.url); // 自动弹浏览器；按钮作为兜底

            await waitForCodebuddyLogin(this.server.endpoint, vaultPath, {
                authToken: this.server.authToken,
                signal: this.abort.signal,
                onProgress: () => this.setStatus(t('login.waiting')),
            });
            if (this.closed) return;

            this.setStatus(t('login.success'));
            new Notice(t('login.success'), 8_000);
            const api = this.plugin.api;
            if (api instanceof CodebuddyProvider) {
                api.restartProcess(); // 旧进程可能仍缓存“未登录”
                void api.refreshAvailableModels(vaultPath)
                    .then(() => this.plugin.refreshOpenViews())
                    .catch(() => { /* 模型列表失败不阻塞登录成功提示 */ });
            }
            window.setTimeout(() => this.close(), 1_000);
        } catch (error) {
            if (this.closed || this.abort.signal.aborted) return;
            this.setStatus(`${t('login.failed')}${getErrorMessage(error)}`);
        } finally {
            if (this.closed || this.abort.signal.aborted) {
                const server = this.server;
                this.server = null;
                await server?.dispose();
            }
        }
    }
}
