import { Modal } from 'obsidian';
import type { WorkbuddianChatView } from './view';
import { switchToChat } from './tabs';
import { formatConversationSummary } from '../../shared/conversationSummary';
import { t } from '../../i18n';

class ResumeModal extends Modal {
    constructor(private view: WorkbuddianChatView) {
        super(view.app);
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: t('resume.modalTitle') });

        const conversations = this.view.manager.getAll(); // 已按 updatedAt 倒序
        if (conversations.length === 0) {
            contentEl.createEl('p', { text: t('resume.empty') });
            return;
        }

        const now = Date.now();
        const list = contentEl.createDiv({ cls: 'workbuddian-resume-list' });
        for (const conv of conversations) {
            const { title, meta } = formatConversationSummary(conv, now);
            const item = list.createDiv({ cls: 'workbuddian-resume-item' });
            item.createDiv({ cls: 'workbuddian-resume-item-title', text: title });
            item.createDiv({ cls: 'workbuddian-resume-item-meta', text: meta });
            item.onclick = async () => {
                await switchToChat(this.view, conv.id);
                this.close();
            };
        }
    }
    onClose() { this.contentEl.empty(); }
}

/** 打开 /resume 会话选择弹窗 */
export function openResumeModal(view: WorkbuddianChatView) {
    new ResumeModal(view).open();
}
