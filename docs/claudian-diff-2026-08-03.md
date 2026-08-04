# Workbuddian vs Claudian 代码级功能剖析（2026-08-03）

> 对照对象：Claudian 2.0.44（commit `f9adf35`，/tmp/claudian 浅克隆精读，462 个 ts 文件）
> 本方：Workbuddian main @ `b18a45e`（ACP v2 + ROADMAP 2.0 第二步完成态）

## 0. 架构层

| | Claudian 2.0.44 | Workbuddian |
|---|---|---|
| 执行抽象 | `core/execution/` 契约（`ProviderExecutionSession`/`ProviderInteractionPort`），Claude 为 `providers/claude/` 实现之一（另有 codex/opencode/grok/pi） | 单 provider，`providers/codebuddy/acp/` 四层（client/session/events/permission） |
| 流式管线 | SDK message → `transformClaudeMessage`（generator 拆块）→ `ClaudeExecutionEventNormalizer` → StreamController → `StreamingRenderCoordinator`（**rAF + 150ms 节流**） | ACP session/update → `events.ts` 纯映射 → AcpSession → 生成器 → input.ts 直接渲染（**无节流**） |
| 消息真相 | provider 原生历史（`~/.claude/projects/**`）+ vault 元数据（`.claudian/sessions/`） | 插件持久化唯一真相（data.json）+ CLI 侧 session/load |

## 1. 逐项机制对照

### 批准流
- Claudian：SDK `canUseTool` → `ClaudeInteractionHandler` → `ProviderInteractionPort` → composer 区内联批准（复用 `InlineAskUserQuestion`，方向键操作，流结束即消失）；always → `PermissionUpdate{destination:'projectSettings'}` 交 CLI 写 `.claude/settings*.json`；规则匹配 `core/security/approvalRules.ts`（Bash 精确/显式通配，文件路径段边界前缀）。
- WB：ACP `session/request_permission` → provider 按 sessionId 路由 → AcpSession 挂起 → 气泡内批准卡（留存可回看）；always 走 CLI 原生 allow_always；悬挂边界统一 reject（关面板/切会话/卸载）。
- 评：深度相当；WB 可回看，Claudian 键盘流。

### rewind / fork
- Claudian rewind：SDK `Query.rewindFiles(userMessageId)`；先 dryRun 拿 filesChanged → 备份至 `os.tmpdir()/claudian-rewind-*` → 执行，失败回滚备份；UI 截断消息 + 输入回填 composer；锚点 = SDK 消息 uuid（user/assistant）。fork：`providerState.forkSource{sessionId,resumeAt}` → 首轮 `forkSession:true`，支持消息级。
- WB：rewind ❌（ACP 五个候选方法实测全部 -32601，证据见 `specs/2026-08-03-acp-session-fork-design.md` §2）；fork = 会话级 `/branch` + `session_info_update.newSessionId` 捕获，消息级受 rewind 所限做不到。

### 计划批准
- Claudian：`ExitPlanMode` 经 canUseTool 拦截 → `InlineExitPlanMode` 四分支：当前会话批准（`setMode` 权限更新）；**新会话批准**（cancel 当前流 + 新会话自动发 "Implement this plan"）；feedback（deny+message 继续规划）；abandon。
- WB：DeferExecuteTool 批准卡一点 → **同轮自动继续执行**；特化只认内层 `ExitPlanMode`（20c4014 修复）。
- 评：WB 路径更短；Claudian 的 approve-new-session 恰是 WB v1.5.0 已退役的 workaround 形态。

### 安全
- ⚠️ 修正 README 级结论：Claudian 2.0.44 **代码中无内置命令黑名单**（grep 无果），危险命令把关 = CLI settings deny 规则 + canUseTool；vault 围栏只护插件自管文件（`VaultFileAdapter` 逐段 lstat 拒 symlink + realpath 包含校验）；agent 文件访问两家都靠 CLI cwd + 白名单。
- WB：同级（CLI cwd + 批准卡兜底）。差距实际很小。

