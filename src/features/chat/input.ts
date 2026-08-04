import { Menu, Notice, setIcon, setTooltip, TFile } from 'obsidian';
import { getErrorMessage, DEFAULT_CONTEXT_WINDOW_SIZE } from '../../types';
import { extractAtQuery, parseAtReferences, removeAtReference } from '../../shared/atReferences';
import { parseAgentNames, parseMcpServerNames } from '../../shared/mentionSources';
import { shouldSendMessage, isActivationKey, nextSuggestIndex } from '../../shared/inputKeys';
import { assembleContextText } from '../../core/context/assembleContext';
import type { WorkbuddianChatView } from './view';
import { renderMessages, renderMarkdownContent, scrollToBottom } from './render';
import { renderTabs, createNewChat } from './tabs';
import { parseSlashCommand, extractSlashQuery, filterSlashCommands, commandNameFromPath, parseCommandFrontmatter, type SlashCommandInfo } from '../../shared/slashCommand';
import { fileBasename, buildAttachmentBlock, attachmentDirs } from '../../shared/attachments';
import { parseFileChange, type FileEdit } from '../../shared/toolDetail';
import { lineDiff, type DiffLine } from '../../shared/lineDiff';
import { renderDiffRows } from '../../shared/diffRows';
import { pickOptionId, type PermissionCardData, type PermissionDetail } from '../../providers/codebuddy/acp/permission';
import { extForMime, mimeForExt, pastedImageName, isImagePath, writeImageFile, pruneImages } from '../../shared/imageStore';
import { parseInstructionInput } from '../../shared/instruction';
import { openInstructionModal } from './instructionModal';
import { openResumeModal } from './resumeModal';
import { buildSelectionBlock } from '../../shared/selection';
import { pickFinalContent } from '../../shared/responseFinalize';
import { sanitizeTitle, shouldApplyAutoTitle } from '../../shared/autoTitle';
import { PERMISSION_MODE_CHOICES, type PermissionMode } from '../../shared/cliOptions';
import { contextPercent, usageTooltip, isUsageWarning } from '../../shared/contextUsage';
import { t } from '../../i18n';
import { bbLog } from '../../shared/logBuffer';

/** 补全下拉当前的条目列表（@ 与斜杠命令共用同一个下拉容器） */
function suggestItems(view: WorkbuddianChatView): HTMLElement[] {
    return Array.from(view.atSuggestEl.querySelectorAll<HTMLElement>('.workbuddian-at-suggest-item'));
}

/** 关闭补全下拉并复位高亮 */
export function closeSuggest(view: WorkbuddianChatView) {
    view.atSuggestEl.addClass('workbuddian-hidden');
    view.atSuggestEl.empty();
    view.suggestIndex = -1;
}

/** 把第 idx 项设为高亮项（并滚入可视区）；idx 为 -1 表示无高亮 */
export function highlightSuggest(view: WorkbuddianChatView, idx: number) {
    view.suggestIndex = idx;
    suggestItems(view).forEach((el, i) => {
        el.toggleClass('workbuddian-at-suggest-active', i === idx);
        if (i === idx) el.scrollIntoView({ block: 'nearest' });
    });
}

export function adjustTextareaHeight(view: WorkbuddianChatView) {
    view.inputEl.style.setProperty('--workbuddian-input-height', `${view.inputEl.scrollHeight}px`);
}

export function updateAtSuggest(view: WorkbuddianChatView) {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const state = extractAtQuery(view.inputEl.value, cursorPos);
    if (!state) {
        view.atSuggestEl.addClass('workbuddian-hidden');
        view.atSuggestEl.empty();
        return;
    }

    const query = state.query.toLowerCase();
    // 四源聚合：子代理 / MCP 服务器（均读设置 JSON）→ vault 文件；统一渲染保证键盘高亮索引不错位
    const entries: Array<{ label: string; pick: () => void }> = [];
    for (const name of parseAgentNames(view.settings.customAgentsJson).filter(n => n.toLowerCase().includes(query))) {
        entries.push({ label: `@Agents/${name}`, pick: () => insertTextMention(view, name) });
    }
    for (const name of parseMcpServerNames(view.settings.mcpServersJson).filter(n => n.toLowerCase().includes(query))) {
        entries.push({ label: `@mcp/${name}`, pick: () => insertTextMention(view, name) });
    }
    const files = view.app.vault.getFiles()
        .filter(f => f.name.toLowerCase().includes(query))
        .slice(0, 8);
    for (const file of files) {
        entries.push({ label: file.name, pick: () => insertAtReference(view, file) });
    }

    view.atSuggestEl.empty();
    if (entries.length === 0) {
        view.atSuggestEl.addClass('workbuddian-hidden');
        return;
    }
    view.atSuggestEl.removeClass('workbuddian-hidden');
    entries.forEach((entry, i) => {
        const item = view.atSuggestEl.createDiv({ cls: 'workbuddian-at-suggest-item', text: entry.label });
        item.onclick = entry.pick;
        // 鼠标移入即同步键盘高亮到该项，避免 hover 与 active 各自为政导致回车插错项（见 I5）
        item.onmouseenter = () => highlightSuggest(view, i);
    });
    highlightSuggest(view, 0); // 默认高亮首项，回车即可选中
}

/** 插入子代理/MCP 提及：纯文本 @name（CLI 侧经提示词识别；外部目录维持附件+批准卡方案） */
function insertTextMention(view: WorkbuddianChatView, name: string) {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const state = extractAtQuery(view.inputEl.value, cursorPos);
    if (state) {
        const { start } = state;
        const value = view.inputEl.value;
        let end = start + 1;
        while (end < value.length && !/[\s\]]/.test(value[end])) {
            end++;
        }
        const insertion = `@${name} `;
        view.inputEl.value = value.slice(0, start) + insertion + value.slice(end);
        const newCursorPos = start + insertion.length;
        view.inputEl.setSelectionRange(newCursorPos, newCursorPos);
        view.inputEl.focus();
    }
    closeSuggest(view);
    adjustTextareaHeight(view);
}

export function insertAtReference(view: WorkbuddianChatView, file: TFile) {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const state = extractAtQuery(view.inputEl.value, cursorPos);
    if (state) {
        const { start } = state;
        const value = view.inputEl.value;
        let end = start + 1;
        while (end < value.length && !/[\s\]]/.test(value[end])) {
            end++;
        }
        const before = value.slice(0, start);
        const after = value.slice(end);
        if (file.extension === 'md') {
            // markdown 笔记：插入 @[[名]]，由 buildReferenceBlock 读正文
            const insertion = `@[[${file.basename}]] `;
            view.inputEl.value = before + insertion + after;
            const newCursorPos = before.length + insertion.length;
            view.inputEl.setSelectionRange(newCursorPos, newCursorPos);
        } else {
            // 非 md：清掉正在输入的 @query，改为加附件（绝对路径交 CLI 读）
            view.inputEl.value = before + after;
            view.inputEl.setSelectionRange(before.length, before.length);
            const abs = `${view.vaultPath}/${file.path}`;
            if (!view.attachments.includes(abs)) view.attachments.push(abs);
            renderAttachmentChips(view);
        }
        view.inputEl.focus();
    }

    closeSuggest(view);
    renderReferenceChips(view);
    adjustTextareaHeight(view);
}

