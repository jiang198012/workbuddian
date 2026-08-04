# Workbuddian wb95519c4 修复回归报告

- 执行日期：2026-08-04（EDT）
- 被测提交：`95519c49e704bb2325ad15500964d4eb186939d9` + 当前未提交修复补丁
- 测试计划：`docs/manual-test-2026-08-04-wb95519c4-fixes.md`
- 测试方式：Obsidian `demo-vault` 真实 GUI + Computer Use；不做 TDD，不修改产品源码
- 结果：**1 PASS / 6 FAIL / 7 阻塞**（共 14 项）
- 结论：**不建议验收当前修复构建。** CLI smoke 为 13/13，但 GUI 普通消息稳定以 `本轮中断：refusal` 结束；此外，Vault 外附件授权、双面板隔离和运行日志仍有独立失败。

## 1. 环境与证据边界

| 项目 | 实测值 |
|---|---|
| Obsidian | 1.12.7 |
| Vault | `/Users/jiang/claude/workbuddian/demo-vault` |
| 仓库 `HEAD` | `95519c49e704bb2325ad15500964d4eb186939d9` |
| `main.js` SHA-256 | `670bdc31b54c570b572c6186c3f16e24865d559a0a00131cd18f8fc667bb1a6e` |
| `manifest.json` SHA-256 | `3fd910c2f0ada3b46d8cd8ee6d9197f880aedb5f869c26dd3155c94b289d1702` |
| `styles.css` SHA-256 | `63ff7ba2b722e51e81d0197a817a06d28499882cf17029b40ec07f5ba65a96d3` |
| 测试前基线 | `/tmp/workbuddian-wb95519c4-fixes-ZOoWO6/demo-vault.before` |
| 测试态归档 | `/tmp/workbuddian-wb95519c4-fixes-ZOoWO6/demo-vault.after` |
| CLI smoke 日志 | `/tmp/workbuddian-wb95519c4-fixes-ZOoWO6/acp-smoke-1.log` |
| GUI 证据截图 | `/tmp/workbuddian-wb95519c4-fixes-ZOoWO6/f7-dual-panel.jpeg`、`f14-log.jpeg` |

仓库构建与 `demo-vault` 已安装包三项哈希完全一致。测试前完整备份 `demo-vault`，备份与当时现场 `diff -qr` 为 0 行。测试结束后退出 Obsidian、归档完整测试态，再从上述基线恢复；恢复结果见第 8 节。

## 2. CLI smoke

`node scripts/acp-smoke.mjs` 首轮退出码 0：**13 passed, 0 failed**。

通过项包括 plan、普通与多词中文 `/branch`、默认模式 Vault 外 Read 授权、并发 prompt 探针等。`/effort` 不产生 config 回流事件，符合清单中的已知说明。

这证明 CLI/ACP 探针本身可工作，但不能覆盖 GUI 会话、授权窗、双面板和渲染链路。

## 3. 逐项结果

