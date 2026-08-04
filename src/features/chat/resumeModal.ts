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
    onOpen() {
        const { contentEl } = this;
        new Setting(contentEl).setName(t('resume.modalTitle')).setHeading();

        const conversations = this.view.manager.getAll(); // 已按 updatedAt 倒序
        if (conversations.length === 0) {
            contentEl.createEl('p', { text: t('resume.empty') });
            return;
        }

        const now = Date.now();
        const list = contentEl.createDiv({ cls: 'workbuddian-resume-list' });
        for (const conv of conversations) {
            const { title, meta } = formatConversationSummary(conv, now);
            const item = list.createDiv({ cls: 'workbuddian-resume-item', attr: { role: 'button', tabindex: '0' } });
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