/** 渲染输入框上方的引用 chips（textarea 里 @[[...]] 的可视镜像 + 删除入口） */
export function renderReferenceChips(view: WorkbuddianChatView) {
    const names = parseAtReferences(view.inputEl.value);
    view.chipsEl.empty();
    if (names.length === 0) {
        view.chipsEl.addClass('workbuddian-hidden');
        return;
    }
    view.chipsEl.removeClass('workbuddian-hidden');
    for (const name of names) {
        const chip = view.chipsEl.createDiv({ cls: 'workbuddian-ref-chip' });
        chip.createSpan({ cls: 'workbuddian-ref-chip-name', text: name });
        const close = chip.createSpan({ cls: 'workbuddian-ref-chip-close', attr: { 'aria-label': t('input.removeReference'), role: 'button', tabindex: '0' } });
        setIcon(close, 'x');
        close.onclick = () => removeReference(view, name);
        close.onkeydown = (e: KeyboardEvent) => {
            if (isActivationKey(e.key)) {
                e.preventDefault();
                removeReference(view, name);
            }
        };
    }
}

/** 渲染附件 chips：图片显示缩略图，其它显示文件名；均带 ✕ 删除 */
export function renderAttachmentChips(view: WorkbuddianChatView) {
    view.attachChipsEl.empty();
    if (view.attachments.length === 0) {
        view.attachChipsEl.addClass('workbuddian-hidden');
        return;
    }
    view.attachChipsEl.removeClass('workbuddian-hidden');
    view.attachments.forEach((p, idx) => {
        const chip = view.attachChipsEl.createDiv({ cls: 'workbuddian-ref-chip' });
        if (isImagePath(p)) {
            chip.addClass('workbuddian-image-chip');
            const img = chip.createEl('img', {
                cls: 'workbuddian-image-thumb',
                attr: { alt: fileBasename(p), title: p },
            });
            img.src = thumbSrc(view, p);
        } else {
            chip.createSpan({ cls: 'workbuddian-ref-chip-name', text: fileBasename(p), attr: { title: p } });
        }
        const close = chip.createSpan({ cls: 'workbuddian-ref-chip-close', attr: { 'aria-label': t('input.removeReference'), role: 'button', tabindex: '0' } });
        setIcon(close, 'x');
        const removeAttachment = () => {
            view.attachments.splice(idx, 1);
            renderAttachmentChips(view);
        };
        close.onclick = removeAttachment;
        close.onkeydown = (e: KeyboardEvent) => {
            if (isActivationKey(e.key)) {
                e.preventDefault();
                removeAttachment();
            }
        };
    });
}

/** vault 外文件的 data URL 缓存：读盘 + base64 编码较重，避免每次全量重渲染都重做 */
const thumbCache = new Map<string, string>();

const MAX_THUMB_SOURCE_BYTES = 5 * 1024 * 1024; // 超过 5MB 不内联，降级为文件名 chip

/** 缩略图源：vault 内文件用 Obsidian 资源路径（轻量，不缓存），vault 外文件读盘转 data URL（缓存）；失败或过大返回空串 */
export function thumbSrc(view: WorkbuddianChatView, absPath: string): string {
    const base = view.vaultPath;
    if (base && absPath.startsWith(base)) {
        const rel = absPath.slice(base.length).replace(/^[\\/]/, '');
        return view.app.vault.adapter.getResourcePath(rel);
    }
    const cached = thumbCache.get(absPath);
    if (cached !== undefined) return cached;
    let result = '';
    try {
        const fs = require('fs');
        if (fs.statSync(absPath).size <= MAX_THUMB_SOURCE_BYTES) {
            const buf = fs.readFileSync(absPath) as Buffer;
            const ext = require('path').extname(absPath);
            result = `data:${mimeForExt(ext)};base64,${buf.toString('base64')}`;
        }
    } catch {
        result = '';
    }
    thumbCache.set(absPath, result);
    return result;
}

/**
 * 撤销一次 Edit 改动：直接读盘找 newText 出现处替换回 oldText 再写回。
 * 找不到 newText 说明文件已被后续改动，直接跳过，不做危险的猜测替换（不按行号/模糊匹配）。
 * newText 在文件中出现不止一次时同样跳过——CLI 只保证 old_string 唯一，new_string 没有唯一性
 * 保证，若替换了错误的那一处，会一次操作制造两处错误却仍报告"成功"（见 C2）。
 */
function undoEdit(change: FileEdit, btn: HTMLButtonElement) {
    try {
        const fs = require('fs');
        const content = fs.readFileSync(change.path, 'utf8') as string;
        const idx = content.indexOf(change.newText);
        if (idx === -1) {
            new Notice(t('tool.undoStale'));
            return;
        }
        if (idx !== content.lastIndexOf(change.newText)) {
            new Notice(t('tool.undoAmbiguous'));
            return;
        }
        const reverted = content.slice(0, idx) + change.oldText + content.slice(idx + change.newText.length);
        fs.writeFileSync(change.path, reverted, 'utf8');
        btn.disabled = true;
        btn.setText(t('tool.undone'));
        // aria-label 存在时会作为元素的可访问名覆盖文本内容，title 也不会随 setText 变化——
        // 两者不跟着更新，GUI 自动化按可访问名读到的、屏幕阅读器读到的都仍是「撤销此修改」（见 I6）
        btn.setAttribute('title', t('tool.undone'));
        btn.setAttribute('aria-label', t('tool.undone'));
        btn.addClass('workbuddian-tool-diff-undone');
        new Notice(t('tool.undone')); // 按钮就地变文案不够显眼，补一条全局提示
    } catch {
        new Notice(t('tool.undoFailed'));
    }
}

/**
 * ACP 权限请求 → 气泡内批准卡（复用 v1.5.0 卡片样式体系）：Write→路径+行数、Edit→路径+diff 预览、
 * Bash→命令全文；DeferExecuteTool 特化为「计划已就绪」。点击即 respondPermission 应答 CLI；
 * 卡片应答后留存供回看（批准历史），悬挂卡在面板关闭/切会话/卸载时由 view 统一答 reject。
 */
