# CodebuddyProvider v2：ACP 持久会话架构（设计定稿）

> 日期：2026-08-03 ｜ 状态：已批准（头脑风暴三段确认：批准卡 A、一刀切 A、方案一）
> 前置事实：`/tmp/acp-spike/` 五个 probe 脚本实测（traffic.jsonl 全量报文日志）

## 1. 背景与目标

v1 的 provider 每轮 spawn 一个 `codebuddy --print --output-format stream-json` 进程，属于"单发进程"架构，与 Claudian（Claude Agent SDK / ACP 持久会话）存在架构代差：无法执行前批准、无法真计划批准、无法持久会话上下文、cancel=杀进程（且双面板共享进程会误杀）。

ROADMAP 2.0 第一步（用户拍板的三步走之首）：**消灭架构代差**——provider v2 全部走 ACP（Agent Client Protocol，`codebuddy --acp`，stdio ndjson JSON-RPC）。

**UI 层零改动**是硬约束：`StreamChunk` 契约与 `CodebuddyProvider` 公共方法签名保持不变。

## 2. Spike 事实依据（2026-08-03 实测，七问七答）

| # | 问题 | 实测结论 |
|---|---|---|
| 1 | 握手 | `initialize(protocolVersion:1)` → 能力声明（prompt:image+embeddedContext、mcp:http+sse、loadSession、delegateTools、authMethods）；`session/new` → sessionId + models（含价格倍率/supportsImages）+ configOptions + availableCommands |
| 2 | 权限请求 | `session/request_permission`：options=`allow_always/allow_once/reject_once`，附完整 toolCall（rawInput）。批准一次即真实落盘 |
| 3 | 多轮 | 同进程同 session 多轮，上下文真保持（第 2 轮 3.9s vs 首轮 13.3s）；同进程多 session 可行 |
| 4 | 事件 | `agent_message_chunk`/`agent_thought_chunk`/`tool_call`/`tool_call_update`（rawInput 增量）/`usage_update`（含分类与真实窗口 168000）/`session_info_update`(agentPhase)/`config_option_update`/`available_commands_update`/`user_message_chunk`/`_codebuddy.ai/checkpoint` |
| 5 | 取消 | `session/cancel` 即时生效，`stopReason:"cancelled"`。**已知瑕疵**：cancel 后立刻再 prompt 会串响应（同 userMessageId 重复返回），实现须等 idle |
| 6 | 恢复 | `session/load` 全量回放历史（消息/思考/工具/checkpoint/usage） |
| 7 | 计划 | `session/set_mode plan` → 计划正文经 message chunk 输出 → `DeferExecuteTool` 权限请求 → 批准 → 自动继续执行（同轮 Edit 落盘）。真·计划批准端到端成立 |

配置项（`session/set_config_option`）：`mode`(default/acceptEdits/plan/auto/dontAsk/bypassPermissions/fullAccess)、`model`(11 个)、`thought_level`(7 档)、`sandbox`。

## 3. 已拍板决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 批准 UI 形态 | **A. 气泡内批准卡** | 与 v1.5.0 卡片体系统一；不阻断滚动；批准历史可回看 |
| 旧 spawn 路径 | **A. 一刀切，只留 ACP** | 双路径=两套测试矩阵永久维护；CLI 随 WorkBuddy 自动更新；握手预检+明确报错兜底 |
| 整体架构 | **方案一：单进程多 session + 会话懒加载** | 一次启动成本、内存最省（probe 实证）、session 隔离修掉共享误杀 bug |
| 协议选型 | ACP（非 AG-UI/A2A/私有 stream-json） | 同代际唯一开放标准 + CodeBuddy 一等公民接口；CodeBuddy 不支持 AG-UI/A2A（2026-08-03 复查 --help） |

## 4. 架构设计

### 4.1 分层与组件

```
features/chat (view/input/render/tabs)   ← 零改动，StreamChunk 契约不变
        ↑ StreamChunk（异步生成器）+ 旁路回调（批准/用量/配置）
providers/codebuddy/
  index.ts          CodebuddyProvider v2 —— 对外契约原样保留
  acp/client.ts     AcpClient —— 进程 + ndjson + JSON-RPC 分发（纯 Node）
  acp/session.ts    AcpSession —— 单会话状态机 + SessionRegistry 逻辑
  acp/events.ts     ACP 事件 → StreamChunk 映射（纯函数）
  acp/permission.ts 权限请求 → 批准卡数据 + 应答构造（纯函数）
```

新模块全部无 obsidian import（延续"逻辑可测"铁律，jest 无需 obsidian mock）。

数据流：`input.ts → provider.sendMessage → 会话懒加载 → session/prompt → session/update 映射成 chunk 回流 → 权限请求走旁路回调出批准卡 → 用户点击 → 应答 → prompt 响应 → done chunk`。

### 4.2 AcpClient 传输层

- 进程：spawn `codebuddy --acp`，完整复用 `utils/cliPath.ts` 探测与三分支 spawn 策略（Windows wrapper / bare fallback / script-via-node）。
- **懒启动**：首次 sendMessage 才拉起进程+握手（10s 超时），不拖慢 Obsidian 启动。
- 分发：id 递增请求表；通知与 agent 请求按 sessionId 路由到 AcpSession；stderr 进 bbLog。
- 预检失败分级：CLI 不存在（沿用 `provider.cliNotFound`）/ 旧版无 `--acp`（新文案"请升级 WorkBuddy"）/ 疑似未登录。失败后所有发送立即 error chunk，不重试轰炸。

### 4.3 会话映射

