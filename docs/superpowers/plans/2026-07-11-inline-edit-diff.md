# Inline Edit + Diff 实现计划（第四阶段长任务 · 阶段 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 选中笔记文本 → 命令 → 填要求 → CodeBuddy 改写 → 行级 diff 预览 → 接受写回 / 拒绝不动。

**Architecture:** 纯逻辑 `lineDiff`(LCS) + `editPrompt` 可 TDD；`features/inline-edit/index.ts` 放两个 Modal + 流程 + CLI 收集；`main.ts` 注册 `editorCallback` 命令。

**Tech Stack:** TypeScript、Jest、Obsidian（Editor / Modal / editorCallback）、esbuild。

## Global Constraints

- scope：Inline Edit + Diff（不含 Plan Mode）。
- CLI 收集只取 `text` chunk、遇 `error` 抛出；用一次性 `sessionId`（不进聊天历史）。
- 写回只 `editor.replaceSelection(edited)`，且经「接受」确认。
- **本仓库非 git**：不 commit；每 Task 以构建/测试收尾。
- **部署铁律**：build 后 python 部署 `main.js`+`styles.css`+`manifest.json` 到 iCloud vault 再 `Cmd+R`。
- **验证 bundle 用 ASCII 锚点**（`runInlineEdit`/`lineDiff`），勿 grep 中文。
- 命令：`npx jest`（全量须由 147 增至 ~157 绿）；`npm run build`。

---

## Task 1: lineDiff（TDD）

**Files:** Create `src/shared/lineDiff.ts`, `tests/lineDiff.test.ts`

- [ ] **Step 1: 写失败测试** — Create `tests/lineDiff.test.ts`:

```ts
import { lineDiff } from '../src/shared/lineDiff';

describe('lineDiff', () => {
    it('marks identical text as all equal', () => {
        expect(lineDiff('a\nb', 'a\nb')).toEqual([
            { type: 'equal', text: 'a' }, { type: 'equal', text: 'b' },
        ]);
    });
    it('detects a changed line as remove + add', () => {
        expect(lineDiff('a\nb', 'a\nc')).toEqual([
            { type: 'equal', text: 'a' },
            { type: 'remove', text: 'b' },
            { type: 'add', text: 'c' },
        ]);
    });
    it('detects a pure addition', () => {
        expect(lineDiff('a', 'a\nb')).toEqual([
            { type: 'equal', text: 'a' }, { type: 'add', text: 'b' },
        ]);
    });
    it('detects a pure removal', () => {
        expect(lineDiff('a\nb', 'a')).toEqual([
            { type: 'equal', text: 'a' }, { type: 'remove', text: 'b' },
        ]);
    });
});
```

- [ ] **Step 2: 确认失败** — `npx jest tests/lineDiff.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现** — Create `src/shared/lineDiff.ts`:

```ts
export interface DiffLine { type: 'equal' | 'add' | 'remove'; text: string; }

/** 行级 diff（LCS）：按 \n 切行，回溯输出 equal/remove/add 序列 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
    const a = oldText.split('\n');
    const b = newText.split('\n');
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out: DiffLine[] = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
        if (a[i] === b[j]) { out.push({ type: 'equal', text: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'remove', text: a[i] }); i++; }
        else { out.push({ type: 'add', text: b[j] }); j++; }
    }
    while (i < m) { out.push({ type: 'remove', text: a[i] }); i++; }
    while (j < n) { out.push({ type: 'add', text: b[j] }); j++; }
    return out;
}
```

- [ ] **Step 4: 通过 + 全量** — `npx jest tests/lineDiff.test.ts && npx jest`（全量增 4 → 151）。

---

## Task 2: editPrompt（TDD）

**Files:** Create `src/shared/editPrompt.ts`, `tests/editPrompt.test.ts`

- [ ] **Step 1: 写失败测试** — Create `tests/editPrompt.test.ts`:

```ts
import { buildEditPrompt } from '../src/shared/editPrompt';

describe('buildEditPrompt', () => {
    it('includes the selection, instruction and the only-body constraint', () => {
        const p = buildEditPrompt('原始正文', '改简洁');
        expect(p).toContain('原始正文');
        expect(p).toContain('改简洁');
        expect(p).toContain('只输出改写后的正文');
    });
});
```

- [ ] **Step 2: 确认失败** — `npx jest tests/editPrompt.test.ts` → FAIL。

- [ ] **Step 3: 实现** — Create `src/shared/editPrompt.ts`:

```ts
/** 组装强约束编辑 prompt：只要正文、不要解释 */
export function buildEditPrompt(selection: string, instruction: string): string {
    return [
        '请按下面的要求改写「原文」。',
        '只输出改写后的正文，不要任何解释、开场白、结束语或代码块标记。',
        '',
        `要求：${instruction}`,
        '',
        '原文：',
        selection,
    ].join('\n');
}
```

- [ ] **Step 4: 通过 + 全量** — `npx jest tests/editPrompt.test.ts && npx jest`（全量增 1 → 152）。

---

## Task 3: inline-edit UI + 命令注册 + 样式

**Files:** Create `src/features/inline-edit/index.ts`; Modify `src/main.ts`, `styles.css`

- [ ] **Step 1: Create `src/features/inline-edit/index.ts`**

```ts
import { App, Editor, Modal, Notice, Setting } from 'obsidian';
import { CodebuddyProvider } from '../../providers/codebuddy';
import { lineDiff, type DiffLine } from '../../shared/lineDiff';
import { buildEditPrompt } from '../../shared/editPrompt';

async function collectEditResult(api: CodebuddyProvider, sessionId: string, prompt: string, vaultPath?: string): Promise<string> {
    let text = '';
    for await (const chunk of api.sendMessage(sessionId, prompt, vaultPath)) {
        if (chunk.type === 'text') text += chunk.content;
        if (chunk.type === 'error') throw new Error(chunk.content);
    }
    return text.trim();
}