async function renderApprovalCard(view: WorkbuddianChatView, container: HTMLElement, data: PermissionCardData): Promise<void> {
    const card = container.createDiv({ cls: 'workbuddian-approval-card workbuddian-approval-card-pending' });
    card.createDiv({
        cls: 'workbuddian-approval-card-title',
        text: data.isPlanApproval ? t('approval.planReady') : `${t('approval.title')}: ${data.toolName}`,
    });
    if (data.detail.kind !== 'plan') {
        // 计划正文已作为 message chunk 流在上方气泡，无需在卡里重复
        renderApprovalDetail(card.createDiv({ cls: 'workbuddian-approval-card-body' }), data.detail);
    }

    const actions = card.createDiv({ cls: 'workbuddian-approval-card-actions' });
    const rejectId = pickOptionId(data.options, 'reject') ?? 'reject';
    view.pendingApprovals.set(data.requestId, rejectId);
    const defs: Array<{ label: string; kind: 'allow_once' | 'allow_always' | 'reject'; resolved: string; cta?: boolean }> = data.isPlanApproval
        ? [
            { label: t('approval.execute'), kind: 'allow_once', resolved: t('approval.resolvedAllow'), cta: true },
            { label: t('approval.alwaysExecute'), kind: 'allow_always', resolved: t('approval.resolvedAlways') },
            { label: t('approval.cancel'), kind: 'reject', resolved: t('approval.resolvedReject') },
        ]
        : [
            { label: t('approval.allow'), kind: 'allow_once', resolved: t('approval.resolvedAllow'), cta: true },
            { label: t('approval.alwaysAllow'), kind: 'allow_always', resolved: t('approval.resolvedAlways') },
            { label: t('approval.reject'), kind: 'reject', resolved: t('approval.resolvedReject') },
        ];
    let responded = false;
    for (const def of defs) {
        const btn = actions.createEl('button', { text: def.label, cls: def.cta ? 'mod-cta' : '' });
        btn.onclick = () => {
            if (responded) return;
            const optionId = pickOptionId(data.options, def.kind);
            if (!optionId) return;
            responded = true;
            view.pendingApprovals.delete(data.requestId);
            view.api.respondPermission(data.requestId, optionId);
            card.removeClass('workbuddian-approval-card-pending');
            actions.empty();
            card.createDiv({ cls: 'workbuddian-approval-card-resolved', text: def.resolved });
        };
    }
}

function renderApprovalDetail(body: HTMLElement, detail: PermissionDetail): void {
    switch (detail.kind) {
        case 'write':
            body.setText(t('approval.writeLines').replace('{path}', detail.path).replace('{count}', String(detail.lines)));
            return;
        case 'edit': {
            body.createDiv({ cls: 'workbuddian-approval-card-path', text: detail.path });
            const diffEl = body.createDiv({ cls: 'workbuddian-tool-diff-body' });
            renderDiffRows(diffEl, lineDiff(detail.oldText, detail.newText));
            return;
        }
        case 'bash':
            body.createEl('pre', { cls: 'workbuddian-approval-card-cmd', text: detail.command });
            return;
        case 'generic':
            body.setText(detail.summary);
            return;
        default:
            return;
    }
}

/** CLI 为真相源：config_option_update 回流时同步工具栏与 settings（不回调 api.set*，避免回环） */
function applyToolbarConfig(view: WorkbuddianChatView, cfg: { mode?: string; model?: string; thoughtLevel?: string }): void {
    let changed = false;
    if (cfg.mode && (PERMISSION_MODE_CHOICES as readonly string[]).includes(cfg.mode) && cfg.mode !== view.settings.permissionMode) {
        view.settings.permissionMode = cfg.mode as PermissionMode;
        setIcon(view.permissionBtn, permissionIcon(view.settings.permissionMode));
        view.permissionBtn.setAttribute('title', `${t('input.permission')}: ${t('perm.' + view.settings.permissionMode)}`);
        changed = true;
    }
    if (cfg.model && cfg.model !== view.settings.model) {
        view.settings.model = cfg.model;
        view.containerEl.querySelector('.workbuddian-model-btn')?.setText(cfg.model);
        changed = true;
    }
    if (cfg.thoughtLevel && cfg.thoughtLevel !== view.settings.thoughtLevel) {
        view.settings.thoughtLevel = cfg.thoughtLevel;
        changed = true;
    }
    if (changed) void view.saveSettingsCallback();
}

/** 粘贴图存储目录：<vault>/.obsidian/plugins/workbuddian/pasted */
function pastedDir(view: WorkbuddianChatView): string {
    return `${view.vaultPath}/${view.app.vault.configDir}/plugins/workbuddian/pasted`;
}

/** 读取当前笔记编辑器的选中文字，存入 view.selection 并刷新选区 chip（无选区则清空） */
export function captureNoteSelection(view: WorkbuddianChatView) {
    const mv = view.lastMarkdownView;
    let text = '';
    try {
        text = mv?.editor?.getSelection() ?? '';
    } catch {
        text = '';
    }
    view.selection = text.trim() ? { text, note: mv?.file?.basename ?? '' } : null;
    renderSelectionChip(view);
}

/** 渲染选区 chip（笔记名 + 选区预览 + ✕ 移除）；无选区时隐藏 */
export function renderSelectionChip(view: WorkbuddianChatView) {
    view.selectionEl.empty();
    if (!view.selection) {
        view.selectionEl.addClass('workbuddian-hidden');
        return;
    }
    view.selectionEl.removeClass('workbuddian-hidden');
    const chip = view.selectionEl.createDiv({ cls: 'workbuddian-ref-chip workbuddian-selection-chip' });
    const icon = chip.createSpan({ cls: 'workbuddian-ref-chip-icon' });
    setIcon(icon, 'text-select');
    const preview = view.selection.text.replace(/\s+/g, ' ').trim().slice(0, 40);
    const label = view.selection.note ? `${view.selection.note}: ${preview}` : preview;
    chip.createSpan({ cls: 'workbuddian-ref-chip-name', text: label, attr: { title: view.selection.text } });
    // 实时镜像当前笔记选区，无手动 ✕：取消选择即消失
}

/**
 * 向屏幕阅读器播报一条消息。写入独立的视觉隐藏 live region，而非消息容器——后者每次
 * renderMessages 都会整体重建，挂 aria-live 会导致整段历史被反复朗读。
 * 先清空再写入，确保内容相同的连续两次播报也会被朗读（AT 靠内容变化触发）。
 */
export function announce(view: WorkbuddianChatView, text: string) {
    if (!view.liveRegionEl || !text) return;
    view.liveRegionEl.setText('');
    window.setTimeout(() => view.liveRegionEl.setText(text), 50);
}

/** 刷新工具栏的上下文用量圆环：无 usage 数据时隐藏，有则更新占比、悬停提示与警示态。
 *  窗口取值：用户改过 contextWindowSize 以用户值为准，否则用 CLI 上报的真实窗口（usage_update） */
