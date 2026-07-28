import { Menu, MarkdownRenderer, Notice, setIcon, setTooltip, TFile } from 'obsidian';
import { getErrorMessage } from '../../types';
import { extractAtQuery, parseAtReferences, removeAtReference } from '../../shared/atReferences';
import { shouldSendMessage, isActivationKey, nextSuggestIndex } from '../../shared/inputKeys';
import { assembleContextText } from '../../core/context/assembleContext';
import type { WorkbuddianChatView } from './view';
import { renderMessages, renderMarkdownContent, scrollToBottom } from './render';
import { renderTabs, createNewChat } from './tabs';
import { parseSlashCommand, extractSlashQuery, filterSlashCommands, commandNameFromPath, parseCommandFrontmatter, type SlashCommandInfo } from '../../shared/slashCommand';
import { fileBasename, buildAttachmentBlock, attachmentDirs } from '../../shared/attachments';
import { parseFileChange, isPlanFilePath, type FileEdit } from '../../shared/toolDetail';
import { lineDiff } from '../../shared/lineDiff';
import { extForMime, mimeForExt, pastedImageName, isImagePath, writeImageFile, pruneImages } from '../../shared/imageStore';
import { parseInstructionInput } from '../../shared/instruction';
import { openInstructionModal } from './instructionModal';
import { openResumeModal } from './resumeModal';
import { buildSelectionBlock } from '../../shared/selection';
import { pickFinalContent } from '../../shared/responseFinalize';
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
    const files = view.app.vault.getFiles()
        .filter(f => f.name.toLowerCase().includes(query))
        .slice(0, 8);

    view.atSuggestEl.empty();
    if (files.length === 0) {
        view.atSuggestEl.addClass('workbuddian-hidden');
        return;
    }
    view.atSuggestEl.removeClass('workbuddian-hidden');
    for (const file of files) {
        const item = view.atSuggestEl.createDiv({ cls: 'workbuddian-at-suggest-item', text: file.name });
        item.onclick = () => insertAtReference(view, file);
    }
    highlightSuggest(view, 0); // 默认高亮首项，回车即可选中
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
        btn.addClass('workbuddian-tool-diff-undone');
        new Notice(t('tool.undone')); // 按钮就地变文案不够显眼，补一条全局提示
    } catch {
        new Notice(t('tool.undoFailed'));
    }
}

/**
 * 计划模式下渲染计划卡片：CLI 提交计划走 DeferExecuteTool，在 --print 非交互模式下必被拒绝
 * （`permission prompts are not available in non-interactive mode`），原会话无法原生批准继续执行。
 * 「按此执行」因此不是「批准原计划」，而是把计划正文以 default 权限模式重新发起一轮；
 * 发送完毕（无论成功与否）都恢复用户此前的权限模式。
 */
