# 输入 / 自动补全 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 输入框第一行输 `/` 弹内置命令补全，点选填入 `/name `；不干扰现有 @ 补全。

**Architecture:** `slashCommand.ts` 加命令表 + 两个纯函数（可单测）；`input.ts` 加 `updateSlashSuggest`/`insertSlashCommand`（复用 `atSuggestEl`）；`view.ts` 的 `oninput` 先 slash 后 @ 分派。

**Tech Stack:** TypeScript、Jest（纯函数）、esbuild、Obsidian view 层。

## Global Constraints

- 触发：光标在第一行、该行 `/` 开头、`/` 后无空白才补全；否则交回 @ 补全。
- 填入格式固定 `/name `（带尾空格）。点击选择，不做键盘导航。
- 复用 `view.atSuggestEl` 下拉容器（不新增 DOM）。
- 无新设置字段、不改数据模型。
- **本仓库非 git**：不 commit；每 Task 以构建/测试收尾。
- **部署铁律**：build 后 python 部署 `main.js`+`styles.css`+`manifest.json` 到 iCloud vault `.../我的工作/.obsidian/plugins/workbuddian/` 再 `Cmd+R`。
- **验证 bundle 用 ASCII 锚点**（如 `updateSlashSuggest`），勿 grep 中文。
- 命令：`npx jest`（全量须由 121 增至 130 绿）；`npm run build`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/shared/slashCommand.ts` | 命令表 + `extractSlashQuery` + `filterSlashCommands` | Modify |
| `tests/slashCommand.test.ts` | 两纯函数单测 | Modify |
| `src/features/chat/input.ts` | `updateSlashSuggest` + `insertSlashCommand` | Modify |
| `src/features/chat/view.ts` | `oninput` 分派 | Modify |
| `styles.css` | 命令描述次要色 | Modify |

---

## Task 1: 命令表 + 解析（TDD）

**Files:**
- Modify: `src/shared/slashCommand.ts`
- Test: `tests/slashCommand.test.ts`

**Interfaces:**
- Produces: `BUILTIN_SLASH_COMMANDS: SlashCommandInfo[]`、`extractSlashQuery(value, cursor): string|null`、`filterSlashCommands(query): SlashCommandInfo[]`

- [ ] **Step 1: 写失败测试**

把 `tests/slashCommand.test.ts` 首行 import 改为：

```ts
import { parseSlashCommand, extractSlashQuery, filterSlashCommands, BUILTIN_SLASH_COMMANDS } from '../src/shared/slashCommand';
```

在文件末尾（最后一个 `});` 之后）追加：

```ts
describe('extractSlashQuery', () => {
    it('returns empty string for a lone slash at cursor', () => {
        expect(extractSlashQuery('/', 1)).toBe('');
    });
    it('returns the command prefix', () => {
        expect(extractSlashQuery('/co', 3)).toBe('co');
    });
    it('returns null once past the command name (space)', () => {
        expect(extractSlashQuery('/clear ', 7)).toBeNull();
    });
    it('returns null for non-slash text', () => {
        expect(extractSlashQuery('hello', 5)).toBeNull();
    });
    it('returns null when cursor is on a later line', () => {
        expect(extractSlashQuery('/a\nb', 3)).toBeNull();
    });
});