export function renderContextUsage(view: WorkbuddianChatView, cliWindowSize?: number) {
    const usage = view.getActiveConversation()?.lastUsage;
    if (!usage) {
        view.usageEl.addClass('workbuddian-hidden');
        // 实际设上的是 Obsidian tooltip 与 aria-label（见下方），不是原生 title，
        // 这里清的应是它们本身，否则切到无 usage 的会话后仍留着上一个会话的用量文案
        setTooltip(view.usageEl, '');
        view.usageEl.removeAttribute('aria-label');
        return;
    }
    const userWindow = view.settings.contextWindowSize;
    const windowSize = userWindow !== DEFAULT_CONTEXT_WINDOW_SIZE
        ? userWindow
        : (cliWindowSize ?? view.cliWindowSize ?? userWindow);
    const percent = contextPercent(usage.inputTokens, windowSize);
    view.usageEl.removeClass('workbuddian-hidden');
    view.usageEl.style.setProperty('--workbuddian-usage-pct', String(percent));
    // 用 Obsidian 的 tooltip 而非原生 title：后者要鼠标悬停约 1 秒才弹，可发现性差；
    // aria-label 一并设上，供屏幕阅读器读取。
    const tip = `${t('input.contextUsage')} ${usageTooltip(usage.inputTokens, windowSize)}`;
    setTooltip(view.usageEl, tip);
    view.usageEl.setAttribute('aria-label', tip);
    view.usageEl.toggleClass('workbuddian-usage-warning', isUsageWarning(percent));
}

/**
 * 取所选文件的绝对路径。Electron ≥32（Obsidian 1.8+，当前已到 39）移除了 `File.path`，
 * 改用 `webUtils.getPathForFile`；老版本回退到 `File.path`。缺了这个兼容，`path` 恒为
 * undefined → 附件永远进不了 view.attachments → chip 不显示。
 */
function attachmentPath(f: File): string {
    const legacy = (f as File & { path?: string }).path;
    if (legacy) return legacy;
    try {
        const electron = require('electron') as { webUtils?: { getPathForFile?: (file: File) => string } };
        return electron.webUtils?.getPathForFile?.(f) ?? '';
    } catch {
        return '';
    }
}

/** 打开系统文件选择器挑任意文件，把绝对路径加入待发送附件 */
export function openAttachmentPicker(view: WorkbuddianChatView) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => {
        for (const f of Array.from(input.files || [])) {
            const p = attachmentPath(f);
            if (p && !view.attachments.includes(p)) view.attachments.push(p);
        }
        renderAttachmentChips(view);
    };
    input.click();
}

/** 粘贴：剪贴板里的图片落盘成文件加入附件；纯文本粘贴不拦截 */
export async function handlePaste(view: WorkbuddianChatView, e: ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const images = items.filter(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (images.length === 0) return; // 让默认文本粘贴发生
    e.preventDefault();
    const dir = pastedDir(view);
    for (const it of images) {
        const file = it.getAsFile();
        if (!file) continue;
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const seq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
            const name = pastedImageName(seq, extForMime(it.type));
            const p = writeImageFile(dir, bytes, name);
            if (!view.attachments.includes(p)) view.attachments.push(p);
        } catch {
            new Notice(t('input.imageSaveFailed'));
        }
    }
    pruneImages(dir, view.settings.pastedImageKeep);
    renderAttachmentChips(view);
}

/** 拖拽放下：文件（图片或其它）用其绝对路径加入附件 */
export function handleDrop(view: WorkbuddianChatView, e: DragEvent) {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    for (const f of files) {
        const p = attachmentPath(f);
        if (p && !view.attachments.includes(p)) view.attachments.push(p);
    }
    renderAttachmentChips(view);
}

/** 各 permission 模式的区分图标（完全访问＝盾牌内感叹号） */
const PERMISSION_MODE_ICONS: Record<PermissionMode, string> = {
    default: 'shield',
    plan: 'eye',
    acceptEdits: 'check',
    bypassPermissions: 'shield-alert'
};

/** 当前 permission 模式对应的按钮图标（未知模式回退盾牌） */
export function permissionIcon(mode: PermissionMode): string {
    return PERMISSION_MODE_ICONS[mode] ?? 'shield';
}

/** 弹出 permission 模式菜单（仅默认 / 完全访问），选中后写设置 + 灌 CLI + 换图标 + 持久化 */
export function openPermissionMenu(view: WorkbuddianChatView, btn: HTMLElement, evt: MouseEvent) {
    const menu = new Menu();
    for (const mode of PERMISSION_MODE_CHOICES) {
        menu.addItem(item => item
            .setTitle(t('perm.' + mode))
            .setIcon(permissionIcon(mode))
            .setChecked(view.settings.permissionMode === mode)
            .onClick(async () => {
                view.settings.permissionMode = mode;
                view.api.setPermissionMode(mode);
                setIcon(btn, permissionIcon(mode));
                btn.setAttribute('title', `${t('input.permission')}: ${t('perm.' + mode)}`);
                await view.saveSettingsCallback();
            }));
    }
    menu.showAtMouseEvent(evt);
}

/** 弹出模型选择菜单（供悬停/点击触发），选中后写设置 + 灌 CLI + 更新按钮文字 + 持久化 */
export function openModelMenu(view: WorkbuddianChatView, btn: HTMLElement) {
    const menu = new Menu();
    const models = ['auto', ...view.api.getAvailableModels()];
    for (const id of models) {
        menu.addItem(item => item
            .setTitle(id)
            .setChecked(view.settings.model === id)
            .onClick(async () => {
                view.settings.model = id;
                view.api.setModel(id);
                btn.setText(id);
                await view.saveSettingsCallback();
            }));
    }
    const rect = btn.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
}

/** 从 textarea 删除某条引用（点 chip 的 ✕）并刷新 chips */
export function removeReference(view: WorkbuddianChatView, name: string) {
    view.inputEl.value = removeAtReference(view.inputEl.value, name);
    renderReferenceChips(view);
    adjustTextareaHeight(view);
    view.inputEl.focus();
}

