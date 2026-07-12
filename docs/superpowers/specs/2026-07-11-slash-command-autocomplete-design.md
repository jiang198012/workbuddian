# 3.3 输入 / 自动补全 — 设计文档

- 日期：2026-07-11
- 阶段：ROADMAP 第三阶段 3.3
- 状态：已确认设计，待实现

## 目标

输入框第一行以 `/` 开头且在命令名 token 内时，弹出内置命令补全下拉，点选后把命令填入输入框（`/name `）。

## 背景与现状

`input.ts` 已有 @ 引用补全：`view.ts` 的 `oninput` 调 `updateAtSuggest()`，从光标提取 `@` 查询、过滤 vault 笔记、渲染 `view.atSuggestEl` 下拉、点击 `insertAtReference` 填入。3.3 复用同一 `atSuggestEl` 容器做 `/` 命令补全（`/` 在行首、`@` 在行中，同一时刻只有一个激活）。

## 非目标（Non-goals）

- 不扫描 vault `.codebuddy/commands/**/*.md` 自定义命令（3.3 完整版的后半，YAGNI 暂缓）。
- 不做键盘上下导航（沿用 @ 补全的点击选择）。
- 不做 3.4 交互式命令（`/model` 弹选择器等）。

## 设计

### ① 纯逻辑（`src/shared/slashCommand.ts`，可单测）

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

// 光标须在第一行、该行以 / 开头、/ 后无空白（仍在命令名 token 内）
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

### ② UI（`src/features/chat/input.ts`）

- `updateSlashSuggest(view): boolean`
  - `extractSlashQuery` 为 `null` → 返回 `false`（非 slash 上下文，交给 @ 补全）。
  - 非 null → 渲染 `filterSlashCommands(query)` 到 `view.atSuggestEl`（每项：`/name` + desc span，点击调 `insertSlashCommand`）；无匹配则隐藏下拉。无论有无匹配都返回 `true`（是 slash 上下文，@ 补全不接管）。
- `insertSlashCommand(view, name)`：`inputEl.value = '/' + name + ' '`，光标置末尾，隐藏并清空下拉，`adjustTextareaHeight`，`focus`。

### ③ 触发分派（`src/features/chat/view.ts`）

`oninput` 由：

```ts
this.inputEl.oninput = () => { adjustTextareaHeight(this); updateAtSuggest(this); };
```

改为：

```ts
this.inputEl.oninput = () => {
    adjustTextareaHeight(this);
    if (!updateSlashSuggest(this)) updateAtSuggest(this);
};
```

（`view.ts` 新增 import `updateSlashSuggest`。）

### ④ 样式（可选，`styles.css`）

命令项描述用次要色。可加 `.workbuddian-slash-cmd-desc { color: var(--text-muted); margin-left: var(--workbuddian-gap-xs); }`。非必需，缺省沿用 `at-suggest-item` 观感即可。

## 测试

`tests/slashCommand.test.ts` 追加：
- `extractSlashQuery('/', 1)` → `''`；`('/co', 3)` → `'co'`；`('/clear ', 7)` → `null`；`('hello', 5)` → `null`；`('/a\nb', 3)`（光标在第二行）→ `null`。
- `filterSlashCommands('')` → 9 项；`('co')` → `[compact, context, cost]`；`('clear')` → `[clear]`；`('zzz')` → `[]`。

UI（`updateSlashSuggest`/`insertSlashCommand`）obsidian 耦合，不测。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/shared/slashCommand.ts` | 加 `SlashCommandInfo`、`BUILTIN_SLASH_COMMANDS`、`extractSlashQuery`、`filterSlashCommands` |
| `tests/slashCommand.test.ts` | 追加上述用例 |
| `src/features/chat/input.ts` | `updateSlashSuggest` + `insertSlashCommand` |
| `src/features/chat/view.ts` | `oninput` 先 slash 后 @ 分派 + import |
| `styles.css`（可选） | 命令描述次要色 |

## 验收标准

1. 输入 `/` → 下拉列出全部 9 条内置命令（含描述）。
2. 输入 `/co` → 下拉仅剩 `compact` / `context` / `cost`。
3. 点选某条 → 输入框变为 `/name `（带尾空格），下拉关闭。
4. 输入 `/clear ` 之后（已过命令名，有空格）→ 命令补全消失。
5. 行中输入 `@` 的笔记补全仍正常（未被 slash 逻辑干扰）。
6. `npx jest` 全量绿（含新增用例）；`npm run build` 通过。
