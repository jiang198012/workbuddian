# 斜杠命令安全透传 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `/clear` 本地新建对话；其余 `/` 命令跳过 context 注入原样透传给 CLI；普通消息不变。

**Architecture:** 新增纯函数 `parseSlashCommand`（可单测）；`input.ts` 的 `sendMessage()` 加斜杠分派——`/clear` 本地拦截返回，其它斜杠命令令 `contextText = text`（不注入）。

**Tech Stack:** TypeScript、Jest（覆盖纯函数）、esbuild、Obsidian view 层。

## Global Constraints

- 判定「通用」：`text` trim 后第一行 `/` 紧跟非空白才算命令；`/`、`/ 空格`、普通文本 → `null`。
- `/clear` 在 `addMessage` 前拦截（不进当前对话）；其它斜杠命令 `contextText = text`。
- 无新设置字段、不改数据模型。
- **本仓库非 git**：不 `git commit`；每 Task 以构建/测试收尾。
- **部署铁律**：build 后必须 python 部署 `main.js`+`styles.css`+`manifest.json` 到 iCloud vault `.../<vault-name>/.obsidian/plugins/workbuddian/`，再 `Cmd+R`，否则 Obsidian 加载不到。
- **验证 bundle 用 ASCII 锚点**（如 `parseSlashCommand`），勿 grep 中文（esbuild ascii charset 会转成大写 `\u` 转义）。
- 命令：`npx jest`（全量，须由 113 增至 121 绿）；`npm run build`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/shared/slashCommand.ts` | `parseSlashCommand` 纯解析 | Create |
| `tests/slashCommand.test.ts` | 解析器单测 | Create |
| `src/features/chat/input.ts` | `sendMessage` 斜杠分派 | Modify |

---

## Task 1: parseSlashCommand（TDD）

**Files:**
- Create: `src/shared/slashCommand.ts`
- Test: `tests/slashCommand.test.ts`

**Interfaces:**
- Produces: `parseSlashCommand(text: string): { name: string; rest: string } | null`

- [ ] **Step 1: 写失败测试**

Create `tests/slashCommand.test.ts`:

```ts
import { parseSlashCommand } from '../src/shared/slashCommand';

