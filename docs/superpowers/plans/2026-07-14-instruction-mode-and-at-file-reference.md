# 指令模式 `#` + @ 引用扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加两个纯前端功能——① 指令模式 `#`（全局常驻指令，注入每条消息最前置块）② `@` 引用扩展到任意 vault 文件（md 读正文、非 md 当附件）。

**Architecture:** 纯逻辑（`#` 解析 / 指令块 / 上下文拼接）放 `shared`/`core` 并单测；`#` 拦截、`@` 分流、弹窗、工具栏指示在 `features/chat` 视图层（不写测试，构建 + 手动验证）。常驻指令存 `WorkbuddianSettings.customInstruction`。

**Tech Stack:** TypeScript、Obsidian API、Jest + ts-jest、esbuild。

## Global Constraints

- 纯逻辑放 `src/shared/` / `src/core/`（不 import `obsidian`）→ 必须单测；`features/chat/*` 视图层不写测试。
- 新增用户可见文案走 `src/i18n/index.ts` 的 `STRINGS` + `t()`；prompt / 日志 / 注释保持中文。
- 常驻指令默认 `''`；settings 版本 `8 → 9`。
- 指令注入块格式：`[用户常驻指令]\n<instruction>`。
- `@` 非 md 文件绝对路径 = `${view.vaultPath}/${file.path}`，去重后 push 进 `view.attachments`。
- 不引入新运行时依赖。构建门槛：`npm run build`。测试：`npm test` / `npx jest tests/<file>`。
- 提交作者 `jiang198012`，**不加 `Co-Authored-By` 尾注**。

---

### Task 1: `shared/instruction.ts` 纯逻辑（TDD）

**Files:**
- Create: `src/shared/instruction.ts`
- Test: `tests/instruction.test.ts`

**Interfaces:**
- Produces（后续 Task 依赖）：
  - `parseInstructionInput(text: string): string | null`
  - `buildInstructionBlock(instruction: string): string`

- [ ] **Step 1: 写失败测试**

创建 `tests/instruction.test.ts`：

```ts
import { parseInstructionInput, buildInstructionBlock } from '../src/shared/instruction';

describe('parseInstructionInput', () => {
    it('returns the text after # (trimmed)', () => {
        expect(parseInstructionInput('#foo')).toBe('foo');
        expect(parseInstructionInput('# foo ')).toBe('foo');
        expect(parseInstructionInput('  #foo')).toBe('foo');
    });
    it('returns empty string for a lone #', () => {
        expect(parseInstructionInput('#')).toBe('');
        expect(parseInstructionInput('  #  ')).toBe('');
    });
    it('returns null when not starting with #', () => {
        expect(parseInstructionInput('foo')).toBeNull();
        expect(parseInstructionInput('a#b')).toBeNull();
        expect(parseInstructionInput('')).toBeNull();
    });
});

describe('buildInstructionBlock', () => {
    it('returns empty string for blank instruction', () => {
        expect(buildInstructionBlock('')).toBe('');
        expect(buildInstructionBlock('   ')).toBe('');
    });
    it('wraps a non-empty instruction as a preamble block', () => {
        expect(buildInstructionBlock('be concise')).toBe('[用户常驻指令]\nbe concise');
        expect(buildInstructionBlock('  be concise  ')).toBe('[用户常驻指令]\nbe concise');
    });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/instruction.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/instruction'`。

- [ ] **Step 3: 写实现**

创建 `src/shared/instruction.ts`：

```ts
/** 聊天输入去首尾空白后以 # 开头 → 返回其后指令文本（trim；单个 # 返回 ''）；否则 null */
export function parseInstructionInput(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('#')) return null;
    return trimmed.slice(1).trim();
}

/** 常驻指令 → 注入用的前置块；空（trim 后）返回 '' */
export function buildInstructionBlock(instruction: string): string {
    const s = instruction.trim();
    return s ? `[用户常驻指令]\n${s}` : '';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/instruction.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared/instruction.ts tests/instruction.test.ts
git commit -m "feat: instruction 纯逻辑（# 解析 + 指令前置块）"
```