async function renderPlanCard(view: WorkbuddianChatView, container: HTMLElement, planText: string): Promise<void> {
    const card = container.createDiv({ cls: 'workbuddian-plan-card' });
    card.createDiv({ cls: 'workbuddian-plan-card-title', text: t('plan.cardTitle') });
    const body = card.createDiv({ cls: 'workbuddian-plan-card-body' });
    await MarkdownRenderer.render(view.app, planText, body, '', view.markdownComponent);

    const actions = card.createDiv({ cls: 'workbuddian-plan-card-actions' });
    const executeBtn = actions.createEl('button', { text: t('plan.execute') });
    const dismissBtn = actions.createEl('button', { text: t('plan.dismiss') });
    card.createDiv({ cls: 'workbuddian-plan-card-note', text: t('plan.note') });

    executeBtn.onclick = async () => {
        // disabled 在任何 await 之前同步置位，挡「连点这个按钮本身」——sendText 内部要经过一次
        // await 才会把 isStreaming 置真，仅靠 isStreaming 挡不住这个窗口期内的第二次点击；
        // C1 修好之后气泡不再于流式结束时被整体销毁，按钮得以存活到本轮结束之后。
        // 因此 isStreaming 在这里恢复了它本来的意义：卡片可能在流式中途就渲染出来，
        // 此时点执行会嵌套调用 sendText——内层的 renderMessages 会摧毁外层仍在写入的气泡，
        // 且 provider 只跟踪一个 activeProc，Stop 只能杀掉两个并发进程中较新的那个。
        if (executeBtn.disabled || view.isStreaming) return;
        executeBtn.disabled = true;
        const prevMode = view.settings.permissionMode;
        // 用递增 epoch 而非「当前模式是否仍等于 default」判断"中途有没有人手动切换过权限模式"——
        // 后者在用户手动切到的目标恰好也叫 'default' 时会误判为"无人改动"从而错误覆盖用户的选择，
        // 造成内存与磁盘漂移（见 I1）
        const epochAtStart = view.permissionMenuEpoch;
        // 必须用 acceptEdits 而不是 default：default 是「每步询问」，而 --print 非交互模式下
        // 根本无从询问，写操作会被 CLI 直接拒绝（与 ExitPlanMode 被拒是同一原因），
        // 结果就是「点了执行、跑了一轮、文件却没动」。acceptEdits 自动接受编辑，
        // 语义上恰好对应「用户已经看过计划并批准了」，也比 bypassPermissions 保守。
        view.settings.permissionMode = 'acceptEdits';
        view.api.setPermissionMode('acceptEdits');
        try {
            await sendText(view, planText);
        } finally {
            if (view.permissionMenuEpoch === epochAtStart) {
                view.settings.permissionMode = prevMode;
                view.api.setPermissionMode(prevMode);
                // 恢复后顺带刷新工具栏图标，避免图标停留在执行计划期间的中间态
                setIcon(view.permissionBtn, permissionIcon(prevMode));
                view.permissionBtn.setAttribute('title', `${t('input.permission')}: ${t('perm.' + prevMode)}`);
            }
        }
    };
    dismissBtn.onclick = () => card.remove();
}