### MCP
- Claudian：CRUD UI（`McpServerModal` 表单 + 剪贴板四种格式导入 + `McpTestModal` 连接测试 + 工具级启停）；stdio/SSE/HTTP 三传输；**context-saving**（默认不进 options.mcpServers，@mention 正则提取才注入 + 改写文本 `@name MCP`）；配置存 vault `.claude/mcp.json`。
- WB：JSON textarea → `session/new|load` 的 mcpServers（ACP 原生位），stdio 实测端到端通。差距：管理 UI、SSE/HTTP、context-saving、工具级启停。

### 自定义子代理
- Claudian：agent.md 文件（内置/插件/vault/全局四级，frontmatter 带 tools/disallowedTools/model/skills/permissionMode/hooks），**靠 CLI settingSources 原生加载**，插件只做 CRUD + @ 下拉。
- WB：settings JSON → CLI `--agents` 旗标（实测 Agent 工具可调）。差距：@Agents 选择器、per-agent tools/model 字段。

### @mention 体系
- Claudian：四源聚合下拉（MCP context-saving 服务器 / agents / 外部目录 / vault 文件），二级导航、200ms 防抖、脏标记缓存；外部目录经 SDK `externalPaths`（即 additionalDirectories）进 context。
- WB：仅 vault 笔记 @[[...]] + 附件芯片（vault 外文件走 Read 批准卡）。**最大单点 UX 差距**。

### inline edit diff
- ⚠️ 修正：Claudian README 称 word-level，**代码实为行级 LCS 自实现**（`InlineEditModal.computeMarkdownDiff`，无库），上下双块 markdown 渲染对比，CM6 Widget 内嵌编辑器，Enter/Esc 接受拒绝。
- WB：DiffModal 行级 + 按钮。`shared/wordDiff.ts`（已验收）接进 DiffModal 即可反超为真词级。

### 工具渲染
- Claudian：按工具差异化——Bash `$cmd`+20 行截断、Read/Glob/Grep 15 行、WebFetch 500 字符、WebSearch 链接列表、TodoWrite 任务面板、apply_patch 逐文件 hunk diff（上下 3 行 context、超 20 行截断）、SubagentRenderer 两种协议。
- WB：通用工具行（toolCallId 就地更新）+ 词级 diff + Bash 全文终端块 + Edit 撤销按钮。评：Claudian 覆盖广；WB 精细度（词级、Bash 全文、撤销）更好。

### 图片
- 两家均 base64 原生块（Claudian `source:{type:'base64'}`；WB `{type:'image',data,mimeType}`）。Claudian 多 5MB 上限、扩展名白名单、大图预览 overlay；WB 覆盖 vault 内粘贴/附件图片。

### 其余
- i18n：Claudian 10 locale JSON + 编译期 key 类型推导；WB 中英单文件表。
- tabs：Claudian 数字徽章（3-10 上限、四态样式）；WB 标题 tab + 右键导出/分叉 + **双面板定向 cancel（WB 独有）**。
- 用量：Claudian SVG 240° gauge（input+cache token，模型映射窗口）；WB 环（usage_update 真实窗口 168k）。
- 自动标题：Claudian 首条消息后 fallback 先上 + 辅助会话 AI 生成（用户已改名不让位）；WB 截断式。
- 流式渲染：Claudian rAF + 150ms 节流协调器；WB 逐 chunk 直渲（长文流式更费 CPU）。

## 2. 结论

- 执行层深度已同代：WB acp 四层 ≈ Claudian strategy/normalizer 分层；批准/计划/配置同步机制复杂度相当。
- **WB 反超点**：同轮真计划批准、真词级 diff、Bash 全文终端块、双面板定向 cancel、批准卡历史留存。
- **真实差距**（按移植成本）：@mention 四源聚合（前置探针：ACP 是否有 additionalDirectories 类参数）→ MCP 管理 UI → 渲染节流 → DiffModal 词级 → 自动标题 → 插件管理/i18n 扩展。
- **不可移植**：rewind（等 CLI 暴露 ACP 方法）、消息级 fork（依赖 rewind）。