---

### Task 2: `assembleContext` 注入常驻指令（TDD）

**Files:**
- Modify: `src/core/context/assembleContext.ts`
- Test: `tests/assembleContext.test.ts`

**Interfaces:**
- Consumes（Task 1）：`buildInstructionBlock(instruction: string): string`。
- Produces：`assembleContextText(text, vaultPath, injectVaultContext, currentNoteLink, referenceBlock, customInstruction?)` —— 新增可选第 6 参 `customInstruction: string = ''`，非空时把 `buildInstructionBlock(customInstruction)` 作为**最前置块**拼接。

- [ ] **Step 1: 追加失败测试**

在 `tests/assembleContext.test.ts` 的 `describe` 块末尾（最后一个 `it` 之后、`});` 之前）加：

```ts
    it('无 customInstruction 时行为不变', () => {
        expect(assembleContextText('hi', undefined, false, '', '', '')).toBe('hi');
    });

    it('有 customInstruction 时作为最前置块注入', () => {
        expect(assembleContextText('hi', undefined, false, '', '', 'be concise'))
            .toBe('[用户常驻指令]\nbe concise\n\n---\n\nhi');
    });

    it('指令 + vault + 笔记 + 引用 全齐时指令在最前', () => {
        expect(assembleContextText('hi', '/v', true, '当前：《A》', 'REF', 'be concise'))
            .toBe('[用户常驻指令]\nbe concise\n\n---\n\n' + VAULT_PREFIX('/v', 'hi') + '\n\n---\n\n当前：《A》\n\n---\n\nREF');
    });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/assembleContext.test.ts`
Expected: FAIL —— 新用例因缺第 6 参注入逻辑而输出不符（`toBe` 不匹配）。

- [ ] **Step 3: 改实现**

把 `src/core/context/assembleContext.ts` 整个文件替换为：

```ts
import { buildInstructionBlock } from '../../shared/instruction';

export function assembleContextText(
    text: string,
    vaultPath: string | undefined,
    injectVaultContext: boolean,
    currentNoteLink: string,
    referenceBlock: string,
    customInstruction: string = ''
): string {
    let contextText = (vaultPath && injectVaultContext)
        ? `当前 Obsidian Vault 路径: ${vaultPath}
工作目录即 vault 根目录，请基于 vault 中的文件回答问题。

---

${text}`
        : text;
    if (currentNoteLink) {
        contextText = `${contextText}

---

${currentNoteLink}`;
    }
    if (referenceBlock) {
        contextText = `${contextText}

---

${referenceBlock}`;
    }
    const instructionBlock = buildInstructionBlock(customInstruction);
    if (instructionBlock) {
        contextText = `${instructionBlock}

---

${contextText}`;
    }
    return contextText;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/assembleContext.test.ts`
Expected: PASS（原 5 个 + 新 3 个）。

- [ ] **Step 5: 提交**

```bash
git add src/core/context/assembleContext.ts tests/assembleContext.test.ts
git commit -m "feat: assembleContext 支持常驻指令最前置注入"
```

---

### Task 3: settings 增加 `customInstruction` + 迁移（TDD）

**Files:**
- Modify: `src/types/index.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Produces：`WorkbuddianSettings.customInstruction: string`（默认 `''`）；`CURRENT_SETTINGS_VERSION` = 9。

- [ ] **Step 1: 改测试（会失败）**

在 `tests/types.test.ts` 里做 3 处修改：

1. 第 34–36 行 `should have settings version 8` 那条改为：
```ts
    it('should have settings version 9', () => {
        expect(DEFAULT_SETTINGS.version).toBe(9);
    });