- `Conversation` 新增 `acpSessionId?: string`（CLI 分配，以此为准）；现有 `sessionId`（v1 uuid）保留作兼容字段。
- 懒加载：首次发送时有 acpSessionId → `session/load`；没有 → 先试 `session/load(旧uuid)`（v1 `--session-id` 建的会话 CLI 侧可能真存着），失败则 `session/new` 并回写。
- **消息历史以插件持久化（manager/saveData）为唯一真相**；load 回放事件 provider 层吞掉不进 UI。
- 状态机：`idle → prompting → (awaitingPermission → prompting)* → idle`；cancel 后必须等 prompt 响应落账才回 idle（spike 瑕疵⑤兜底）。
- 双面板：事件按 sessionId 路由，两面板可同时流式；`cancel(sessionId)` 定向——v1"A 停止杀 B"bug 消灭。
- vault 外附件：删除 `--add-dir` + `Read(dir/**)` 预授权 hack；外部文件 Read 在 default 模式弹批准卡（可"总是允许"），acceptEdits/bypass 不弹。

### 4.4 事件映射（events.ts 纯函数）

| ACP 事件 | 映射 |
|---|---|
| `agent_thought_chunk` | `{type:'thinking'}` |
| `agent_message_chunk` | `{type:'text'}` |
| `tool_call` | `{type:'tool', toolName: _meta.toolName ?? title, toolDetail: rawInput 摘要}`，一次一卡 |
| `tool_call_update` | 仅进内部状态（rawInput 累积），不吐 chunk（乙方案第二步再用） |
| `usage_update` | 旁路 `onUsage(used, size)` → 用量环；用户改过 `contextWindowSize` 则以用户值为准 |
| `config_option_update` | 旁路 → 同步工具栏 mode/model 显示（CLI 为真相源） |
| `session_info_update` / `_codebuddy.ai/checkpoint` / `available_commands_update` | 内部状态/仅日志 |
| prompt 响应 stopReason | `end_turn`→done；`cancelled`→现有停止路径；refusal/异常→error |

### 4.5 批准流

- view 注册 `onPermissionRequest`；收到 `{requestId, sessionId, toolName, 参数摘要, options}` 后在当前 assistant 气泡区渲染批准卡（复用 v1.5.0 卡片样式）：Write→路径+行数；Edit→路径+diff 预览；Bash→命令全文。按钮 `[允许] [总是允许] [拒绝]` → `respondPermission(requestId, optionId)`。
- **DeferExecuteTool 特化**：「计划已就绪」+ `[按此执行] [总是执行] [取消]`。v1.5.0 的 `renderPlanCard`/`isPlanFilePath`/`permissionModeOverride` 全套 workaround **删除退役**。
- 权限模式（工具栏 3 档不变）：default→批准卡；plan→CLI 只读+计划批准卡；bypassPermissions→CLI 放行无卡。切换改为 `session/set_config_option` **按会话设置**——双面板泄漏在协议层绝迹（v1 靠纪律，v2 靠结构）。
- 悬挂边界：批准卡挂着时关面板/切会话/卸载 → 统一答 `reject`；批准请求不设超时；单轮总超时照常计时。
- 模型列表：`getAvailableModels` 改从 `session/new` 的 models 取（含价格倍率），握手空窗回退 `FALLBACK_MODEL_OPTIONS`；`fetchModels(--help)` 删除。

### 4.6 错误处理

- 单轮超时：`cliTimeout` 到点 → `session/cancel` + 错误卡「超时已中断」（进程保活）。
- 进程死亡：in-flight 轮次全部 error chunk 收尾；下次发送自动重启 + 受影响会话逐一 `session/load`（CLI 侧上下文不丢）。
- cancel 竞态：状态机锁 + view 层 isStreaming 双保险。
- 卸载：onunload → 拒悬挂批准 → terminate 进程。

## 5. 测试策略

- 纯逻辑单测：`acp/events.ts`、`acp/permission.ts`、会话状态机。
- AcpClient：mock `child_process`（沿用 `tests/api.test.ts` harness 模式）——编解码、请求匹配、sessionId 路由、死亡重连。
- provider v2：mock AcpClient 层测生成器契约（chunk 序列与 v1 测试对齐改写）。
- **删除**：`parseStreamLine`/`parseMessageBlock`/`blockToChunk`/`parseUsage` 全套旧解析及测试、`fetchModels` 及测试、`--add-dir` 预授权逻辑与测试。
- 手动集成冒烟（不进 jest）：`scripts/acp-smoke.mjs` 用真 CLI 回归 spike 七问。
- i18n 新增批准卡/错误文案 key（中英）；manifest 不动；settings 版本不动（无新设置项）。

## 6. 非目标（YAGNI，本设计明确不做）

- fork / rewind / checkpoint UI（第二步任务 A）
- MCP 配置、Skills、@外部目录、@子代理（第二步任务 B）
- 词级 diff、Bash 终端块、thought_level UI、文生图（第二步任务 C）
- `tool_call_update` 增量渲染（随乙方案进第二步）
- embeddedContext/image 内容块（图片仍走现有路径注入，第二步再升级）

## 7. 验收标准

1. 全量 jest 绿（新层测试 + 改写后的契约测试），`npm run build` 过。
2. demo-vault 手测：多轮对话（第二轮明显更快）、批准卡三按钮各自生效、plan 模式出真批准且执行落盘、cancel 定向（双面板互不影响）、进程杀掉后重发自动恢复、旧版 CLI 报错卡文案正确。
3. UI 层（features/chat）diff 仅含批准卡注册/渲染——无其他改动。
