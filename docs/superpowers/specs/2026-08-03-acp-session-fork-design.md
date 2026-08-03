# 会话分叉（fork）UI 设计——ROADMAP 2.0 第二步任务 A

> 日期：2026-08-03 ｜ 状态：已批准（用户授权按"只做 fork"范围自主执行）
> 前置事实：2026-08-03 两次活探针实测（/tmp/acp-rewind-probe.mjs、/tmp/acp-branch-probe.mjs）

## 1. 背景与目标

v2 批准流落地后，任务 A 的原设想是 fork / rewind / checkpoint UI 三件套。实测后收敛为**只做会话级 fork**：把当前对话从当前点开出一条支线继续，互不污染。

## 2. 探针事实依据（2026-08-03 实测）

| # | 结论 | 证据 |
|---|---|---|
| 1 | ACP **无任何 rewind/restore 方法** | `session/rewind`、`_codebuddy.ai/rewind`、`_codebuddy.ai/checkpoint/restore`、`_codebuddy.ai/checkpoint.restore`、`session/checkpoint/restore` 全部 `-32601 Method not found` |
| 2 | checkpoint 只有被动通知，无 before/after 内容 | `_codebuddy.ai/checkpoint`：`{id, createdAt, fileChanges:{files:[{uri,changeType}], totalAdditions, totalDeletions}}` |
| 3 | `/branch <名>` 经 prompt 文本触发即分叉 | stopReason end_turn；CLI 侧生成新会话 `<newId>.jsonl` |
| 4 | 分叉的新 sessionId **经 wire 回报** | `session_info_update` 的 `_meta`：`{"codebuddy.ai/sessionReset":true,"codebuddy.ai/newSessionId":"<uuid>"}` |
| 5 | 分叉会话可 load 恢复，分叉名成为 CLI 侧会话标题 | `session/load(newSessionId)` OK；回放带 `title:"probe-fork"` |
| 6 | fork 只能从**会话当前末尾**分叉 | 消息级 fork 需先 rewind，而 rewind 不存在（事实 1） |

## 3. 已拍板决策

| 决策 | 结论 | 理由 |
|---|---|---|
| rewind/checkpoint 回滚 | **不做，入档搁置** | CLI 未暴露能力（事实 1/2），不硬造插件侧回滚（checkpoint 无内容快照，造了也不可靠） |
| fork 粒度 | **会话级**（当前末尾分叉） | 消息级依赖 rewind，不可得（事实 6） |
| 入口 | 会话标签**右键菜单**加「分叉当前会话」 | tabs.ts 已有导出/复制右键菜单，同构最小 UI |
| 分叉命名 | 自动 `分叉 - <原会话标题>`（可后再重命名） | YAGNI；重命名功能已有 |
| 消息历史 | 新 Conversation **复制**原会话全量消息 | 插件持久化是唯一真相；CLI 侧 load 回放吞掉（v2 已有机制） |

## 4. 架构设计

### 4.1 数据流

```
用户右键会话标签 → 「分叉当前会话」
  → view.api.forkSession(conv.sessionId, name)
    → registry.get(key) → ensureLoaded(vaultPath)（未加载则先 load）
    → AcpSession.fork(name)：要求 status==='idle'
      → client.request('session/prompt', {prompt:[{type:'text', text:'/branch '+name}]})
      → 期间 session_info_update 带 newSessionId → session 捕获（无论 handlers 是否挂载）
      → prompt 落账 → 返回 newSessionId（未捕获到 → 抛 fork 失败）
  → manager.forkConversation(convId, name, newSessionId)：新建 Conversation（复制消息、回写 acpSessionId、persist）
  → switchToChat(view, 新会话) → Notice「已分叉」
```

fork 轮次的流式事件（thought/message/usage 等）不进 UI：fork 走独立 handlers（全部丢弃），不占 sendText 通道。`session_info_update` 的 newSessionId 捕获**先于** handlers 空检查（否则事件被丢弃）。