```
2. 第 137–139 行 `should migrate an older stored version up to 8` 改为：
```ts
    it('should migrate an older stored version up to 9', () => {
        expect(migrateSettings({ version: 4 }).version).toBe(9);
    });
```
3. 在 `describe('DEFAULT_SETTINGS', ...)` 的最后一个 `it`（version）之后加：
```ts
    it('should default customInstruction to empty string', () => {
        expect(DEFAULT_SETTINGS.customInstruction).toBe('');
    });
```
   并在 `describe('migrateSettings', ...)` 末尾加：
```ts
    it('should default customInstruction to empty when missing', () => {
        expect(migrateSettings({}).customInstruction).toBe('');
    });
    it('should preserve a valid customInstruction', () => {
        expect(migrateSettings({ customInstruction: 'be concise' }).customInstruction).toBe('be concise');
    });
    it('should reset a non-string customInstruction to empty', () => {
        expect(migrateSettings({ customInstruction: 123 }).customInstruction).toBe('');
    });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/types.test.ts`
Expected: FAIL —— version 期望 9 但仍是 8、`customInstruction` 为 undefined。

- [ ] **Step 3: 改实现**

在 `src/types/index.ts` 做 4 处修改：

1. `WorkbuddianSettings` 接口里 `language` 之后、`version` 之前加一行：
```ts
    customInstruction: string;
```
2. `const CURRENT_SETTINGS_VERSION = 8;` → `= 9;`
3. `DEFAULT_SETTINGS` 里 `language: 'auto',` 之后加一行：
```ts
    customInstruction: '',
```
4. `migrateSettings` 的返回对象里，`language: ...,` 那段之后、`version: CURRENT_SETTINGS_VERSION` 之前加：
```ts
        customInstruction: getString(stored, 'customInstruction') ?? DEFAULT_SETTINGS.customInstruction,
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/types.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/types/index.ts tests/types.test.ts
git commit -m "feat: settings 增加 customInstruction（v9）+ 迁移"
```

---

### Task 4: 视图层接线（# 弹窗 / 指示 + @ 分流）

**Files:**
- Create: `src/features/chat/instructionModal.ts`
- Modify: `src/features/chat/input.ts`、`src/features/chat/view.ts`、`src/i18n/index.ts`、`styles.css`
- Manual verify（无单测，与现有 obsidian 层一致）

**Interfaces:**
- Consumes：`parseInstructionInput`（Task 1）；`WorkbuddianChatView.settings.customInstruction`、`saveSettingsCallback`（现有）。
- Produces：`openInstructionModal(view, addition)`、`WorkbuddianChatView.refreshInstructionIndicator()`。

- [ ] **Step 1: i18n 加文案**

`src/i18n/index.ts` 的 `STRINGS` 里，在 `'input.imageSaveFailed'` 那条后面加：

```ts
    'instruction.modalTitle': { zh: '常驻指令', en: 'Custom instruction' },
    'instruction.placeholder': { zh: '给 AI 设定常驻的规则 / 人设（对所有对话生效）', en: 'Set a persistent rule/persona for the AI (applies to all chats)' },
    'instruction.save': { zh: '保存', en: 'Save' },
    'instruction.clear': { zh: '清除', en: 'Clear' },
    'instruction.indicatorOn': { zh: '常驻指令（已设置，点击编辑）', en: 'Custom instruction (set — click to edit)' },
    'instruction.indicatorOff': { zh: '常驻指令（点击设置）', en: 'Custom instruction (click to set)' },
```

- [ ] **Step 2: 新增 instructionModal.ts**

创建 `src/features/chat/instructionModal.ts`：

```ts
import { Modal } from 'obsidian';
import type { WorkbuddianChatView } from './view';
import { t } from '../../i18n';

