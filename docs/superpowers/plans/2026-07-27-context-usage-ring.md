# 上下文用量圆环 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在输入区工具栏用一个 14px 圆环显示当前对话的上下文占用，≥80% 变红，无数据时不占位。

**Architecture:** 纯 UI 恢复。usage 的采集 / 传递 / 持久化链路（`parseUsage` → `done` chunk → `manager.setUsage` → `Conversation.lastUsage`）已完整存在且不动。新增两个纯函数到 `shared/contextUsage.ts`，视图层加一个常驻元素 + 一个渲染函数，样式用 `conic-gradient` + `mask`。

**Tech Stack:** TypeScript + esbuild、Jest + ts-jest、Obsidian Plugin API、CSS conic-gradient。

## Global Constraints

- 不新增任何 npm 依赖。
- 纯逻辑放 `src/shared` 并配 jest 单测；`import 'obsidian'` 的文件（`features/**`）按项目惯例不写单测。
- 用户可见文案走 `t()`，中英双语齐全。
- `main.js` 是提交进仓库的构建产物：改了 `src/**` 就要 `npm run build` 后把 `main.js` 一并提交。
- `npm run build` 内含 `tsc -noEmit`，必须零错误。
- 警示阈值常量 `USAGE_WARNING_PERCENT = 80`，圆环直径 14px，中孔半径 3px。
- 不显示常驻文字（这是该功能上次被移除的原因）；圆环不可点击。
- 分支 `main`，不 push、不打 tag。

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `src/shared/contextUsage.ts` | 用量纯逻辑 | 新增 `USAGE_WARNING_PERCENT` / `usageTooltip` / `isUsageWarning` |
| `tests/contextUsage.test.ts` | 纯逻辑测试 | 新增两组用例 |
| `src/i18n/index.ts` | 文案字典 | 新增 `input.contextUsage` |
| `src/features/chat/view.ts` | 面板 DOM 骨架 | 工具栏右侧组内、发送键前新增 `usageEl` |
| `src/features/chat/input.ts` | 输入区行为 | 新增 `renderContextUsage()`，由 `renderMessages` 末尾触发 |
| `src/features/chat/render.ts` | 消息渲染 | `renderMessages()` 末尾调用 `renderContextUsage(view)` |
| `styles.css` | 样式 | 新增圆环与警示态规则 |

---

### Task 1: 用量纯逻辑

**Files:**
- Modify: `src/shared/contextUsage.ts`
- Test: `tests/contextUsage.test.ts`

**Interfaces:**
- Consumes: 已有的 `formatTokenCount` / `contextPercent`
- Produces: `USAGE_WARNING_PERCENT: number`、`usageTooltip(used, windowSize): string`、`isUsageWarning(percent): boolean`

- [ ] **Step 1: 写失败的测试**

`tests/contextUsage.test.ts` 顶部 import 补上 `usageTooltip, isUsageWarning, USAGE_WARNING_PERCENT`，文件末尾追加：

```ts
describe('usageTooltip', () => {
    it('formats sub-1000 token counts without k', () => {
        expect(usageTooltip(999, 200000)).toBe('999 / 200k · 0%');
    });
    it('formats large counts with k and a rounded percentage', () => {
        expect(usageTooltip(22600, 200000)).toBe('22.6k / 200k · 11%');
    });
    it('caps the percentage at 100 when usage exceeds the window', () => {
        expect(usageTooltip(250000, 200000)).toBe('250.0k / 200k · 100%');
    });
    it('reports 0% for a non-positive window instead of dividing by zero', () => {
        expect(usageTooltip(5000, 0)).toBe('5.0k / 0 · 0%');
    });
});

describe('isUsageWarning', () => {
    it('is false below the threshold', () => {
        expect(isUsageWarning(0)).toBe(false);
        expect(isUsageWarning(79)).toBe(false);
    });
    it('is true at and above the threshold', () => {
        expect(isUsageWarning(USAGE_WARNING_PERCENT)).toBe(true);
        expect(isUsageWarning(100)).toBe(true);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/contextUsage.test.ts`
Expected: FAIL，TS 报三个导出不存在。

- [ ] **Step 3: 实现**

`src/shared/contextUsage.ts` 末尾追加：

```ts
/** 进入警示态的占比阈值（百分比） */
export const USAGE_WARNING_PERCENT = 80;

/** 悬停提示的数字部分，如 "22.6k / 200k · 11%" */
export function usageTooltip(used: number, windowSize: number): string {
    return `${formatTokenCount(used)} / ${formatTokenCount(windowSize)} · ${contextPercent(used, windowSize)}%`;
}

/** 占比是否达到警示线 */
export function isUsageWarning(percent: number): boolean {
    return percent >= USAGE_WARNING_PERCENT;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/contextUsage.test.ts`
Expected: PASS。若 `formatTokenCount(200000)` 的实际输出与断言不符（它对 ≥1000 一律用一位小数的 k），以函数实际行为为准修正断言，不要改 `formatTokenCount` —— 它已有既定测试和别处的调用方。

- [ ] **Step 5: 提交**

```bash
npm run build
git add src/shared/contextUsage.ts tests/contextUsage.test.ts main.js
git commit -m "feat: contextUsage 新增 usageTooltip 与警示阈值判定"
```

