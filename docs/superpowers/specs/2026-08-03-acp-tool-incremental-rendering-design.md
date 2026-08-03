# tool_call_update 增量渲染（乙方案）设计

> 日期：2026-08-03 ｜ 状态：已批准（头脑风暴两段确认：范围选 A、方案甲）
> 前置：ACP provider v2 已落地（`docs/superpowers/plans/2026-08-03-acp-provider-v2.md`，12 任务全绿）；`/tmp/acp-spike/traffic.jsonl` 全量报文日志

## 1. 背景与目标

ACP v2 首步按 spec 把 `tool_call_update` 压成"仅进内部状态、不吐 chunk"，代价是工具行只剩一行标题：长 Write/计划生成过程用户看不到任何进展，v1.5.0 的 Edit diff 预览与撤销按钮也一并失效（`toolDetail` 从 JSON 入参变成了摘要字符串，`parseFileChange` 拿不到原料）。

本设计（ROADMAP 2.0 第二步首件，spec §6 所称"乙方案"）恢复三者：**工具参数流式可见、completed 出 diff 预览、Edit 撤销按钮**。

## 2. Spike 事实依据（traffic.jsonl 复查，2026-08-03）

| # | 事实 | 设计含义 |
|---|---|---|
| 1 | `tool_call_update` 的 `rawInput` 是**快照**（单调增长的全量），不是增量 | v2 首版的 `mergeRawInput` 浅合并语义错误（当前未吐 chunk 故无 bug，一吐即显形）——必须改为"同 toolCallId 最新快照直接替换" |
| 2 | `tool_call` 的 `status` 取值 `in_progress`/`pending`；`tool_call_update` 流式中无 status，终态为 `status:'completed'` | 终态信号 = completed 的 update；其余 update 一律视为流式中 |
| 3 | `tool_call_update` 带 `_meta['codebuddy.ai/toolName']` | 完成 chunk 的 toolName 可直接取；`session.ts` 仍缓存 tool_call 时的名字兜底 |
| 4 | 单次 Write 可有 40+ 条流式 update | UI 只做文本 `setText` 就地更新，不加节流（YAGNI，性能实测后再议） |

## 3. 已拍板决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 撤销按钮 | **A. 本步顺带恢复插件侧撤销**（复用 v1 `parseFileChange`/`undoEdit` 原路径） | v1.5.0 已在用的功能，恢复成本远低于任务 A 的新机制；任务 A 的 checkpoint rewind 落地后再退役 |
| 增量通道 | **方案甲：tool chunk 加可选字段，按 toolCallId 就地更新** | UI 只需一个 Map + 就地更新分支；契约纯增量兼容；改动收敛在 events/session 两个纯模块 + input.ts 一个分支 |

## 4. 架构设计

### 4.1 数据流

```
tool_call
  → events.mapSessionUpdate 出 {type:'tool', toolCallId, toolName, toolDetail:''}
  → UI 新增工具行，登记 Map<toolCallId, row>
tool_call_update（流式中，无 status）
  → session 快照替换内部状态，发 {type:'tool', toolCallId, toolDetail: summarizeRawInput(快照)}
  → UI 按 toolCallId 就地改行文本（不新增行）
tool_call_update（status:'completed'）
  → 发 {type:'tool', toolCallId, toolStatus:'completed', toolDetail: JSON.stringify(快照)}
  → UI 就地更新 → parseFileChange(toolName, JSON) → diff 块 + vault 内 Edit 出撤销按钮
```

### 4.2 组件改动（四个文件，三个纯逻辑）

- **`StreamChunk`（`providers/codebuddy/index.ts`）**：加 `toolCallId?: string; toolStatus?: 'in_progress' | 'completed'`，可选字段向后兼容，provider 逻辑零改动（chunk 透传）。
- **`acp/events.ts`**：新增 `mapToolCallUpdate(update, snapshot): StreamChunk | null`（completed → JSON detail + toolStatus；否则摘要 detail）；`mapSessionUpdate` 的 tool_call 分支补 `toolCallId`。
- **`acp/session.ts`**：`toolInputs` 改快照替换语义；新增 `toolNames: Map<id, name>` 缓存兜底；`handleUpdate` 的 tool_call_update 分支从"只累积"改为"替换 + 吐 chunk"。
- **`features/chat/input.ts`** tool 分支最小重构：建行逻辑不变 + toolCallId 登记；map 命中改文本；`toolStatus==='completed'` 时执行现有 diff/undo 渲染块。

### 4.3 边界与错误处理

- map 未命中的 completed（回放已被吞，理论不出现）：兜底走新建行路径。
- 非文件工具（快照无 file_path）：`parseFileChange` 返回 null，只更新文本。
- cancel/超时使工具停在 in_progress：行保持最后快照，无 diff，可接受。
- completed 重复到达：行 `dataset.diffRendered` 幂等跳过。
- plan 文件的 Write 快照流照常显示（信息性），无特判。
- 顺手修存量小漏：`session busy` 错误经 `t('provider.busy')` 映射（v2 已加的 key 目前空挂）。

## 5. 测试策略

- 纯逻辑单测：events 增量/完成映射（含 toolName 兜底）；session 快照替换语义（后到快照缩短也生效）与发射节奏（流式 N 条 + 完成 1 条）；provider 全链路 chunk 序列（tool_call → 增量 → completed）。
- `provider.busy` 映射补一条 provider 测试。
- UI 不可测部分进 demo-vault 手测清单：长 Write 行文本实时增长、Edit 完成出 diff、撤销生效、双面板不串行。
- i18n 无新 key（diff/撤销/工具行文案 v1 已有）。

## 6. 非目标（YAGNI）

- Bash 终端块、词级 diff（第二步任务 C）
- checkpoint/rewind UI（第二步任务 A；落地后插件侧撤销按钮退役）
- plan 快照流的特判渲染
- 流式更新的节流/防抖（实测有性能问题再加）

## 7. 验收标准

1. 全量 jest 绿 + `npm run build` 过。
2. demo-vault 手测：长 Write 行文本实时增长；Edit 完成出 diff 预览；vault 内 Edit 出撤销按钮且撤销生效；双面板各自行不串；批准卡流程不回归。
3. `src/features/chat` diff 仅含 tool 分支的就地更新与 diff/undo 复活，无其他改动。