class InstructionModal extends Modal {
    constructor(app: App, private onSubmit: (instruction: string) => void) { super(app); }
    onOpen() {
        this.titleEl.setText('用 CodeBuddy 编辑选区');
        let value = '';
        new Setting(this.contentEl)
            .setName('编辑要求')
            .addText(t => { t.setPlaceholder('如：改简洁 / 翻译成英文'); t.onChange(v => { value = v; }); });
        new Setting(this.contentEl)
            .addButton(b => b.setButtonText('编辑').setCta().onClick(() => {
                if (!value.trim()) { new Notice('请输入编辑要求'); return; }
                this.close();
                this.onSubmit(value.trim());
            }));
    }
    onClose() { this.contentEl.empty(); }
}

class DiffModal extends Modal {
    constructor(app: App, private diff: DiffLine[], private onAccept: () => void) { super(app); }
    onOpen() {
        this.titleEl.setText('预览改动');
        const box = this.contentEl.createDiv({ cls: 'workbuddian-diff-box' });
        for (const line of this.diff) {
            const prefix = line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  ';
            box.createDiv({ cls: `workbuddian-diff-line workbuddian-diff-${line.type}`, text: prefix + line.text });
        }
        new Setting(this.contentEl)
            .addButton(b => b.setButtonText('接受').setCta().onClick(() => { this.close(); this.onAccept(); }))
            .addButton(b => b.setButtonText('拒绝').onClick(() => this.close()));
    }
    onClose() { this.contentEl.empty(); }
}

export function runInlineEdit(app: App, api: CodebuddyProvider, editor: Editor, vaultPath?: string) {
    const selection = editor.getSelection();
    if (!selection.trim()) { new Notice('请先选中一段文本'); return; }
    new InstructionModal(app, async (instruction) => {
        const notice = new Notice('CodeBuddy 编辑中…', 0);
        try {
            const edited = await collectEditResult(api, api.generateId(), buildEditPrompt(selection, instruction), vaultPath);
            notice.hide();
            if (!edited) { new Notice('未获得编辑结果'); return; }
            new DiffModal(app, lineDiff(selection, edited), () => editor.replaceSelection(edited)).open();
        } catch (e) {
            notice.hide();
            new Notice('编辑失败：' + (e instanceof Error ? e.message : String(e)));
        }
    }).open();
}
```

- [ ] **Step 2: `main.ts` 注册命令**

在 import 段加：
```ts
import { runInlineEdit } from './features/inline-edit';
```

在 `onload` 里 `this.addCommand({ id: 'open-chat-main-pane', ... });` 之后加：
```ts
            this.addCommand({
                id: 'inline-edit',
                name: '用 CodeBuddy 编辑选区',
                editorCallback: (editor) => {
                    const basePath = (this.app.vault.adapter as { basePath?: string }).basePath;
                    runInlineEdit(this.app, this.api, editor, basePath);
                }
            });
```

- [ ] **Step 3: `styles.css` 追加（python）**

```css
.workbuddian-diff-box {
    font-family: var(--font-monospace);
    font-size: var(--font-ui-small);
    max-height: 50vh;
    overflow: auto;
    white-space: pre-wrap;
    margin-bottom: var(--workbuddian-gap-md);
}
.workbuddian-diff-line { padding: 1px 6px; border-radius: 2px; }
.workbuddian-diff-add { background: var(--background-modifier-success); }
.workbuddian-diff-remove { background: var(--background-modifier-error); }
```

- [ ] **Step 4: build + 全量**

```bash
cd <project>
npm run build && echo build-ok
npx jest > /tmp/wb_43_t3.log 2>&1; echo "test-exit:$?"; grep -E "Tests:" /tmp/wb_43_t3.log
grep -c "runInlineEdit" main.js
```
Expected: `build-ok`；`Tests: 152 passed`；grep ≥ 1。

---

## Task 4: 部署 + 人工验收

- [ ] **Step 1: 部署**
```bash
python3 - <<'PY'
import glob, os, shutil, hashlib
dev='<project>'
docs='<icloud-docs>'
dst=glob.glob(f'{docs}/*/.obsidian/plugins/workbuddian')[0]
for f in ['main.js','styles.css','manifest.json']:
    shutil.copy2(os.path.join(dev,f), os.path.join(dst,f))
h=lambda p: hashlib.md5(open(p,'rb').read()).hexdigest()
print('main.js md5 一致:', h(f'{dev}/main.js')==h(f'{dst}/main.js'))
print('含 runInlineEdit:', 'runInlineEdit' in open(f'{dst}/main.js',encoding='utf-8').read())
PY
```

- [ ] **Step 2: Obsidian 人工验收**

`Cmd+R` 后：在任意笔记选中一段 → 命令面板「用 CodeBuddy 编辑选区」→ 填「改简洁」→ 等 diff 预览（+/-）→ 接受写回 / 拒绝不动。留意 CLI 是否只返回正文（否则告诉我调 prompt）。

---

## Self-Review

**1. Spec coverage：** lineDiff→T1；editPrompt→T2；UI/流程/命令/样式→T3；测试→T1/T2；验收→T3/T4。

**2. Placeholder scan：** 无 TBD；lineDiff/editPrompt/两 Modal/runInlineEdit 均给完整代码。

**3. Type consistency：** `lineDiff(old,new):DiffLine[]`、`buildEditPrompt(sel,instr):string`、`runInlineEdit(app,api,editor,vaultPath?)`、`collectEditResult(...)` 定义与调用一致；`main.ts` 用 `editorCallback` 拿 editor，`basePath` 经 vault adapter。