describe('filterSlashCommands', () => {
    it('returns all for empty query', () => {
        expect(filterSlashCommands('')).toHaveLength(BUILTIN_SLASH_COMMANDS.length);
    });
    it('filters by prefix', () => {
        expect(filterSlashCommands('co').map(c => c.name)).toEqual(['compact', 'context', 'cost']);
    });
    it('matches a single command', () => {
        expect(filterSlashCommands('clear').map(c => c.name)).toEqual(['clear']);
    });
    it('returns empty array for no match', () => {
        expect(filterSlashCommands('zzz')).toEqual([]);
    });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/slashCommand.test.ts`
Expected: FAIL（`extractSlashQuery` 等未导出）。

- [ ] **Step 3: 实现**

在 `src/shared/slashCommand.ts` 末尾追加：

```ts
export interface SlashCommandInfo { name: string; desc: string; }

export const BUILTIN_SLASH_COMMANDS: SlashCommandInfo[] = [
    { name: 'clear', desc: '清空并新建对话（本地）' },
    { name: 'compact', desc: '压缩上下文' },
    { name: 'context', desc: '查看上下文用量' },
    { name: 'cost', desc: '查看本次花费' },
    { name: 'model', desc: '切换模型' },
    { name: 'permissions', desc: '查看/管理权限' },
    { name: 'resume', desc: '恢复历史会话' },
    { name: 'export', desc: '导出对话' },
    { name: 'status', desc: '查看状态' },
];

/** 光标在第一行、该行以 / 开头、/ 后无空白（仍在命令名 token 内）时，返回命令名前缀，否则 null */
export function extractSlashQuery(value: string, cursor: number): string | null {
    const upto = value.slice(0, cursor);
    if (upto.includes('\n')) return null;
    if (!upto.startsWith('/')) return null;
    const afterSlash = upto.slice(1);
    if (/\s/.test(afterSlash)) return null;
    return afterSlash;
}

export function filterSlashCommands(query: string): SlashCommandInfo[] {
    const q = query.toLowerCase();
    return BUILTIN_SLASH_COMMANDS.filter(c => c.name.toLowerCase().startsWith(q));
}
```

- [ ] **Step 4: 通过 + 全量回归**

Run:
```bash
npx jest tests/slashCommand.test.ts && npx jest > /tmp/wb_33_t1.log 2>&1; echo "exit:$?"; grep -E "Tests:" /tmp/wb_33_t1.log
```
Expected: 单文件 PASS；全量 `Tests: 130 passed`（121 + 9）。

---

## Task 2: 补全 UI + oninput 分派

**Files:**
- Modify: `src/features/chat/input.ts`
- Modify: `src/features/chat/view.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `extractSlashQuery`/`filterSlashCommands`（Task 1）
- Produces: `updateSlashSuggest(view): boolean`、`insertSlashCommand(view, name)`

- [ ] **Step 1: input.ts import**

把：
```ts
import { parseSlashCommand } from '../../shared/slashCommand';
```
改为：
```ts
import { parseSlashCommand, extractSlashQuery, filterSlashCommands } from '../../shared/slashCommand';
```

- [ ] **Step 2: input.ts 新增两函数**

在 `insertAtReference` 函数之后（`buildReferenceBlock` 之前）插入：

```ts
export function updateSlashSuggest(view: WorkbuddianChatView): boolean {
    const cursorPos = view.inputEl.selectionStart ?? view.inputEl.value.length;
    const query = extractSlashQuery(view.inputEl.value, cursorPos);
    if (query === null) return false;

    const matches = filterSlashCommands(query);
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
    return true;
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
```

- [ ] **Step 3: view.ts 分派**

把 `view.ts` 的：
```ts
import { handleKeydown, sendMessage, adjustTextareaHeight, updateAtSuggest } from './input';
```
改为：
```ts
import { handleKeydown, sendMessage, adjustTextareaHeight, updateAtSuggest, updateSlashSuggest } from './input';
```

把：
```ts
        this.inputEl.oninput = () => {
            adjustTextareaHeight(this);
            updateAtSuggest(this);
        };
```
改为：
```ts
        this.inputEl.oninput = () => {
            adjustTextareaHeight(this);
            if (!updateSlashSuggest(this)) updateAtSuggest(this);
        };
```

- [ ] **Step 4: styles.css 描述样式**

在 `styles.css` 末尾追加：

```css
.workbuddian-slash-cmd-desc {
    color: var(--text-muted);
    margin-left: var(--workbuddian-gap-xs);
    font-size: 0.85em;
}
```

- [ ] **Step 5: 构建 + 全量回归**

Run:
```bash
cd /Users/jiang/claude/workbuddian
npm run build && echo build-ok
npx jest > /tmp/wb_33_t2.log 2>&1; echo "test-exit:$?"; grep -E "Tests:" /tmp/wb_33_t2.log
grep -c "updateSlashSuggest" main.js
```
Expected: `build-ok`；`Tests: 130 passed`；grep ≥ 1。

---

## Task 3: 部署 + 人工验收

- [ ] **Step 1: 部署**

Run:
```bash
python3 - <<'PY'
import glob, os, shutil, hashlib
dev='/Users/jiang/claude/workbuddian'
docs='/Users/jiang/Library/Mobile Documents/iCloud~md~obsidian/Documents'
dst=glob.glob(f'{docs}/*/.obsidian/plugins/workbuddian')[0]
for f in ['main.js','styles.css','manifest.json']:
    shutil.copy2(os.path.join(dev,f), os.path.join(dst,f))
h=lambda p: hashlib.md5(open(p,'rb').read()).hexdigest()
print('md5 一致:', h(f'{dev}/main.js')==h(f'{dst}/main.js'))
print('含 updateSlashSuggest:', 'updateSlashSuggest' in open(f'{dst}/main.js',encoding='utf-8').read())
PY
```
Expected: `md5 一致: True`；`含 updateSlashSuggest: True`。

- [ ] **Step 2: Obsidian 人工验收**

`Cmd+R` 后确认 spec 验收标准 1-5：输入 `/` 列出 9 命令、`/co` 过滤为 3 条、点选填入 `/name `、`/clear ` 后补全消失、行中 `@` 笔记补全仍正常。

---

## Self-Review

**1. Spec coverage：** ①纯逻辑→Task1；②UI→Task2 Step1-2；③分派→Task2 Step3；④样式→Task2 Step4；测试→Task1；验收→Task3。

**2. Placeholder scan：** 无 TBD；每步完整代码/命令/预期。

**3. Type consistency：** `extractSlashQuery(value,cursor):string|null`、`filterSlashCommands(query):SlashCommandInfo[]`、`updateSlashSuggest(view):boolean`、`insertSlashCommand(view,name)` 在定义与调用处一致；`view.ts` oninput 依赖 `updateSlashSuggest` 返回 boolean 决定是否走 @ 补全。
