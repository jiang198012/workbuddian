# Workbuddian ROADMAP 3.0 —— 对齐并反超 Claudian

> 日期：2026-08-03 ｜ 依据：`docs/claudian-diff-2026-08-03.md`（代码级剖析，Claudian 2.0.44）
> 前序：ROADMAP 2.0（ACP 三步走）第一步（架构代差消灭）+ 第二步（fork/MCP/子代理/词级diff/Bash块/thought_level/图片块）已完成，579 测试绿、smoke 11/11。

## 现状判定

核心对话能力已与 Claudian 同代对齐；Workbuddian 已持五个反超点（同轮真计划批准 / 真词级 diff / Bash 全文终端块 / 双面板定向 cancel / 批准卡历史）。3.0 的目标：**把反超点做满，把体验差距补齐**。

## 3.1 反超快赢（半天级，先做）

| # | 事项 | 内容 | 验收 |
|---|---|---|---|
| R1 | inline edit 真词级 diff | `shared/wordDiff.ts` 接进 `DiffModal`（现成行级 LCS 保留为行骨架，行内变更段高亮）——反超 Claudian 的行级双块 | 选区编辑 modal 行内变更段高亮；jest 绿 |
| R2 | 流式渲染节流 | 参照 Claudian `StreamingRenderCoordinator`：text chunk 合并快照 + rAF/150ms 最小间隔渲染，收尾 flush | 长文流式 CPU 占用下降；文本完整性不回归 |
| R3 | 自动会话标题 | 首条消息后一次性辅助 ACP 会话生成标题（fallback 截断先上；用户手动改名过则不让位） | 新会话标题由 AI 生成；改名保护生效 |

## 3.2 体验对齐（1-2 天级，先做探针定形态）

| # | 事项 | 内容 | 前置探针 |
|---|---|---|---|
| R4 | @mention 四源聚合 | @ 下拉扩展为：vault 文件 / @Agents（读 settings.customAgentsJson）/ @mcp（读 mcpServersJson）/ 外部目录挂载；二级导航；外部目录选中走"附件+Read 批准卡"或协议注入 | ACP `session/new` 是否接受 additionalDirectories 类参数（无则维持批准卡方案） |
| R5 | MCP 管理 UI | 列表 + 增删改 + 启停 + 剪贴板导入；SSE/HTTP 传输字段 | session/new 对 `{type:'sse'/'http', url}` 形态是否接受 |
| R6 | @Agents 细化 | agents JSON 支持 per-agent tools/model 字段（透传给 --agents 的 schema 以 CLI 为准） | --agents JSON schema 是否认 tools/model 键 |

## 3.3 生态与长线（按需排期）

| # | 事项 | 说明 |
|---|---|---|
| R7 | CodeBuddy 插件管理 | 探 `~/.codebuddy/plugins` + `reload-plugins`/`plugin-validate` 命令，可行则做发现/启停 UI |
| R8 | hooks 评估 | CodeBuddy CLI 是否有 hooks 机制（探针）；有则设置页透传 |
| R9 | i18n 扩展 | 沿 Claudian locale 结构补 ja/ko 等（当前中英双语） |
| R10 | context-saving MCP | @mention 激活才注入 mcpServers（依赖 R4 落地） |

## 3.4 阻塞清单（等 CLI，勿动工）

- **rewind**：ACP 无 rewind/restore 方法（5 候选实测 -32601，证据在 `specs/2026-08-03-acp-session-fork-design.md` §2）。
- **消息级 fork**：依赖 rewind。
- 外部目录协议级注入：若探针否定 additionalDirectories 形态，则外部目录维持"附件+批准卡"现状。

## 排序与依赖

1. **R1-R3 快赢**先行（无外部依赖，直接反超）。
2. **R4-R6 的探针**在动工前各跑一次活探针定形态（沿用 /tmp 探针模式 + smoke 回归）。
3. R7-R10 按用户反馈排期；R10 依赖 R4。
4. 3.4 清单只在 CLI 侧能力落地后重启评估（每次 WorkBuddy 大版本升级后复查 `--help` 与握手能力）。

## 流程约定（自 3.0 起）

- 工作不再拆分步计划文档交付；spec 级文档仅在涉及协议/架构决策时产出。
- 每项完成标准不变：jest 全绿 + `npm run build` 过 + smoke 11/11 不回退 + 手测清单增补用例。