class InstructionModal extends Modal {
    constructor(private view: WorkbuddianChatView, private initial: string) {
        super(view.app);
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: t('instruction.modalTitle') });
        const ta = contentEl.createEl('textarea', {
            cls: 'workbuddian-instruction-textarea',
            attr: { placeholder: t('instruction.placeholder'), rows: '6' },
        });
        ta.value = this.initial;
        const bar = contentEl.createDiv({ cls: 'workbuddian-instruction-buttons' });
        const clearBtn = bar.createEl('button', { text: t('instruction.clear') });
        clearBtn.onclick = () => { ta.value = ''; ta.focus(); };
        const saveBtn = bar.createEl('button', { text: t('instruction.save'), cls: 'mod-cta' });
        saveBtn.onclick = async () => {
            this.view.settings.customInstruction = ta.value.trim();
            await this.view.saveSettingsCallback();
            this.view.refreshInstructionIndicator();
            this.close();
        };
    }
    onClose() { this.contentEl.empty(); }
}

/** 打开常驻指令弹窗；addition 非空则预填「现有指令 +（换行）+ addition」 */
export function openInstructionModal(view: WorkbuddianChatView, addition: string) {
    const existing = view.settings.customInstruction || '';
    const initial = addition ? (existing ? `${existing}\n${addition}` : addition) : existing;
    new InstructionModal(view, initial).open();
}
```

- [ ] **Step 3: input.ts —— import + # 拦截**

在 `src/features/chat/input.ts` 顶部 import 区，`imageStore` 那行之后加两行：

```ts
import { parseInstructionInput } from '../../shared/instruction';
import { openInstructionModal } from './instructionModal';
```

并把 `import { Menu, Notice, setIcon } from 'obsidian';` 改为：

```ts
import { Menu, Notice, setIcon, TFile } from 'obsidian';
```

在 `sendMessage` 里，`if (!text) return;` 之后紧接着加：

```ts
    // 指令模式：# 开头 → 打开常驻指令弹窗，不发送
    const instr = parseInstructionInput(text);
    if (instr !== null) {
        openInstructionModal(view, instr);
        return;
    }
```

- [ ] **Step 4: input.ts —— @ 列全部文件 + 分流**

把 `updateAtSuggest` 里这段：

```ts
    const files = view.app.vault.getMarkdownFiles()
        .filter(f => f.basename.toLowerCase().includes(query))
        .slice(0, 8);
```
改为：
```ts
    const files = view.app.vault.getFiles()
        .filter(f => f.name.toLowerCase().includes(query))
        .slice(0, 8);
```

把同函数里：
```ts
        const item = view.atSuggestEl.createDiv({ cls: 'workbuddian-at-suggest-item', text: file.basename });
        item.onclick = () => insertAtReference(view, file.basename);
```
改为：
```ts
        const item = view.atSuggestEl.createDiv({ cls: 'workbuddian-at-suggest-item', text: file.name });
        item.onclick = () => insertAtReference(view, file);
```

把整个 `insertAtReference` 函数替换为（签名改为收 `TFile`，按扩展名分流）：

```ts
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

    view.atSuggestEl.addClass('workbuddian-hidden');
    view.atSuggestEl.empty();
    renderReferenceChips(view);
    adjustTextareaHeight(view);
}
```

并把 `sendText` 里调用 `assembleContextText` 那处（现为 5 参）：
```ts
            contextText = assembleContextText(
                text, view.vaultPath, view.settings.injectVaultContext, currentNoteLink, extraBlock
            );
```
改为 6 参：
```ts
            contextText = assembleContextText(
                text, view.vaultPath, view.settings.injectVaultContext, currentNoteLink, extraBlock, view.settings.customInstruction
            );
```

- [ ] **Step 5: view.ts —— 工具栏指示按钮 + 刷新方法**

在 `src/features/chat/view.ts` 顶部 import 区加：
```ts
import { openInstructionModal } from './instructionModal';
```

在类字段区（`sendBtn!: HTMLButtonElement;` 附近）加一行：
```ts
    instructionBtn!: HTMLButtonElement;
