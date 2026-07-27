# 上下文用量圆环（ROADMAP 4.1 恢复）

## 背景

ROADMAP 4.1「上下文用量指示器」在 v0.3.0 曾完整实现：CLI `result` 事件的 `usage.input_tokens` 作为「已用上下文」，输入区工具栏渲染 `conic-gradient` 环形仪表盘 + `22.6k · 11%` 文字。同版本的工具栏重排把它移除了，原因是「太占地方」——具体是圆环**加上文字**吃掉横向空间，把模型下拉挤没了。

**数据层从未拆除，至今完好**：

| 环节 | 位置 | 状态 |
|---|---|---|
| 解析 CLI usage | `providers/codebuddy` 的 `parseUsage` | 在 |
| 传递 | `done` chunk 携带 usage | 在 |
| 写入 | `input.ts` 流式 `done` 分支调 `manager.setUsage` | 在 |
| 持久化 | `Conversation.lastUsage`（随 flush 落盘） | 在 |
| 窗口上限设置 | `settings.contextWindowSize`（默认 200000） | 在 |
| 纯逻辑 | `shared/contextUsage.ts` 的 `formatTokenCount` / `contextPercent`（含测试） | 在 |
| **UI** | `renderContextUsage` + 相关 CSS | **已移除** |

因此本次是纯 UI 恢复，不碰数据链路。

## 目标

- 在输入区工具栏显示当前对话的上下文占用，且**不重蹈「占地方」的覆辙**。
- 上下文接近上限时给出无需阅读的视觉警示。
- 没有用量数据时完全不占位。

## 非目标

- 不改动 usage 的采集、传递、持久化逻辑。
- 圆环不可点击（不做「点击改窗口大小」之类的入口）。
- 不显示常驻文字（这正是上次被移除的原因）。
- 不做多档渐变色。

## 方案

### 纯逻辑：`src/shared/contextUsage.ts`

在现有两个函数之外新增：

```ts
/** 进入警示态的占比阈值 */
export const USAGE_WARNING_PERCENT = 80;

/** 悬停提示的数字部分，如 "22.6k / 200k · 11%" */
export function usageTooltip(used: number, windowSize: number): string;

/** 占比是否达到警示线 */
export function isUsageWarning(percent: number): boolean;
```

`usageTooltip` 复用 `formatTokenCount` 与 `contextPercent`，保证与圆环显示的百分比一致。

### 视图骨架：`src/features/chat/view.ts`

在工具栏右侧组内、**发送键之前**创建常驻元素（`view.ts:183` 的 `rightGroup` 之后、`sendBtn` 之前）：

```ts
this.usageEl = rightGroup.createDiv({ cls: 'workbuddian-usage-ring workbuddian-hidden' });
```

字段声明为 `usageEl: HTMLElement`。放在发送键左侧，是因为发送键有 `flex-shrink: 0` 且必须永远可见；圆环在它左边不会把它挤出。

### 渲染：`src/features/chat/input.ts`

新增 `renderContextUsage(view)`：

1. 取 `view.getActiveConversation()?.lastUsage`。无对话或无 `lastUsage` → 给 `usageEl` 加 `workbuddian-hidden`、清空 `title`，返回（元素不占位）。
2. 有数据 → 去掉 `hidden`；用 `contextPercent(used, settings.contextWindowSize)` 算占比，写进 CSS 自定义属性 `--workbuddian-usage-pct`；`title` 设为 `${t('input.contextUsage')} ${usageTooltip(...)}`；按 `isUsageWarning(percent)` 增删 `workbuddian-usage-warning` class。

调用时机沿用原设计：在 `renderMessages()` 末尾统一调一次。这一条路径覆盖了发送完成、切换对话、切换标签、面板重建等所有场景，无需在各处分别埋点。

### 样式：`styles.css`

```css
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

警示态只改一个自定义属性，不重复整段 `conic-gradient`。`--workbuddian-usage-pct` 是无单位数字（如 `11`），`calc(11 * 1%)` 得到 `11%`。

中孔用 `mask` 抠出，避免实心饼过重。`workbuddian-hidden` 是项目已有的隐藏类。

### i18n：`src/i18n/index.ts`

新增一条：`'input.contextUsage': { zh: '上下文用量', en: 'Context usage' }`。数字部分不翻译。

## 边界情况

| 情况 | 行为 |
|---|---|
| `contextWindowSize` 被改为 0 或负数 | `contextPercent` 已返回 0 → 空环、tooltip 显示 0%，不崩 |
| 实际用量超过窗口设置 | `contextPercent` 已封顶 100 → 满环 + 警示色 |
| 切到没有 `lastUsage` 的旧对话 | 元素隐藏，工具栏回到原样 |
| 用户自定义了主色 | 圆环跟随 `--workbuddian-primary`；警示态固定用 `--text-error` |

## 测试

`tests/contextUsage.test.ts` 补充：

- `usageTooltip`：<1000（`999 / 200000`）、≥1000（`22600 → 22.6k / 200k · 11%`）、用量超窗口时百分比封顶 100、窗口为 0 时不除零。
- `isUsageWarning`：79 → false、80 → true、100 → true、0 → false。

视图层（`view.ts` / `input.ts`）按项目惯例不写单测。

## 验收标准

- [ ] `npm run build` 通过（tsc typecheck + esbuild）。
- [ ] `npm test` 全绿，含上述新增用例。
- [ ] 新对话时工具栏内看不到圆环，且模型下拉宽度与改动前一致。
- [ ] 收到一次回复后圆环出现，悬停显示 `上下文用量 X / Y · Z%`。
- [ ] 把 `contextWindowSize` 临时改小到令占比 ≥80%，圆环变红。
- [ ] 切换到旧对话（无 usage）圆环消失，切回来又出现。
