# Workbuddian 95519c4 增量手测报告

- 执行日期：2026-08-03（EDT）
- 被测提交：`95519c49e704bb2325ad15500964d4eb186939d9`
- 测试计划：`manual-test-2026-08-03-acp-v2.md`、`manual-test-2026-08-03-acp-step2.md`、`manual-test-2026-08-03-roadmap3.md`
- 测试方式：Obsidian `demo-vault` 真实 GUI + Computer Use；不做 TDD，不修改产品源码
- 回归口径：跳过上一轮已通过的 A1、A5、A6、A7、B4、C2、C3、C5；只重测旧失败/阻塞项及新增 Step2、ROADMAP 3.0
- 结果：按清单行统计（含跨清单映射）为 **11 PASS / 15 FAIL**，共 26 行
- 结论：**不建议验收当前构建。** CLI smoke 已全绿，但自动标题、外部附件授权、工具 diff/撤销、fork、双面板隔离、inline edit、图片粘贴等 GUI 核心链路仍有失败。

## 1. 环境与证据边界

| 项目 | 实测值 |
|---|---|
| Obsidian | 1.12.7 |
| Vault | `/Users/jiang/claude/workbuddian/demo-vault` |
| 仓库 `HEAD` | `95519c49e704bb2325ad15500964d4eb186939d9` |
| Harness `origin/main` | `95519c49e704bb2325ad15500964d4eb186939d9` |
| `main.js` SHA-256 | `6eb09e1c40f9f47673da80656bcb15d3e350a35eafeb5cd442d0dba2b94491a6` |
| `manifest.json` SHA-256 | `3fd910c2f0ada3b46d8cd8ee6d9197f880aedb5f869c26dd3155c94b289d1702` |
| `styles.css` SHA-256 | `290224fb6ee4d1f7b9ab386afb2edd90aadf70ad8e7fd9a3d9a8c3ce7f8e30b0` |
| 测试前部署基线 | `/tmp/workbuddian-acp-step2-test-NZwvox/demo-vault.deployed-95519c4.before` |
| 测试态归档 | `/tmp/workbuddian-acp-step2-test-NZwvox/demo-vault.after-95519c4` |
| CLI smoke 日志 | `/tmp/workbuddian-acp-step2-test-NZwvox/acp-smoke-95519c4.log` |

仓库构建与 `demo-vault` 已安装包三项哈希一致，`origin/main` 与本地 `HEAD` 一致。本轮结束后已退出 Obsidian，将完整测试态移到上述归档路径，再用部署基线恢复 `demo-vault`；`diff -qr` 为 0 行，恢复后 `main.js` 哈希仍为 `6eb09e...`。下载目录和 `/tmp` 中的临时 MCP、外部文本、图片夹具均已删除。

## 2. CLI smoke

`node scripts/acp-smoke.mjs`：**11 passed, 0 failed**，退出码 0。initialize、会话上下文、权限请求、Write 落盘、cancel、load、plan/`DeferExecuteTool`、`/branch`、分叉后 load 均通过。

这只能证明 CLI/协议探针成立；GUI 中的 fork、diff、标题和附件授权仍有独立失败，不能据此判定手测通过。

## 3. 旧失败项复测

| 编号 | 结果 | GUI 证据与备注 |
|---|---|---|
| A2 | FAIL | Reject 后文件未删除、卡片变“已拒绝”，但最终回复仍泄露英文内部意图 `The user wants me to delete...`，没有面向用户说明拒绝结果。 |
| A3 | PASS（有偏差） | 点“按此执行”后同一轮追加 `第二行` 成功，无重复 user 气泡和重复计划卡；但计划正文不清晰，执行前后额外出现 `ls`、`echo` 两张 Bash 批准卡。 |
| A4 | FAIL | 主面板和侧栏视觉上选择不同标签，但正文历史指向同一会话；一路返回“无响应”，另一路再次发送时报“该会话正在响应中，请稍候”，无法建立两个独立流并验证定向 Stop。 |
| A8 | FAIL | 右键菜单已出现 “Fork this chat/分叉当前会话”，实际触发后 Notice 为 `Fork failed: fork failed`，没有新会话；空会话/流式边界未继续判通过。 |
| B1 | FAIL | Full Access 下本轮 Write 不再弹批准卡，权限子问题已修；但完成态工具行仍只有 `Write`，没有路径和独立 diff。 |
| B2 | FAIL | Edit 真实改动文件，但完成态仍没有默认折叠的文件 diff。 |
| B3 | FAIL | Edit 完成后没有“撤销此修改”按钮。 |
| B5 | FAIL | 默认模式批准后文件成功落盘，旧超时已修；但完成态仍无 diff，严格验收不通过。 |
| C1 | FAIL | Vault 外附件未弹 Read 批准卡，直接返回 `EXTERNAL-ACP-V2-MARKER`；授权边界问题仍存在。 |
| C4 | FAIL | inline edit 指令框、diff、接受链路已可进入；但 diff 整行着色而非词级高亮。接受后文件落盘，弹窗却残留为不可交互画面，需重载 Obsidian 清除。 |
| C6 | PASS | 英文界面下启动 `Count from 1 to 10000` 后立即杀死 ACP；约 12 秒内出现英文错误卡 `codebuddy process exited unexpectedly. Resend to resume the session.`，不再永久停在 Thinking/Stop。 |