---

### Task 2: 圆环 UI 接线

**Files:**
- Modify: `src/i18n/index.ts`
- Modify: `src/features/chat/view.ts:183-186`
- Modify: `src/features/chat/input.ts`
- Modify: `src/features/chat/render.ts`（`renderMessages` 末尾）
- Modify: `styles.css`

**Interfaces:**
- Consumes: Task 1 的三个导出；已有的 `Conversation.lastUsage`、`settings.contextWindowSize`、`view.getActiveConversation()`
- Produces: 无（终端消费方）

按项目惯例，本任务全部落在 `obsidian`-importing 文件与 CSS 上，不写单测；验证靠构建 + 手动。

- [ ] **Step 1: 加 i18n 文案**

`src/i18n/index.ts` 中，在其它 `input.*` 文案附近插入：

```ts
    'input.contextUsage': { zh: '上下文用量', en: 'Context usage' },
```

- [ ] **Step 2: 加 DOM 骨架**

`src/features/chat/view.ts`：类字段区新增 `usageEl: HTMLElement;`（与 `sendBtn` 等字段并列）。

在 `buildUI()` 里 `const rightGroup = toolbar.createDiv({ cls: 'workbuddian-toolbar-right' });` 这行**之后**、`this.sendBtn = rightGroup.createEl(...)` 之前插入：

```ts
        this.usageEl = rightGroup.createDiv({ cls: 'workbuddian-usage-ring workbuddian-hidden' });
```

- [ ] **Step 3: 写渲染函数**

`src/features/chat/input.ts`：从 `../../shared/contextUsage` import `contextPercent, usageTooltip, isUsageWarning`，新增导出函数：

```ts
/** 刷新工具栏的上下文用量圆环：无 usage 数据时隐藏，有则更新占比、提示与警示态 */
export function renderContextUsage(view: WorkbuddianChatView) {
    const usage = view.getActiveConversation()?.lastUsage;
    if (!usage) {
        view.usageEl.addClass('workbuddian-hidden');
        view.usageEl.removeAttribute('title');
        return;
    }
    const percent = contextPercent(usage.inputTokens, view.settings.contextWindowSize);
    view.usageEl.removeClass('workbuddian-hidden');
    view.usageEl.style.setProperty('--workbuddian-usage-pct', String(percent));
    view.usageEl.setAttribute('title', `${t('input.contextUsage')} ${usageTooltip(usage.inputTokens, view.settings.contextWindowSize)}`);
    view.usageEl.toggleClass('workbuddian-usage-warning', isUsageWarning(percent));
}
```

（`t` 在 `input.ts` 中已 import；若 `toggleClass` 的签名不符，用 `if/else` 加减 class。）

- [ ] **Step 4: 接上刷新时机**

`src/features/chat/render.ts` 的 `renderMessages()`：在函数末尾 `scrollToBottom(view);` 之后加一行

```ts
    renderContextUsage(view);
```

并把它加进该文件已有的 `from './input'` import 列表。注意 `renderMessages` 的早退分支（无对话时的空状态 `return`）也要调用它，否则从有用量的对话切到空面板时圆环会残留 —— 在那个 `return` 之前同样加一行 `renderContextUsage(view);`。

- [ ] **Step 5: 加样式**

`styles.css` 末尾追加：

```css
/* 上下文用量圆环（工具栏内，发送键左侧） */
.workbuddian-usage-ring {
    --workbuddian-usage-color: var(--workbuddian-primary, #C8B487);
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex-shrink: 0;
    background: conic-gradient(
        var(--workbuddian-usage-color) 0 calc(var(--workbuddian-usage-pct, 0) * 1%),
        var(--background-modifier-border) calc(var(--workbuddian-usage-pct, 0) * 1%) 100%
    );
    -webkit-mask: radial-gradient(circle, transparent 3px, #000 3.5px);
            mask: radial-gradient(circle, transparent 3px, #000 3.5px);
}
.workbuddian-usage-ring.workbuddian-usage-warning {
    --workbuddian-usage-color: var(--text-error);
}
```

- [ ] **Step 6: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零 TS 错误；主仓测试全绿（注意 `.claude/worktrees/` 下的陈旧副本会一起被 jest 跑到，其结果与本改动无关）。

- [ ] **Step 7: 提交**

```bash
git add src/i18n/index.ts src/features/chat/view.ts src/features/chat/input.ts src/features/chat/render.ts styles.css main.js
git commit -m "feat: 工具栏恢复上下文用量圆环（悬停出数字，≥80% 变红）"
```

- [ ] **Step 8: 交给用户手动验收**

以下需要在 Obsidian 里肉眼确认，由用户执行（实现方不得声称已完成）：

1. 新对话时工具栏内没有圆环，模型下拉宽度与改动前一致。
2. 收到一次回复后圆环出现，悬停显示 `上下文用量 X / Y · Z%`。
3. 把设置里的「上下文窗口上限」临时改小到令占比 ≥80%，圆环变红。
4. 切到旧对话（无 usage）圆环消失，切回来又出现。
5. 自定义主色后，圆环正常态跟随新主色。