describe('parseSlashCommand', () => {
    it('parses /clear', () => {
        expect(parseSlashCommand('/clear')).toEqual({ name: 'clear', rest: '' });
    });
    it('parses command with args', () => {
        expect(parseSlashCommand('/model glm-5.2')).toEqual({ name: 'model', rest: 'glm-5.2' });
    });
    it('parses a bare command', () => {
        expect(parseSlashCommand('/cost')).toEqual({ name: 'cost', rest: '' });
    });
    it('returns null for normal text', () => {
        expect(parseSlashCommand('hello')).toBeNull();
    });
    it('returns null for a lone slash', () => {
        expect(parseSlashCommand('/')).toBeNull();
    });
    it('returns null for slash followed by space', () => {
        expect(parseSlashCommand('/ hello')).toBeNull();
    });
    it('trims surrounding whitespace', () => {
        expect(parseSlashCommand('  /status  ')).toEqual({ name: 'status', rest: '' });
    });
    it('only considers the first line', () => {
        expect(parseSlashCommand('/cost\nmore')).toEqual({ name: 'cost', rest: '' });
    });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/slashCommand.test.ts`
Expected: FAIL（模块/函数不存在）。

- [ ] **Step 3: 实现**

Create `src/shared/slashCommand.ts`:

```ts
export interface SlashCommand {
    name: string;   // 命令名，不含前导 /
    rest: string;   // 命令名之后的参数串（已 trim）
}

/** 解析斜杠命令：trim 后第一行以 / 紧跟非空白才算命令，否则返回 null */
export function parseSlashCommand(text: string): SlashCommand | null {
    const firstLine = text.trim().split('\n')[0];
    const m = firstLine.match(/^\/(\S+)\s*(.*)$/);
    if (!m) return null;
    return { name: m[1], rest: m[2].trim() };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/slashCommand.test.ts`
Expected: PASS（8 条）。

- [ ] **Step 5: 全量回归**

Run: `npx jest`
Expected: `Tests: 121 passed`（原 113 + 8）。

---

## Task 2: input.ts sendMessage 斜杠分派

**Files:**
- Modify: `src/features/chat/input.ts`

**Interfaces:**
- Consumes: `parseSlashCommand`（Task 1）、`createNewChat`（`./tabs`）

- [ ] **Step 1: 更新 import**

把：

```ts
import { renderMessages, renderMarkdownContent } from './render';
import { renderTabs } from './tabs';
```

改为：

```ts
import { renderMessages, renderMarkdownContent } from './render';
import { renderTabs, createNewChat } from './tabs';
import { parseSlashCommand } from '../../shared/slashCommand';
```

- [ ] **Step 2: /clear 本地拦截**

在 `sendMessage` 里 `const text = view.inputEl.value.trim();` 与其后的 `if (!text) return;` 之下、`// 确保有活跃对话` 之上插入：

```ts
    if (!text) return;

    const slash = parseSlashCommand(text);
    if (slash?.name === 'clear') {
        // /clear：本地新建对话，不发 CLI
        await createNewChat(view);
        view.inputEl.value = '';
        adjustTextareaHeight(view);
        return;
    }

    // 确保有活跃对话
```

- [ ] **Step 3: 斜杠命令跳过 context 注入**

把现有：

```ts
        const referenceBlock = await buildReferenceBlock(view, text);
        const currentNoteLink = view.settings.injectCurrentNoteLink ? buildCurrentNoteLink(view) : '';

        const contextText = assembleContextText(
            text, view.vaultPath, view.settings.injectVaultContext, currentNoteLink, referenceBlock
        );
```

改为：

```ts
        let contextText: string;
        if (slash) {
            // 斜杠命令：原样透传，不注入 vault 前缀 / 笔记链接 / @引用
            contextText = text;
        } else {
            const referenceBlock = await buildReferenceBlock(view, text);
            const currentNoteLink = view.settings.injectCurrentNoteLink ? buildCurrentNoteLink(view) : '';
            contextText = assembleContextText(
                text, view.vaultPath, view.settings.injectVaultContext, currentNoteLink, referenceBlock
            );
        }
```

- [ ] **Step 4: 构建 + 全量回归**

Run:

```bash
cd <project>
npm run build && echo build-ok
npx jest > /tmp/wb_32_test.log 2>&1; echo "test-exit:$?"; grep -E "Tests:" /tmp/wb_32_test.log
grep -c "parseSlashCommand" main.js
```

Expected: `build-ok`；`test-exit:0`；`Tests: 121 passed`；grep ≥ 1。

---

## Task 3: 部署到 iCloud vault + 人工验收

- [ ] **Step 1: 部署**

Run:

```bash
python3 - <<'PY'
import glob, os, shutil, hashlib
dev='<project>'
docs='<icloud-docs>'
dst=glob.glob(f'{docs}/*/.obsidian/plugins/workbuddian')[0]
for f in ['main.js','styles.css','manifest.json']:
    shutil.copy2(os.path.join(dev,f), os.path.join(dst,f))
h=lambda p: hashlib.md5(open(p,'rb').read()).hexdigest()
print('部署 ->', dst)
print('md5 一致:', h(f'{dev}/main.js')==h(f'{dst}/main.js'))
print('含 parseSlashCommand:', 'parseSlashCommand' in open(f'{dst}/main.js',encoding='utf-8').read())
PY
```

Expected: `md5 一致: True`；`含 parseSlashCommand: True`。

- [ ] **Step 2: Obsidian 人工验收**

`Cmd+R` 后确认：
1. 输入 `/clear` 回车 → 本地新建空对话并切换，不发 CLI，输入框清空。
2. 输入 `/cost` 回车 → 作为消息发送，发给 CLI 的是原始 `/cost`（无 vault 前缀）；正常流式渲染。
3. 普通消息（不以 `/` 开头）行为不变。

---

## Self-Review

**1. Spec coverage：** ①解析器→Task1；②分派(/clear 拦截 + 透传)→Task2；测试→Task1；验收→Task2/Task3。

**2. Placeholder scan：** 无 TBD；每步含完整代码/命令/预期。

**3. Type consistency：** `parseSlashCommand(text): {name,rest}|null` Task1 定义、Task2 消费一致；`slash` 变量在 `sendMessage` 函数作用域内（Step2 定义、Step3 引用）一致；`createNewChat` 为 async，Step2 已 `await`。