/** 输入 / 命令补全：命中返回 true（渲染命令候选，@ 补全不接管），否则 false */
export function updateSlashSuggest(view: WorkbuddianChatView): boolean {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const query = extractSlashQuery(view.inputEl.value, cursorPos);
    if (query === null) return false;

    void loadCustomCommands(view); // 后台刷新自定义命令缓存，供下次补全使用

    const q = query.toLowerCase();
    const matches = [
        ...filterSlashCommands(query),
        ...view.customCommands.filter(c => c.name.toLowerCase().startsWith(q)),
    ];
    view.atSuggestEl.empty();
    if (matches.length === 0) {
        view.atSuggestEl.addClass('workbuddian-hidden');
        return true;
    }
    view.atSuggestEl.removeClass('workbuddian-hidden');
    matches.forEach((cmd, i) => {
        const item = view.atSuggestEl.createDiv({ cls: 'workbuddian-at-suggest-item' });
        item.createSpan({ text: `/${cmd.name}` });
        item.createSpan({ cls: 'workbuddian-slash-cmd-desc', text: cmd.desc });
        item.onclick = () => insertSlashCommand(view, cmd.name);
        // 鼠标移入即同步键盘高亮到该项，避免 hover 与 active 各自为政导致回车插错项（见 I5）
        item.onmouseenter = () => highlightSuggest(view, i);
    });
    highlightSuggest(view, 0); // 默认高亮首项，回车即可选中
    return true;
}

/** 扫描 vault 下 .codebuddy/commands 内的命令 md，读 frontmatter，刷新自定义命令缓存 */
export async function loadCustomCommands(view: WorkbuddianChatView): Promise<void> {
    const prefix = '.codebuddy/commands/';
    const files = view.app.vault.getFiles().filter(f => f.path.startsWith(prefix) && f.extension === 'md');
    const cmds: SlashCommandInfo[] = [];
    for (const f of files) {
        const rel = f.path.slice(prefix.length);
        const content = await view.app.vault.read(f);
        const fm = parseCommandFrontmatter(content);
        cmds.push({ name: commandNameFromPath(rel), desc: fm.description || t('input.customCommand') });
    }
    view.customCommands = cmds;
}

export function insertSlashCommand(view: WorkbuddianChatView, name: string) {
    view.inputEl.value = `/${name} `;
    const pos = view.inputEl.value.length;
    view.inputEl.setSelectionRange(pos, pos);
    view.inputEl.focus();
    view.atSuggestEl.addClass('workbuddian-hidden');
    view.atSuggestEl.empty();
    adjustTextareaHeight(view);
}

/** 解析消息里所有 @[[笔记名]] 引用，读取笔记全文拼成独立的上下文区块 */
export async function buildReferenceBlock(view: WorkbuddianChatView, text: string): Promise<string> {
    const names = parseAtReferences(text);
    if (names.length === 0) return '';

    const parts: string[] = ['以下是消息中通过 @ 引用的笔记内容：', ''];
    for (const name of names) {
        const file = view.app.vault.getMarkdownFiles().find(f => f.basename === name);
        if (!file) {
            parts.push(`引用笔记「${name}」未找到，已跳过。`, '');
            continue;
        }
        const content = await view.app.vault.read(file);
        parts.push(`### ${name}`, content, '');
    }
    return parts.join('\n');
}

/** 生成"当前正在查看笔记"提示行；无活动笔记时返回空字符串 */
export function buildCurrentNoteLink(view: WorkbuddianChatView): string {
    const file = view.app.workspace.getActiveFile();
    if (!file) return '';
    return `当前正在查看笔记：《${file.basename}》（${file.path}）`;
}

export async function handleKeydown(view: WorkbuddianChatView, e: KeyboardEvent) {
    // Esc 关闭 @ / / 补全下拉；仅在下拉确实可见时拦截，避免吞掉 Obsidian 自身的 Esc 行为
    if (e.key === 'Escape' && !view.atSuggestEl.hasClass('workbuddian-hidden')) {
        e.stopPropagation();
        closeSuggest(view);
        return;
    }
    // 补全下拉打开时接管方向键与回车：否则回车会直接走发送，把「@」或「/xxx」当正文发出去
    if (!view.atSuggestEl.hasClass('workbuddian-hidden')) {
        const items = suggestItems(view);
        if (items.length > 0) {
            // 组字态（拼音选字）下方向键要留给输入法选候选，不能被这里拦截去移动补全高亮
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                highlightSuggest(view, nextSuggestIndex(view.suggestIndex, items.length, e.key === 'ArrowDown' ? 1 : -1));
                return;
            }
            // 用 shouldSendMessage 而非自行拼条件：它与「这次回车本来会发送消息」同一语义，
            // 也是这里唯一需要接管的场景——同时保证与其组字防护（isComposing + keyCode 229）
            // 完全一致，不会开出一条防护更弱的岔路（见 I4）
            if (shouldSendMessage(e)) {
                e.preventDefault();
                const idx = view.suggestIndex >= 0 && view.suggestIndex < items.length ? view.suggestIndex : 0;
                items[idx].click(); // 复用条目自身的插入逻辑
                return;
            }
        }
    }
    if (shouldSendMessage(e)) {
        e.preventDefault();
        await sendMessage(view);
    }
}

export async function sendMessage(view: WorkbuddianChatView) {
    if (view.isStreaming) return;

    const text = view.inputEl.value.trim();
    // 纯附件消息（粘贴图片后不打字直接发）也要能发出去，因此附件非空时不拦截
    if (!text && view.attachments.length === 0) return;

    // 指令模式：# 开头 → 打开常驻指令弹窗，不发送
    const instr = parseInstructionInput(text);
    if (instr !== null) {
        openInstructionModal(view, instr);
        return;
    }

    const slash = parseSlashCommand(text);
    if (slash?.name === 'clear') {
        // /clear：本地新建对话，不发 CLI
        await createNewChat(view);
        view.inputEl.value = '';
        adjustTextareaHeight(view);
        return;
    }
    if (slash?.name === 'resume' && slash.rest === '') {
        // /resume（不带参数）：本地弹出会话选择器，不发 CLI；带参数保持原透传行为
        view.inputEl.value = '';
        adjustTextareaHeight(view);
        openResumeModal(view);
        return;
    }

    view.inputEl.value = '';
    adjustTextareaHeight(view);
    renderReferenceChips(view);
    await sendText(view, text);
}