## 4. Step2 新增项

| 编号 | 结果 | GUI 证据与备注 |
|---|---|---|
| S2-1 | FAIL | 与 A8 同一次实测：入口存在，但 GUI fork 返回 `Fork failed: fork failed`；CLI smoke 的 `/branch` 通过不能覆盖该失败。 |
| S2-2 | PASS | fake MCP 触发具体 `mcp__fake__echo` 批准卡，允许后原样返回 `ECHO:hello-mcp`；`DeferExecuteTool` 未误判为计划卡。 |
| S2-3 | PASS | `reviewer` 通过真实 `Agent` 工具调用成功；但最终审查文本重复 2-3 次，另记质量问题。 |
| S2-4 | PASS | MCP JSON 输入 `{bad` 后出现 `MCP 服务器（JSON）：JSON 无法解析，未生效`；有效配置未被破坏。 |
| S2-5 | FAIL | Edit 完成态没有 diff，因此也不存在“只高亮实际变化词”的工具结果块。 |
| S2-6 | PASS | Bash 行下有可折叠“输出”；展开可见 `Command`、`Stdout`、`Stderr`、`Exit Code`，`echo hello-terminal` 的退出码为 0。 |
| S2-7 | FAIL | 设置页切到 `high` 后消息可回复，但日志没有计划要求的 `set_config_option thought_level/high`；发送 `/effort low` 后 CLI 回复已切 low，设置页仍显示 `high`。 |
| S2-8 | FAIL | 同一剪贴板在 TextEdit 中能粘贴为 `[附带的图像]`，在 Workbuddian 输入框粘贴后没有图片 chip，无法发送原生图片块。 |
| S2-9 | PASS | 默认模式出现具体 `ImageGen` 批准卡而非计划卡；允许后根目录生成 1024x1024 PNG，SHA-256 为 `81eeb94683f09c5535c210e9ebfcf08bd8ae32a0443f97abd9566f6c292786dc`。 |

## 5. ROADMAP 3.0

| 编号 | 结果 | GUI 证据与备注 |
|---|---|---|
| R3-1 | FAIL | 与 C4 同一次实测：inline edit 可执行并落盘，但删除/新增行整行红绿着色，没有精确词级深色高亮；接受后还出现残留弹窗。 |
| R3-2 | PASS（有限证据） | 800 字请求最终得到连贯 700 字符正文，无丢段、UI 未冻结；流式中间约 45 秒无新 chunk，无法区分模型停顿与渲染节流。 |
| R3-3 | FAIL | 首轮能生成 `创建审批步骤文件`、`隔离功能验证` 等 AI 标题；但标题生成后，同会话下一轮稳定变成“无响应，请重试”，两个会话均复现。关闭自动标题后多轮恢复，截断标题又不能立即刷新。手动改名保护因核心失败未判通过。 |
| R3-4 | PASS | `@` 同时列出 `@Agents/reviewer`、`@mcp/fake`、Vault Markdown 和非 Markdown 文件；选中后分别插入 `@reviewer `、`@fake `、`@[[note-test]]`、附件 chip。 |
| R3-5 | PASS | 添加、停用、改名、删除、剪贴板导入均写回 JSON；删除后列表与 JSON 同步清空。直接编辑 JSON 时列表不即时刷新，另记改进项。 |
| R3-6 | PASS | 子代理配置含 `tools:["Read"]`、`model:"auto"` 时 `Agent` 工具正常唤起，CLI 未拒绝 schema。 |

## 6. Issue 清单

### WB-95519C4-001 [P0] 自动标题完成后同会话后续轮次无响应

**复现**：开启自动标题，新会话完成首轮并生成 AI 标题，再发第二条消息。