### 4.2 组件改动

- **`acp/session.ts`**：
  - `handleUpdate` 在最前部（handlers 空检查之前）检测 `session_info_update` 且 `_meta['codebuddy.ai/sessionReset']` → 记录 `lastForkedSessionId = _meta['codebuddy.ai/newSessionId']`。
  - 新增 `fork(name: string): Promise<string>`：`status !== 'idle'` 或 `!acpSessionId` → 抛错；`lastForkedSessionId = null`；发 `/branch name` prompt（handlers 传丢弃实现）；resolve 后读 `lastForkedSessionId`，无则抛 `fork failed`。
- **`providers/codebuddy/index.ts`**：新增 `async forkSession(sessionKey: string, name: string): Promise<string>`：`ensureStarted` → `registry.get(key)` → `ensureLoaded` → `session.fork(name)`。启动失败沿用 `startErrorMessage` 映射。
- **`core/session/manager.ts`**：新增 `forkConversation(sourceId: string, title: string, acpSessionId: string): Conversation | null`：复制源会话消息（深拷贝数组、消息 id 重新生成），`sessionId: ''`（首次发送时由 input.ts 生成 v1 key）、`acpSessionId` 写入、触发 persist。
- **`features/chat/tabs.ts`**：右键菜单加项；handler 校验 `conv.sessionId` 非空（未发过消息 → Notice「先发送一条消息再分叉」）与 `!view.isStreaming`（流式中 → Notice「响应中，稍候」）；成功后 `switchToChat`。
- **`i18n`**：新增 `'tabs.fork'`（分叉当前会话/Fork this chat）、`'tabs.forked'`（已分叉：{title}）、`'tabs.forkFailed'`（分叉失败）、`'tabs.forkNeedMessage'`（先发送一条消息再分叉）、`'tabs.forkStreaming'`（响应中，稍候再分叉）。
- **`scripts/acp-smoke.mjs`**：增补第 10 步——`/branch smoke-fork` → 捕获 newSessionId → `session/load` 验证。

### 4.3 边界与错误处理

- fork 期间 cancel/超时：fork 不走 sendText 的超时逻辑；`session.fork` 自带 60s 兜底超时（Promise.race），超时抛 fork 失败。
- 分叉后**原会话**继续发消息：原 acpSessionId 不变；CLI 对原 session 的后续行为未实测——列入手测（原会话继续对话是否保持分叉前上下文）。
- 双面板：fork 只读 key 对应会话；不影响另一面板在飞轮次（fork 要求自身 idle）。
- fork 产生的新会话在 CLI 侧立即可 load（探针事实 5），插件侧首次发送时走既有懒加载链。

## 5. 测试策略

- 纯逻辑单测：session.fork（正常返回 newSessionId / busy 拒绝 / 未加载拒绝 / 未捕获 id 抛 fork failed / fork 轮 chunk 不外泄）；manager.forkConversation（消息复制、acpSessionId、persist、源不存在返 null）。
- provider 层（fake client）：forkSession 全链路（ensureLoaded 先 load 再 fork）；newSessionId 经 events.onSessionUpdate 注入断言。
- UI 不可测：build + 手测清单用例。
- smoke 第 10 步真 CLI 回归。

## 6. 非目标（YAGNI）

- rewind / checkpoint 回滚 UI（CLI 未暴露，入档搁置）
- 消息级 fork（依赖 rewind）
- checkpoint 只读时间线/改动统计标注（与 diff 块信息重复）
- fork 命名弹窗（自动命名 + 既有重命名）

## 7. 验收标准

1. 全量 jest 绿 + `npm run build` 过。
2. `node scripts/acp-smoke.mjs` 10/10（含 fork 步）。
3. demo-vault 手测：右键分叉 → 新会话含全部历史消息 → 新会话续聊上下文保持（load 命中）→ 原会话继续对话行为记录。