export async function sendText(view: WorkbuddianChatView, text: string, permissionModeOverride?: PermissionMode) {
    // 确保有活跃对话
    let conv = view.getActiveConversation();
    if (!conv) {
        conv = view.manager.createConversation();
        view.activeConvId = conv.id;
        renderTabs(view);
    }

    // 首次对话自动生成 sessionId，后续多轮对话保持上下文连贯
    if (!conv.sessionId) {
        conv.sessionId = view.api.generateId();
    }

    const isFirstExchange = conv.messages.length === 0;
    // 添加用户消息
    const convId = conv.id;
    // 存绝对路径（而非文件名），渲染层据此出缩略图；旧消息存的是文件名，由 isAbsolutePath 区分
    view.manager.addMessage(convId, 'user', text, [...view.attachments]);
    await renderMessages(view);

    // 创建 AI 消息占位，标记为等待回复中
    const aiMsg = view.manager.addMessage(convId, 'assistant', '');
    if (!aiMsg) return;

    view.streamingMsgId = aiMsg.id;
    view.isStreaming = true;
    setIcon(view.sendBtn, 'square');
    view.sendBtn.setAttribute('aria-label', t('input.stop'));
    view.sendBtn.setAttribute('title', t('input.stop'));
    await renderMessages(view);

    // 流式发送
    const slash = parseSlashCommand(text);
    let firstChunk = true;
    let thinkingContent = '';
    let textContent = '';
    let resultText = '';
    const chunkStats: Record<string, number> = {};
    const toolRows = new Map<string, HTMLElement>(); // toolCallId → 工具行（同 id 后续 chunk 就地更新）
    try {
        let contextText: string;
        let addDirs: string[] = [];
        // vault 内图片附件 → ACP 原生图片块（图片在前文本在后）；vault 外/读失败的退回路径注入
        const images: Array<{ data: string; mimeType: string }> = [];
        if (slash) {
            // 斜杠命令：原样透传，不注入 vault 前缀 / 笔记链接 / @引用
            contextText = text;
        } else {
            const referenceBlock = await buildReferenceBlock(view, text);
            const pathAttachments: string[] = [];
            for (const attachPath of view.attachments) {
                if (isImagePath(attachPath) && view.vaultPath && attachPath.startsWith(view.vaultPath)) {
                    try {
                        const rel = attachPath.slice(view.vaultPath.length).replace(/^[\\/]/, '');
                        const buf = await view.app.vault.adapter.readBinary(rel);
                        images.push({
                            data: Buffer.from(buf).toString('base64'),
                            mimeType: mimeForExt(attachPath.slice(attachPath.lastIndexOf('.'))),
                        });
                        continue;
                    } catch (e) {
                        bbLog('[WB] 图片读取失败，退回路径注入:', attachPath, e);
                    }
                }
                pathAttachments.push(attachPath);
            }
            const attachmentBlock = buildAttachmentBlock(pathAttachments);
            // v1 用这些目录拼 --add-dir 放开读取权限；v2（ACP）起 provider 忽略 addDirs（占位兼容），
            // vault 外文件 Read 改由 CLI 在 default 模式弹批准卡
            addDirs = attachmentDirs(pathAttachments);
            const selectionBlock = view.selection ? buildSelectionBlock(view.selection.text, view.selection.note) : '';
            const extraBlock = [referenceBlock, attachmentBlock, selectionBlock].filter(Boolean).join('\n\n---\n\n');
            const currentNoteLink = view.settings.injectCurrentNoteLink ? buildCurrentNoteLink(view) : '';
            contextText = assembleContextText(
                text, view.vaultPath, view.settings.injectVaultContext, currentNoteLink, extraBlock, view.settings.customInstruction
            );
            // 附件用完即清空；选区是实时镜像，取消选择才消失，这里不清
            if (view.attachments.length) {
                view.attachments = [];
                renderAttachmentChips(view);
            }
        }

        const streamingBubble = view.messageContainer.querySelector(
            `.workbuddian-message-assistant:last-child .workbuddian-bubble`
        );
        if (!(streamingBubble instanceof HTMLElement)) {
            throw new Error(t('input.bubbleNotFound'));
        }

        // 流式渲染节流：text chunk 只更新数据；DOM 渲染合并到 ≥150ms 节奏，流末强制 flush
        let lastDomRender = 0;
        let renderTimer: number | null = null;
        let rendering = false;
        let renderDirty = false;
        const pumpTextRender = async () => {
            if (rendering) { renderDirty = true; return; }
            rendering = true;
            do {
                renderDirty = false;
                lastDomRender = Date.now();
                await renderMarkdownContent(view, streamingBubble, textContent);
            } while (renderDirty);
            rendering = false;
        };
        const scheduleTextRender = () => {
            const wait = 150 - (Date.now() - lastDomRender);
            if (wait <= 0 && !rendering) { void pumpTextRender(); return; }
            if (renderTimer === null) {
                renderTimer = window.setTimeout(() => { renderTimer = null; void pumpTextRender(); }, Math.max(wait, 0));
            }
        };
        const flushTextRender = async () => {
            if (renderTimer !== null) { window.clearTimeout(renderTimer); renderTimer = null; }
            renderDirty = true;
            while (rendering) await new Promise((r) => window.setTimeout(r, 16));
            await pumpTextRender();
        };

        // ACP 旁路注册：批准卡渲染进当前 assistant 气泡区；用量/配置回流按会话 key 路由到本面板
        const sessionKey = conv.sessionId;
        const msgEl = streamingBubble.closest('.workbuddian-message-assistant');
        view.api.onPermissionRequest(sessionKey, (data) => {
            if (msgEl instanceof HTMLElement) void renderApprovalCard(view, msgEl as HTMLElement, data);
        });
        view.api.onUsage(sessionKey, (used, size) => {
            view.cliWindowSize = size;
            view.manager.setUsage(convId, { inputTokens: used });
            renderContextUsage(view, size);
        });
        view.api.onConfigUpdate(sessionKey, (cfg) => applyToolbarConfig(view, cfg));

        for await (const chunk of view.api.sendMessage(conv.sessionId, contextText, view.vaultPath, addDirs, permissionModeOverride, images)) {
            const bubble = streamingBubble;

            if (firstChunk) {
                firstChunk = false;
                // 移除思考指示器
                const thinking = bubble.querySelector('.workbuddian-thinking');
                if (thinking instanceof HTMLElement) {
                    thinking.addClass('workbuddian-thinking-fadeout');
                    await new Promise(r => window.setTimeout(r, 200));
                    thinking.remove();
                }
            }

            chunkStats[chunk.type] = (chunkStats[chunk.type] || 0) + 1;

            if (chunk.type === 'thinking') {
                thinkingContent += chunk.content;
                let block = bubble.querySelector('.workbuddian-thinking-block');
                if (!(block instanceof HTMLElement)) {
                    block = bubble.createDiv({ cls: 'workbuddian-thinking-block' });
                    const header = block.createDiv({ cls: 'workbuddian-thinking-header' });
                    const icon = header.createSpan({ cls: 'workbuddian-thinking-header-icon' });
                    setIcon(icon, 'sparkles');
                    header.createSpan({ cls: 'workbuddian-thinking-header-text', text: t('input.thinking') });
                    const chevron = header.createSpan({ cls: 'workbuddian-thinking-header-chevron', text: '▾' });

                    const bodyDiv = block.createDiv({ cls: 'workbuddian-thinking-body workbuddian-hidden' });
                    header.addEventListener('click', () => {
                        const hidden = bodyDiv.hasClass('workbuddian-hidden');
                        bodyDiv.toggleClass('workbuddian-hidden', !hidden);
                        chevron.textContent = hidden ? '▾' : '▸';
                    });
                }
                const body = block.querySelector('.workbuddian-thinking-body');
                if (body instanceof HTMLElement) {
                    body.setText(thinkingContent);
                }
            } else if (chunk.type === 'tool') {
                let toolsBlock = bubble.querySelector('.workbuddian-tools-block');
                if (!(toolsBlock instanceof HTMLElement)) {
                    toolsBlock = bubble.createDiv({ cls: 'workbuddian-tools-block' });
                    const hdr = toolsBlock.createDiv({
                        cls: 'workbuddian-tools-header',
                        attr: { role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-label': t('input.toolCallToggle') }
                    });
                    const icon = hdr.createSpan({ cls: 'workbuddian-tools-header-icon' });
                    setIcon(icon, 'wrench');
                    hdr.createSpan({ cls: 'workbuddian-tools-header-text', text: t('input.toolCall') });
                    const chevron = hdr.createSpan({ cls: 'workbuddian-tools-header-chevron', text: '▾' });

                    const toggleTools = () => {
                        const list = toolsBlock.querySelector('.workbuddian-tools-list');
                        if (list instanceof HTMLElement) {
                            const hidden = list.hasClass('workbuddian-hidden');
                            list.toggleClass('workbuddian-hidden', !hidden);
                            chevron.textContent = hidden ? '▾' : '▸';
                            hdr.setAttribute('aria-expanded', hidden ? 'true' : 'false');
                        }
                    };
                    hdr.addEventListener('click', toggleTools);
                    hdr.addEventListener('keydown', (e: KeyboardEvent) => {
                        if (isActivationKey(e.key)) {
                            e.preventDefault();
                            toggleTools();
                        }
                    });
                    toolsBlock.createDiv({ cls: 'workbuddian-tools-list workbuddian-hidden' });
                }
                const list = toolsBlock.querySelector('.workbuddian-tools-list');
                if (list instanceof HTMLElement) {
                    const toolName = chunk.toolName || '';
                    const toolDetail = chunk.toolDetail || '';
                    // completed chunk 的 toolDetail 是 JSON 快照：行文本只留路径，JSON 仅供 parseFileChange
                    const completedChange = chunk.toolStatus === 'completed' ? parseFileChange(toolName, toolDetail) : null;
                    const rowText = chunk.toolStatus === 'completed'
                        ? `${toolName} ${completedChange?.path ?? ''}`.trim()
                        : `${toolName} ${toolDetail}`.trim();
                    let iconName = 'wrench';
                    if (toolName.includes('read') || toolName.includes('查看') || toolName.includes('读取')) {
                        iconName = 'file-text';
                    } else if (toolName.includes('write') || toolName.includes('编辑') || toolName.includes('写入')) {
                        iconName = 'pencil';
                    } else if (toolName.includes('search') || toolName.includes('搜索') || toolName.includes('查找')) {
                        iconName = 'search';
                    }

                    let row: HTMLElement;
                    if (chunk.toolCallId && toolRows.has(chunk.toolCallId)) {
                        // 同一工具调用的后续 chunk：就地更新行文本，不新增行
                        row = toolRows.get(chunk.toolCallId)!;
                        row.querySelector('.workbuddian-tool-call-text')?.setText(rowText);
                    } else {
                        row = list.createDiv({ cls: 'workbuddian-tool-call' });
                        const icon = row.createSpan({ cls: 'workbuddian-tool-call-icon' });
                        setIcon(icon, iconName);
                        row.createSpan({ cls: 'workbuddian-tool-call-text', text: rowText });
                        if (chunk.toolCallId) toolRows.set(chunk.toolCallId, row);
                    }

                    // 终态：diff 预览 + 撤销按钮（v1 原路径复活）；dataset 幂等防重复 completed
                    if (completedChange && row.dataset.diffRendered !== '1') {
                        row.dataset.diffRendered = '1';
                        const change = completedChange;
                        const diffLines = change.kind === 'write'
                            ? lineDiff('', change.newText)
                            : lineDiff(change.oldText, change.newText);

                        const diffBlock = list.createDiv({ cls: 'workbuddian-tool-diff' });
                        // diff 跟在所属行之后（增量更新下行序与完成序可能交错）
                        list.insertBefore(diffBlock, row.nextSibling);
                        const diffHeader = diffBlock.createDiv({
                            cls: 'workbuddian-tool-diff-header',
                            attr: { role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-label': t('tool.diffToggle') }
                        });
                        diffHeader.createSpan({ text: `${t('tool.diffTitle')} ${fileBasename(change.path)}` });
                        const diffChevron = diffHeader.createSpan({ text: '▾' });

                        // 撤销按钮：仅 Edit（Write 无旧内容可回退）且目标在 vault 内才提供。
                        // newText === '' 时排除：这是纯删除操作，indexOf('') 恒返回 0，
                        // 无法区分「文件未变」与「已面目全非」，也没有任何锚点能定位当初删除的位置——
                        // 任何插入都是猜测，因此和 Write 一样归为不可安全回滚，不显示按钮。
                        if (change.kind === 'edit' && change.newText !== '' && view.vaultPath && change.path.startsWith(view.vaultPath)) {
                            const undoBtn = diffHeader.createEl('button', {
                                cls: 'workbuddian-tool-diff-undo',
                                text: t('tool.undo'),
                                attr: { title: t('tool.undo'), 'aria-label': t('tool.undo') }
                            });
                            undoBtn.addEventListener('click', (evt) => {
                                evt.stopPropagation(); // 别顺带触发 header 的展开/折叠
                                undoEdit(change, undoBtn);
                            });
                            undoBtn.addEventListener('keydown', (evt) => {
                                // Enter/Space 激活按钮时 keydown 会冒泡到 diffHeader，同样要挡掉，
                                // 否则键盘用户点一下撤销按钮会顺带把 diff 折叠/展开
                                if (isActivationKey(evt.key)) evt.stopPropagation();
                            });
                        }

                        const diffBody = diffBlock.createDiv({ cls: 'workbuddian-tool-diff-body workbuddian-hidden' });
                        renderDiffRows(diffBody, diffLines);

                        const toggleDiff = () => {
                            const hidden = diffBody.hasClass('workbuddian-hidden');
                            diffBody.toggleClass('workbuddian-hidden', !hidden);
                            diffChevron.textContent = hidden ? '▾' : '▸';
                            diffHeader.setAttribute('aria-expanded', hidden ? 'true' : 'false');
                        };
                        diffHeader.addEventListener('click', toggleDiff);
                        diffHeader.addEventListener('keydown', (e: KeyboardEvent) => {
                            if (isActivationKey(e.key)) {
                                e.preventDefault();
                                toggleDiff();
                            }
                        });
                    }

                    // Bash/Shell 终态：终端输出块（与 diff 互斥——Bash 本无 parseFileChange）
                    if (chunk.toolStatus === 'completed' && chunk.toolOutput
                        && (toolName === 'Bash' || toolName === 'Shell') && row.dataset.bashRendered !== '1') {
                        row.dataset.bashRendered = '1';
                        const bashBlock = list.createDiv({ cls: 'workbuddian-bash-block' });
                        const bashHeader = bashBlock.createDiv({
                            cls: 'workbuddian-tool-diff-header',
                            attr: { role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-label': t('tool.outputToggle') }
                        });
                        bashHeader.createSpan({ text: t('tool.output') });
                        const bashChevron = bashHeader.createSpan({ text: '▾' });
                        const bashBody = bashBlock.createDiv({ cls: 'workbuddian-bash-body workbuddian-hidden' });
                        bashBody.createEl('pre', { text: chunk.toolOutput });
                        const toggleBash = () => {
                            const hidden = bashBody.hasClass('workbuddian-hidden');
                            bashBody.toggleClass('workbuddian-hidden', !hidden);
                            bashChevron.textContent = hidden ? '▾' : '▸';
                            bashHeader.setAttribute('aria-expanded', hidden ? 'true' : 'false');
                        };
                        bashHeader.addEventListener('click', toggleBash);
                        bashHeader.addEventListener('keydown', (e: KeyboardEvent) => {
                            if (isActivationKey(e.key)) {
                                e.preventDefault();
                                toggleBash();
                            }
                        });
                        list.insertBefore(bashBlock, row.nextSibling);
                    }
                }
            } else if (chunk.type === 'text') {
                textContent += chunk.content;
                view.manager.updateMessage(convId, aiMsg.id, textContent, true);
                scheduleTextRender();
            } else if (chunk.type === 'error') {
                view.manager.setError(convId, aiMsg.id, chunk.content);
                new Notice(`${t('input.requestFailed')}: ${chunk.content}`);
            } else if (chunk.type === 'done') {
                // result 事件带的 token 用量 → 存入会话，供上下文指示器渲染（末尾 flush 持久化）
                if (chunk.usage) view.manager.setUsage(convId, chunk.usage);
                // result 事件里的最终文本作兜底：有些回复只在这里给正文，不走流式 text chunk
                if (chunk.content) {
                    resultText = chunk.content;
                }
            }
        }

        await flushTextRender(); // 流末兜底：确保 bubble 与 textContent 一致再进收尾
        const finalContent = pickFinalContent(textContent, thinkingContent, resultText);
        view.manager.updateMessage(convId, aiMsg.id, finalContent);

        let displayContent = finalContent;
        if (!finalContent) {
            // 诊断：本轮各类 chunk 计数 + result 文本长度，便于判断是纯工具轮/超时/真空回复
            bbLog('[WB] empty response — chunks:', JSON.stringify(chunkStats), '| resultLen:', resultText.length);
            displayContent = t('input.noResponse');
            view.manager.updateMessage(convId, aiMsg.id, displayContent);
        }

        // C1：这里不再整体 renderMessages——它会连带销毁本轮刚建好的工具行/diff/批准卡，
        // 且发生在 view.isStreaming 置假之前，批准卡按钮会因此等不到可用窗口。
        // text chunk 已经在流式过程中增量渲染进 bubble；只有最终内容退回到了 thinking/result
        // 兜底或上面的空态兜底文案时，bubble 里还没有对应内容，才需要在这里补渲染一次。
        if (!textContent) {
            await renderMarkdownContent(view, streamingBubble, displayContent);
        }

        // 清理占位的思考指示器：正常情况下已在首个 chunk 到达时移除（见上方 firstChunk 分支），
        // 这里是零 chunk（例如流式一开始就报错）场景的兜底
        const thinkingPlaceholder = streamingBubble.querySelector('.workbuddian-thinking');
        if (thinkingPlaceholder instanceof HTMLElement) {
            thinkingPlaceholder.remove();
        }
        const thinkingLabel = streamingBubble.querySelector('.workbuddian-thinking-header-text');
        if (thinkingLabel instanceof HTMLElement) {
            thinkingLabel.setText(t('input.thought'));
        }
        // renderMessages 原本顺带做的两件事，跳过它之后须显式补上：刷新用量圆环、滚到底部
        renderContextUsage(view);
        scrollToBottom(view);
        announce(view, `${t('a11y.newReply')}${displayContent}`);
        await view.manager.flush();
        // 自动标题：首轮且开关开 → 一次性辅助会话生成；用户已改名则不覆盖
        if (isFirstExchange && view.settings.autoTitle) void maybeAutoTitle(view, convId, text);
    } catch (error: unknown) {
        const message = getErrorMessage(error);
        view.manager.setError(convId, aiMsg.id, message);
        new Notice(`${t('input.requestFailed')}: ${message}`);
        await renderMessages(view);
        announce(view, `${t('input.requestFailed')}: ${message}`);
    } finally {
        view.isStreaming = false;
        view.streamingMsgId = null;
        setIcon(view.sendBtn, 'send');
        view.sendBtn.setAttribute('aria-label', t('input.send'));
        view.sendBtn.setAttribute('title', t('input.send'));
    }
}

/** 首轮结束后生成 AI 标题（一次性辅助会话）；失败静默保留 fallback，用户已改名不覆盖 */
async function maybeAutoTitle(view: WorkbuddianChatView, convId: string, userText: string) {
    try {
        let out = '';
        for await (const chunk of view.api.sendMessage(view.api.generateId(), t('chat.autoTitlePrompt') + userText, view.vaultPath)) {
            if (chunk.type === 'text') out += chunk.content;
        }
        const title = sanitizeTitle(out);
        const conv = view.manager.getById(convId);
        if (title && conv && shouldApplyAutoTitle(conv.title, userText)) {
            view.manager.renameConversation(convId, title);
            renderTabs(view);
        }
    } catch (e) {
        bbLog('[WB] 自动标题生成失败（忽略）:', e);
    }
}

/** 重试最近一次出错的发送：删最后一对 user+assistant，用同一 user 文本重发 */
export async function retryLastMessage(view: WorkbuddianChatView) {
    if (view.isStreaming) return;
    const conv = view.getActiveConversation();
    if (!conv) return;
    const text = view.manager.deleteLastExchange(conv.id);
    if (!text) return;
    await renderMessages(view);
    await sendText(view, text);
}

/** 打开 Workbuddian 设置页（Obsidian 私有 API，缺失时静默） */
export function openWorkbuddianSettings(view: WorkbuddianChatView) {
    const setting = (view.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
    setting?.open?.();
    setting?.openTabById?.('workbuddian');
}