**实际**：第二轮立即变为“无响应，请重试”；两个独立会话稳定复现。关闭自动标题后同样的两轮消息正常。

**建议**：标题生成使用完全独立的辅助 session/process，不得覆盖活动会话的 `acpSessionId`、请求状态或流结束回调；增加“首轮标题生成后继续第二轮”的 GUI 集成测试。

### WB-95519C4-002 [P0] Vault 外附件继续绕过 Read 批准

**实际**：默认模式直接读取 Downloads 文本附件，没有 `session/request_permission` 卡。

**建议**：附件 chip 只传引用元数据；所有 Vault 外内容读取统一走 Read 权限请求，拒绝时不得把内容放入 prompt。

### WB-95519C4-003 [P1] Write/Edit 完成态缺少路径、diff 与撤销

**影响**：B1、B2、B3、B5、S2-5 全部失败，词级 diff 也无承载位置。

**建议**：以 tool-call id 聚合 pending/approved/running/completed 状态，完成时回填规范化路径、结构化 diff 和可逆 patch；不要只渲染工具名。

### WB-95519C4-004 [P1] GUI 会话分叉后端失败

**实际**：菜单入口已交付，但有历史和 `acpSessionId` 的会话执行后返回 `Fork failed: fork failed`。CLI smoke `/branch` 与分叉 load 均通过。

**建议**：在 GUI 日志中记录 source session id、branch RPC 响应和新 session id；不要把底层错误压缩成重复的 `fork failed`。

### WB-95519C4-005 [P1] 双面板无法可靠绑定不同会话

**实际**：主面板和侧栏显示不同选中标签，却展示同一历史；并发发送后一路“无响应”，另一路报会话正在响应，A4 无法进入定向取消验收。

**建议**：每个 view 保存独立 `conversationId -> acpSessionId -> activeRequestId`，切换标签时不要使用插件级单一 selected session。

### WB-95519C4-006 [P1] inline edit 词级 diff 未落地且接受后残留幽灵弹窗

**实际**：diff 行整行同色，没有实际变化词的加深高亮；接受后文件已改，但弹窗画面仍残留且 AX 已移除，后续操作被遮挡。

**建议**：检查 `diffRows` 的 token span class 是否被样式覆盖；Modal close 必须在 apply 成功/失败两条路径都触发，并在关闭后验证 DOM 与视觉层同时移除。

### WB-95519C4-007 [P1] thought_level 下发与 `/effort` 回流断链

**实际**：设置 high 无可核对日志；`/effort low` 得到 CLI 成功文本后，设置页仍为 high。

**建议**：记录结构化 config request/ack；解析 CLI 的 effort 变更事件并更新持久设置和当前控件，避免仅依赖回复文本。

### WB-95519C4-008 [P1] 原生图片剪贴板未生成图片块

**实际**：系统剪贴板有有效图像，Workbuddian 粘贴无 chip、无附件。

**建议**：覆盖 PNG/TIFF/JPEG clipboard item；粘贴后先生成可见 chip，再转换为 ACP image content block，并加入无 Read 调用断言。

### WB-95519C4-009 [P2] Reject 后泄露英文内部意图

**建议**：拒绝事件生成固定、面向用户的本地化终态；过滤模型草稿和工具规划文本。

### WB-95519C4-010 [P2] Agent 最终文本重复

**实际**：reviewer 的同一审查结论重复 2-3 次。

**建议**：按 content block/event id 去重，避免把 Agent 工具结果、增量正文和最终正文重复拼接。

### WB-95519C4-011 [P2] 设置 JSON 与管理列表只单向刷新

**实际**：管理按钮到 JSON 同步正常；直接编辑有效 JSON 后，列表要重开设置才刷新。

**建议**：JSON blur 校验成功后立即重建列表；非法 JSON 保持旧模型并显示错误状态，不让文本框与有效配置长期分叉。

## 7. 已确认修复

- A3：计划批准可在同一轮落盘，不再重复计划卡。
- B1 权限子项：Full Access 的 Write 本轮不再请求批准。
- B5：人工批准期间不再误触发响应超时，文件可落盘。
- C4：inline edit 弹窗链路已从“无法进入”推进到可操作，但新暴露 diff/关闭问题。
- C6：英文状态杀死 ACP 后能进入英文错误终态。
- A8：分叉入口已交付，但后端执行仍失败。
- S2-2、S2-3、S2-4、S2-6、S2-9、R3-4、R3-5、R3-6 的新增主链路通过。