/** CLI 因 DeferExecuteTool（ExitPlanMode）被拒而返回的报错：计划卡片自带的说明已覆盖该情形，不再作为错误展示 */
function isDeferExecuteRejection(text: string): boolean {
    return text.includes('DeferExecuteTool') && text.includes('non-interactive');
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

/** 刷新工具栏的上下文用量圆环：无 usage 数据时隐藏，有则更新占比、悬停提示与警示态 */
export function renderContextUsage(view: WorkbuddianChatView) {
    const usage = view.getActiveConversation()?.lastUsage;
    if (!usage) {
        view.usageEl.addClass('workbuddian-hidden');
        view.usageEl.removeAttribute('title');
        return;
    }
    const windowSize = view.settings.contextWindowSize;
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
                // 用户手动选择权限模式：epoch 前进一格，供计划卡片「按此执行」判断
                // 「中途有没有人手动切换过」，不能靠比较模式值本身（见 I1）
                view.permissionMenuEpoch++;
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
    for (const cmd of matches) {
        const item = view.atSuggestEl.createDiv({ cls: 'workbuddian-at-suggest-item' });
        item.createSpan({ text: `/${cmd.name}` });
        item.createSpan({ cls: 'workbuddian-slash-cmd-desc', text: cmd.desc });
        item.onclick = () => insertSlashCommand(view, cmd.name);
    }
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
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                highlightSuggest(view, nextSuggestIndex(view.suggestIndex, items.length, e.key === 'ArrowDown' ? 1 : -1));
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
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

export async function sendText(view: WorkbuddianChatView, text: string) {
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
    let planCardRendered = false;
    let rejectionSwallowed = false;
    const chunkStats: Record<string, number> = {};
    try {
        let contextText: string;
        let addDirs: string[] = [];
        if (slash) {
            // 斜杠命令：原样透传，不注入 vault 前缀 / 笔记链接 / @引用
            contextText = text;
        } else {
            const referenceBlock = await buildReferenceBlock(view, text);
            const attachmentBlock = buildAttachmentBlock(view.attachments);
            // 放开 vault 外附件所在目录的读取权限（清空 view.attachments 前先算好）
            addDirs = attachmentDirs(view.attachments);
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

        for await (const chunk of view.api.sendMessage(conv.sessionId, contextText, view.vaultPath, addDirs)) {
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
                    let iconName = 'wrench';
                    if (toolName.includes('read') || toolName.includes('查看') || toolName.includes('读取')) {
                        iconName = 'file-text';
                    } else if (toolName.includes('write') || toolName.includes('编辑') || toolName.includes('写入')) {
                        iconName = 'pencil';
                    } else if (toolName.includes('search') || toolName.includes('搜索') || toolName.includes('查找')) {
                        iconName = 'search';
                    }

                    const row = list.createDiv({ cls: 'workbuddian-tool-call' });
                    const icon = row.createSpan({ cls: 'workbuddian-tool-call-icon' });
                    setIcon(icon, iconName);
                    row.createSpan({
                        cls: 'workbuddian-tool-call-text',
                        text: `${toolName} ${toolDetail}`.trim()
                    });

                    const change = parseFileChange(toolName, toolDetail);
                    if (change && change.kind === 'write' && isPlanFilePath(change.path)) {
                        // 计划模式下 CLI 把计划写到 ~/.codebuddy/plans/*.md：不渲染 diff，改渲染计划卡片；
                        // 计划卡片是主要操作入口，不能被折叠的工具列表挡住，渲染进 bubble 而非 list（见 C1）
                        await renderPlanCard(view, bubble, change.newText);
                        planCardRendered = true;
                    } else if (change) {
                        const diffLines = change.kind === 'write'
                            ? lineDiff('', change.newText)
                            : lineDiff(change.oldText, change.newText);

                        const diffBlock = list.createDiv({ cls: 'workbuddian-tool-diff' });
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
                            undoBtn.style.marginLeft = 'auto';
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
                        for (const line of diffLines) {
                            const prefix = line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  ';
                            diffBody.createDiv({
                                cls: `workbuddian-diff-line workbuddian-diff-${line.type}`,
                                text: prefix + line.text
                            });
                        }

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
                }
            } else if (chunk.type === 'text') {
                textContent += chunk.content;
                view.manager.updateMessage(convId, aiMsg.id, textContent, true);
                await renderMarkdownContent(view, bubble, textContent);
            } else if (chunk.type === 'error') {
                // 计划模式下 ExitPlanMode 被 CLI 拒绝的报错：计划卡片自带的说明已覆盖该情形，静默忽略；
                // 但记下"确实吞掉过一次拒绝"，供收尾时判断计划卡片是否真的渲染出来了（见 I2）
                if (isDeferExecuteRejection(chunk.content)) {
                    rejectionSwallowed = true;
                } else {
                    view.manager.setError(convId, aiMsg.id, chunk.content);
                    new Notice(`${t('input.requestFailed')}: ${chunk.content}`);
                }
            } else if (chunk.type === 'done') {
                // result 事件带的 token 用量 → 存入会话，供上下文指示器渲染（末尾 flush 持久化）
                if (chunk.usage) view.manager.setUsage(convId, chunk.usage);
                // result 事件里的最终文本作兜底：有些回复只在这里给正文，不走流式 text chunk；
                // 同样要挡掉 ExitPlanMode 的拒绝报错，避免它被当成正文展示出来（同样记一笔，见 I2）
                if (chunk.content) {
                    if (isDeferExecuteRejection(chunk.content)) {
                        rejectionSwallowed = true;
                    } else {
                        resultText = chunk.content;
                    }
                }
            }
        }

        const finalContent = pickFinalContent(textContent, thinkingContent, resultText);
        view.manager.updateMessage(convId, aiMsg.id, finalContent);

        let displayContent = finalContent;
        if (!finalContent) {
            // 诊断：本轮各类 chunk 计数 + result 文本长度，便于判断是纯工具轮/超时/真空回复
            bbLog('[WB] empty response — chunks:', JSON.stringify(chunkStats), '| resultLen:', resultText.length);
            // 计划模式下 ExitPlanMode 被拒且计划卡片确实没渲染出来：用户看到的不该是笼统的
            // 「无响应，请重试」，而是「非交互模式下无法原生批准计划」+ 可操作的建议（见 I2）
            displayContent = (rejectionSwallowed && !planCardRendered) ? t('plan.notApprovable') : t('input.noResponse');
            view.manager.updateMessage(convId, aiMsg.id, displayContent);
        }

        // C1：这里不再整体 renderMessages——它会连带销毁本轮刚建好的工具行/diff/计划卡片，
        // 且发生在 view.isStreaming 置假之前，导致计划卡片的执行按钮永远等不到可用窗口。
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