| 编号 | 结果 | GUI 证据与判定 |
|---|---|---|
| F1 | FAIL | 自动标题开启；`deepseek-v4-flash` 与 `auto`、`thought_level=enabled/high` 均稳定返回 `本轮中断：refusal`。首轮无法得到正常回复或标题，故“标题后连续三轮”不满足。 |
| F2 | FAIL | 发送前正确弹出“读取 Vault 外文件”，完整路径和三按钮均正确；取消后正文与 chip 恢复且零发送。可是“允许一次”和“总是允许”都只关闭弹窗，消息仍留在输入框、没有发送；`settings.allowedExternalPaths` 始终为 `[]`。 |
| F3 | 阻塞 | 完全访问模式提交 Write 指令后直接 `refusal`，`note-test.md` 未创建；路径、折叠 diff 无法进入验收。 |
| F4 | 阻塞 | F3 前置文件未生成，Edit/diff/撤销链无法开始。 |
| F5 | 阻塞 | 默认模式提交创建指令后直接 `refusal`，没有批准卡，`regression-check.md` 未创建。 |
| F6 | 阻塞（部分通过） | 右键“分叉当前会话”可创建 `分叉 - 只回复两个字：收到`，新标签含原历史；下一条消息后落盘独立 session id。但“我们前面聊了什么？”仍为 `refusal`，无法确认分叉上下文语义；原会话续聊同样受阻。 |
| F7 | FAIL | 主面板和侧栏不能保持独立会话：不同标签状态下正文复用同一历史；A 的计数消息也出现在 B 面板，随后 B 的雨诗消息追加到同一历史。两路都 `refusal`，无可停止的正常流。 |
| F8 | 阻塞 | 可选中文本、打开 Inline Edit 指令窗并提交“改简洁”；提交后弹窗直接消失，选区未改、无 diff、无错误提示。普通 ACP prompt 同期稳定 `refusal`，接受/拒绝与幽灵弹窗无法验收。 |
| F9 | FAIL（部分通过） | 设置页可切 `high`；`/effort low` 得到 CLI 成功回复，且设置页无需重启立即显示 `low`，该半项已修复。日志中没有任何 `session/set_config_option thought_level high`，完整判定仍失败。 |
| F10 | FAIL（部分通过） | Finder 复制 1024x1024 PNG 与系统截图到剪贴板都能生成 chip 并落入 `pasted/`；截图落盘为 2940x1912、哈希与 Finder 图片不同。但 Finder 来源发送前没有出现 F2 授权窗，两次 AI 描述都以 `refusal` 结束，无法验证内容与“无 Read”。 |
| F11 | 阻塞 | 默认模式提交 `创建 reject-test.md 内容 x` 后直接 `refusal`，未出现批准卡，无法点击拒绝；文件未创建。 |
| F12 | 阻塞 | reviewer JSON 成功保存并触发 CLI 重启；调用提示仍在 Agent 工具前 `refusal`，无法判断最终文本是否去重。 |
| F13 | PASS | 直接输入合法 MCP JSON 后，上方列表立即出现 `wb-fix-test /usr/bin/true`；再输入 `[{` 后 Notice 为“JSON 无法解析，未生效”，列表和持久化有效值均保持不变。 |
| F14 | FAIL | 日志只有 initialize、session/load 和一条无归属 update；没有本轮多次 `session/prompt`、`session/set_config_option` 或 fork 开始/成功，无法还原请求时序。 |

## 4. 关键复现证据

### 4.1 GUI 普通消息统一 refusal

以下互相独立的请求均得到同一终态：

- `只回复两个字：收到`
- `请回复：收到`
- `日志探针`
- `把一段 200 字关于夏天的短文写入 note-test.md`
- `创建 regression-check.md 内容 ok`
- `我们前面聊了什么？`
- `创建 reject-test.md 内容 x`
- `用 reviewer 子代理审查 const a=1 这行代码`

界面终态：`出错了 / 本轮中断：refusal`。切换 `deepseek-v4-flash -> auto`、`enabled -> high` 后结果不变。相同运行环境下 `/effort low` 能正常返回，CLI smoke 13/13，因此不能简单归为 CLI 整体不可用。

### 4.2 Vault 外附件允许动作丢消息

测试文件：

- `/Users/jiang/Downloads/wb-fixes-external-once.txt`
- `/Users/jiang/Downloads/wb-fixes-external-always.txt`

两次均正确出现发送前授权窗。取消路径符合预期；“允许一次”和“总是允许”通过 AX 元素点击、可见按钮坐标点击各复核一次，结果一致：弹窗关闭，正文和 chip 仍留在输入框，回复区没有新增 user 消息。“总是允许”后 shell 复核：

```json
[]
```

即 `settings.allowedExternalPaths` 未持久化。

### 4.3 图片 chip 已修复，但完整发送未通过

| 来源 | 落盘尺寸 | SHA-256 |
|---|---:|---|
| Finder 复制 PNG | 1024x1024 | `2a6f610083b7999b24f55b5a62f4d448f72d160f810ae2c765ac739a4c3a9cb1` |
| 系统截图剪贴板 | 2940x1912 | `6b953d1eb40826717f8a35acd2a088427c3eaee931c1305c0a0b90f28a49ed17` |

两个来源都出现图片缩略 chip，发送后历史中保留图片；随后都在模型正文前 `refusal`。

### 4.4 F14 日志原文

```text
[02:20:34] [WB] resolved codebuddy path: /Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy
[02:21:35] [WB] acp 请求: initialize {"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}
[02:21:36] [WB] acp 请求: session/load {"sessionId":"9bc3b70b-8b23-48c9-84a8-2713a7a86ba3","cwd":"/Users/jiang/claude/workbuddian/demo-vault","mcpServers":[]}
[02:21:36] [WB] acp update 无归属会话，已丢弃: 9bc3b70b-8b23-48c9-84a8-2713a7a86ba3 config_op
```

