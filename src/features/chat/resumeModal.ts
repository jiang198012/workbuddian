import { Modal, Setting } from 'obsidian';
import type { WorkbuddianChatView } from './view';
import { switchToChat } from './tabs';
import { formatConversationSummary } from '../../shared/conversationSummary';
import { isActivationKey } from '../../shared/inputKeys';
import { t } from '../../i18n';

class ResumeModal extends Modal {
    constructor(private view: WorkbuddianChatView) {
        super(view.app);
    }
    private filterEl: HTMLInputElement | null = null;
    private listEl: HTMLElement | null = null;

    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setName(t('resume.modalTitle')).setHeading();

        // 搜索框:输入实时过滤会话列表(复用 manager.search)
        const searchSetting = new Setting(contentEl);
        this.filterEl = searchSetting.addText((text) => {
            text.setPlaceholder(t('resume.searchPlaceholder'));
            text.onChange((value) => this.renderList(value.trim()));
        }).controlEl.querySelector('input') as HTMLInputElement;

        this.listEl = contentEl.createDiv({ cls: 'workbuddian-resume-list' });
        this.renderList('');

        // 聚焦搜索框,方便直接输入
        setTimeout(() => this.filterEl?.focus(), 50);
    }

    /** 渲染会话列表(按搜索词过滤);空串显示全部 */
    private renderList(query: string) {
        const listEl = this.listEl;
        if (!listEl) return;
        listEl.empty();

        const conversations = query
            ? this.view.manager.search(query)
            : this.view.manager.getAll(); // 已按 updatedAt 倒序
        if (conversations.length === 0) {
            listEl.createEl('p', { cls: 'workbuddian-resume-empty', text: query ? t('resume.noResults') : t('resume.empty') });
            return;
        }

        const now = Date.now();
        for (const conv of conversations) {
            const { title, meta } = formatConversationSummary(conv, now);
            const item = listEl.createDiv({ cls: 'workbuddian-resume-item', attr: { role: 'button', tabindex: '0' } });
            item.createDiv({ cls: 'workbuddian-resume-item-title', text: title });
            item.createDiv({ cls: 'workbuddian-resume-item-meta', text: meta });
            const activate = async () => {
                await switchToChat(this.view, conv.id);
                this.close();
            };
            item.onclick = activate;
            item.onkeydown = (e: KeyboardEvent) => {
                if (isActivationKey(e.key)) {
                    e.preventDefault();
                    void activate();
                }
            };
        }
    }
    onClose() { this.contentEl.empty(); }
}

/** 打开 /resume 会话选择弹窗 */
export function openResumeModal(view: WorkbuddianChatView) {
    new ResumeModal(view).open();
}