```

在 `buildUI()` 里，权限按钮那段（`permBtn.onclick = (e) => openPermissionMenu(this, permBtn, e);`）之后、`const rightGroup = ...` 之前，插入：
```ts
        // 常驻指令指示（有指令时高亮，点击编辑/清除）
        const instrBtn = toolbar.createEl('button', { cls: 'workbuddian-toolbar-btn' });
        setIcon(instrBtn, 'hash');
        instrBtn.onclick = () => openInstructionModal(this, '');
        this.instructionBtn = instrBtn;
        this.refreshInstructionIndicator();
```

在类里（如 `refreshUI()` 方法之后）加方法：
```ts
    /** 按 settings.customInstruction 刷新工具栏 # 指示按钮的高亮与提示 */
    refreshInstructionIndicator() {
        if (!this.instructionBtn) return;
        const on = !!this.settings.customInstruction;
        this.instructionBtn.toggleClass('workbuddian-instruction-active', on);
        const label = on ? t('instruction.indicatorOn') : t('instruction.indicatorOff');
        this.instructionBtn.setAttribute('title', label);
        this.instructionBtn.setAttribute('aria-label', label);
    }
```

- [ ] **Step 6: styles.css 加样式**

在 `styles.css` 末尾追加：

```css
/* 常驻指令指示按钮（激活态）*/
.workbuddian-instruction-active { color: var(--workbuddian-primary, var(--interactive-accent)); }
/* 常驻指令弹窗 */
.workbuddian-instruction-textarea { width: 100%; min-height: 8em; resize: vertical; }
.workbuddian-instruction-buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
```

- [ ] **Step 7: 构建（类型检查门槛）**

Run: `npm run build`
Expected: exit 0，产出新 `main.js`。

- [ ] **Step 8: 全量测试无回归**

Run: `npm test`
Expected: 全绿（新增 instruction + assembleContext + types 用例 + 原有）。

- [ ] **Step 9: 手动验证（部署到 vault + 重载）**

把 `main.js` / `manifest.json` / `styles.css` 复制到真实 vault 的 `.obsidian/plugins/workbuddian/`，Obsidian 里 `Cmd+R`，然后：
1. 聊天框输 `#回答尽量简短` 回车 → 弹出指令弹窗（预填该文字）→ 保存 → 工具栏 `#` 按钮高亮。
2. 发一条普通消息 → AI 行为体现「简短」（说明指令注入生效）。
3. 点工具栏 `#` 按钮 → 弹窗可编辑/清除；清空保存 → 按钮熄灭。
4. 输入框输 `@`，下拉里能看到**非 md 文件**（如图片/pdf）→ 选中 → 出现**附件 chip**；选 md 笔记 → 插入 `@[[名]]`。

- [ ] **Step 10: 提交**

```bash
git add src/features/chat/instructionModal.ts src/features/chat/input.ts src/features/chat/view.ts src/i18n/index.ts styles.css main.js
git commit -m "feat: 指令模式 # 弹窗/指示 + @ 引用扩展到任意文件"
```

---

## Self-Review 记录

- **Spec coverage**：指令存储（Task 3）、`#` 解析/注入（Task 1/2）、`#` 拦截+弹窗+指示（Task 4）、`@` 扩展 md/非 md 分流（Task 4）、i18n（Task 4 Step 1）、错误/边界（弹窗非破坏 return、空指令清除、@ 去重）——均有对应。
- **Placeholder scan**：无 TBD/TODO，每步给完整代码。
- **Type consistency**：`parseInstructionInput`/`buildInstructionBlock`（Task 1）→ Task 2 `assembleContextText` 第 6 参 `customInstruction` 与 Task 4 `sendText` 调用一致；`WorkbuddianSettings.customInstruction`（Task 3）与 Task 4 读写一致；`openInstructionModal(view, addition)` / `refreshInstructionIndicator()` 在 Task 4 内定义与调用一致；`insertAtReference(view, file: TFile)` 新签名与调用点一致。