本轮之后实际执行了普通 prompt、`/effort low`、fork、thought_level 切换和 Agent 配置，但日志没有对应记录。

## 5. Issue 清单

### WB-FIX-20260804-001 [P0] GUI 普通 prompt 全部以 refusal 终止

**影响**：直接阻塞 F1、F3、F4、F5、F8、F11、F12，并使 F6、F7、F10 无法完成语义验收。

**边界**：GUI 普通消息稳定失败；同进程内 `/effort low` 成功，独立 ACP smoke 13/13。

**建议**：在收到 `session/prompt` 结果时记录 stopReason、session id、model、mode、thought_level 和响应 block 数；重点比较 GUI 新会话参数与 smoke 会话参数。不要把 `refusal` 只渲染成通用错误而丢弃底层返回摘要。

### WB-FIX-20260804-002 [P0] 外部附件“允许”动作既不发送也不持久化

**实际**：“允许一次”和“总是允许”都等价于关闭弹窗；“总是允许”未写入 `allowedExternalPaths`。

**建议**：让 modal resolve 明确返回 `once | always | cancel`，调用侧只在 cancel 恢复草稿；once/always 必须继续同一个 send promise，always 先持久化路径再发送。补一条 GUI 集成测试，断言 user 消息数和设置落盘值。

### WB-FIX-20260804-003 [P1] 双面板仍共享选择/历史状态

**实际**：A/B 面板不能独立绑定 conversation；A 消息出现在 B 历史，切换/新建会话也会影响另一视图。

**建议**：把 `selectedConversationId`、draft、pending send 与 stop handler 收回到 view 实例；插件级 manager 只按 conversation/session id 路由，不保存单一“当前会话”。

### WB-FIX-20260804-004 [P1] ACP 日志遗漏 prompt/config/fork 且出现无归属 update

**实际**：日志不足以解释 `refusal`，也没有清单要求的三类出站请求；唯一 update 被当作无归属丢弃。

**建议**：在统一 `client.request()` 边界记录所有方法摘要；session 注册必须早于 load/config update；日志 viewer 不应因 CLI 重启或设置变更继续展示失联的旧缓冲区。

### WB-FIX-20260804-005 [P1] Inline Edit 失败后静默关闭

**实际**：提交“改简洁”后指令窗消失，选区未改、无 diff、无失败 Notice。

**建议**：只有拿到有效 edit 结果后才进入 diff；空结果、refusal、进程错误都应显示本地化错误并保留原选区，不能静默当作成功关闭。

### WB-FIX-20260804-006 [P2] Finder 图片发送绕过清单要求的外部路径授权

**实际**：Finder 复制图片可生成 pasted chip，但发送时未弹 F2 授权窗。

**建议**：明确产品语义：若 Finder 复制代表用户已显式授权，应修改清单并记录来源；若仍按外部路径授权，则 chip 需保留 sourcePath 并在发送前走 F2。

## 6. 已确认修复或进展

- F2：发送前授权窗、完整路径、取消后恢复草稿均已落地。
- F6：GUI fork 不再直接报 `fork failed`，能建立分叉标签并复制历史；上下文语义仍受 `refusal` 阻塞。
- F9：`/effort low` 乐观同步已生效，设置页无需重启即显示 `low`。
- F10：Finder 图片与系统截图均可生成 chip、落盘并进入历史。
- F13：MCP JSON 直编即时刷新与非法值保护均通过。

## 7. 验收建议

1. 先修 WB-FIX-20260804-001 和 WB-FIX-20260804-004，使普通 GUI prompt 可用且日志能解释失败。
2. 独立修复 WB-FIX-20260804-002、003；它们已有不依赖模型输出的稳定 GUI 复现。
3. 普通 prompt 恢复后，只需重测本报告中的 7 个阻塞项及 F1/F9/F10 的未完成部分；F13 无需重复。

## 8. 清理与恢复

- 测试态已归档到 `/tmp/workbuddian-wb95519c4-fixes-ZOoWO6/demo-vault.after`。
- `demo-vault` 已从 `demo-vault.before` 恢复，`diff -qr` 为 0 行。
- 两个外部文本夹具和一张图片夹具已从 Downloads 删除。
- 产品源码未改动；本轮只新增本报告。
