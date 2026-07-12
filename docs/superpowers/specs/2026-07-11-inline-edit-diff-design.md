# 4.3 Inline Edit + Diff — 设计文档（第四阶段长任务 · 阶段 1）

- 日期：2026-07-11
- 阶段：ROADMAP 第四阶段 4.3（Inline Edit + Diff；Plan Mode 暂缓）
- 状态：已确认 scope，待 review

## 目标

在笔记里选中一段文本 → 命令触发 → 填编辑要求 → CodeBuddy 改写 → 行级 diff 预览 → 接受则写回编辑器、拒绝则不动。

## 非目标

- 不做 Plan Mode（依赖 CLI 返回结构化计划事件，未知，暂缓）。
- 不做 Write/Edit 工具结果的 diff（那是 agent 自主写文件的场景，本项目是聊天桥接，不涉及）。
- 不做多段/整篇批量编辑（仅当前选区）。

## 设计

### 模块划分（保持纯逻辑可测 + obsidian 隔离）

| 文件 | 职责 | obsidian 依赖 |
|---|---|---|
| `src/shared/lineDiff.ts` | 行级 diff 算法（LCS） | 无（可测） |
| `src/shared/editPrompt.ts` | 组装强约束编辑 prompt | 无（可测） |
| `src/features/inline-edit/index.ts` | 命令注册、指令 Modal、diff Modal、写回 | 有 |
| `src/main.ts` | 注册命令 | 有 |
| `styles.css` | diff 行 +/- 样式 | — |

### ① 纯逻辑

```ts
// lineDiff.ts
export interface DiffLine { type: 'equal' | 'add' | 'remove'; text: string; }
export function lineDiff(oldText: string, newText: string): DiffLine[];
// 按 \n 切行，LCS 求最长公共子序列，回溯输出 equal/remove/add 行序列

// editPrompt.ts
export function buildEditPrompt(selection: string, instruction: string): string;
// 返回强约束 prompt：要求「只输出改写后的正文，不要解释/前后缀/代码块标记」+ instruction + 原文
```

### ② CLI 调用（复用现有 provider）

`features/inline-edit/index.ts` 内一个 helper：

```ts
async function collectEditResult(api, sessionId, prompt, vaultPath): Promise<string> {
    let text = '';
    for await (const chunk of api.sendMessage(sessionId, prompt, vaultPath)) {
        if (chunk.type === 'text') text += chunk.content;
        if (chunk.type === 'error') throw new Error(chunk.content);
    }
    return text.trim();
}
```

用新生成的 sessionId（一次性，不进聊天历史）。

### ③ 流程（命令 editorCallback）

`main.ts` 注册命令 `inline-edit`（name「用 CodeBuddy 编辑选区」），`editorCallback: (editor, view) => runInlineEdit(...)`（Obsidian 仅在有编辑器时显示）。

`runInlineEdit(app, api, editor)`：
1. `const selection = editor.getSelection()`；为空 → `new Notice('请先选中一段文本')` 返回。
2. 弹**指令 Modal**（输入框 + 确认）拿到 `instruction`；取消则中止。
3. `buildEditPrompt(selection, instruction)` → `collectEditResult(...)` 拿 `edited`（编辑中显示 Notice「CodeBuddy 编辑中…」）。
4. `lineDiff(selection, edited)` → 弹 **diff Modal**：逐行渲染（`equal` 普通、`add` 绿底 `+`、`remove` 红底 `-`）+ 「接受」「拒绝」按钮。
5. 接受 → `editor.replaceSelection(edited)`；拒绝 → 关闭，选区不变。

两个 Modal 用 Obsidian `Modal` 子类（`InstructionModal`、`DiffModal`），放 `features/inline-edit/index.ts`。

### ④ 样式（styles.css）

`.workbuddian-diff-line`、`.workbuddian-diff-add`（`--background-modifier-success` 系）、`.workbuddian-diff-remove`（`--background-modifier-error` 系）、等宽字体。

## 测试

- `tests/lineDiff.test.ts`：相同文本全 `equal`；单行改 → `equal`+`remove`+`add`；全新增/全删除；空串。
- `tests/editPrompt.test.ts`：包含 selection、instruction、且含「只输出改写后的正文」约束。
- Modal / 命令 / 写回 obsidian 耦合，不测。

## 改动清单

| 文件 | 动作 |
|---|---|
| `src/shared/lineDiff.ts` | Create |
| `src/shared/editPrompt.ts` | Create |
| `tests/lineDiff.test.ts` | Create |
| `tests/editPrompt.test.ts` | Create |
| `src/features/inline-edit/index.ts` | Create（命令流程 + 两个 Modal + collectEditResult） |
| `src/main.ts` | Modify（注册 inline-edit 命令） |
| `styles.css` | Modify（diff 样式） |

## 验收标准

1. 选中笔记一段文本 → 命令面板「用 CodeBuddy 编辑选区」可用（无选区时提示）。
2. 填要求（如「改简洁」）→ 稍候弹出 diff 预览（红 - / 绿 +）。
3. 「接受」→ 选区被替换为改写结果；「拒绝」→ 原文不变。
4. `npx jest` 全量绿（含 `lineDiff`/`editPrompt` 用例）；`npm run build` 通过。

## 风险与缓解

- **CLI 是否「只返回正文」未知**：`buildEditPrompt` 用强约束；若 CLI 仍夹带解释，diff 会显示多余行——你实测后我调 prompt（约束措辞 / 加 few-shot）。这是本阶段唯一的不可预判点。
- **diff 算法正确性**：`lineDiff` 用经典 LCS，TDD 覆盖。
- **写回破坏笔记**：只 `replaceSelection`（作用于当前选区），且经用户「接受」确认；拒绝零副作用。
