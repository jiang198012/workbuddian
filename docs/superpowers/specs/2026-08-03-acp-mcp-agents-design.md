# 任务 B 设计：MCP 服务器与子代理配置——ACP 暴露面实测收敛

> 日期：2026-08-03 ｜ 状态：自主执行（用户授权收尾第二步，范围按探针证据收敛）
> 前置事实：2026-08-03 活探针（/tmp/acp-mcp-probe.mjs、/tmp/acp-agent-probe.mjs）

## 1. 探针结论（逐项终态）

| 任务 B 子项 | 实测 | 终态 |
|---|---|---|
| MCP 配置 | `session/new` 的 `mcpServers` 注入 stdio server **端到端通**：工具以 `mcp__<server>__<tool>` 注册，经 DeferExecuteTool 包装调用，结果正常回传（`ECHO:hello-mcp`）；`session/load` 同样带 mcpServers 参数 | **实现**：设置项 MCP servers JSON |
| @子代理 | `--agents <json>` 启动旗标生效，ACP 会话内 `Agent` 工具可调用子代理 | **实现**：设置项 custom agents JSON → spawn 参数 |
| Skills | 已可经斜杠透传（`/skills` 列出、`/<skill>` 调用，availableCommands 在 v2 已通） | **搁置**：无需新代码，入档 |
| @外部目录 | v2 已由"附件 + Read 批准卡"覆盖（default 模式弹卡、可总是允许） | **搁置**：@ 补全扩展到文件系统搜索成本高、与附件能力重复，YAGNI |

## 2. 探针副产物（已修复）

`DeferExecuteTool` 是通用委托包装器：内层 `rawInput.toolName` 为 `ExitPlanMode` 才是计划批准；包装 MCP/委托调用时内层是 `mcp__fake__echo` 等。v2 首版把任何 DeferExecuteTool 都当计划批准卡——**误判 bug**，已修复（commit 20c4014）并钉测试。

## 3. 设计

### 3.1 新增设置项（settings 版本 10 → 11）

- `mcpServersJson: string`（默认 `''`）——MCP 服务器数组 JSON，元素 `{name, command, args?, env?}`（stdio）。
- `customAgentsJson: string`（默认 `''`）——子代理定义 JSON 对象，`{<名>: {description, prompt}}`，对应 CLI `--agents`。

### 3.2 数据流

```
设置页（textarea）→ settings → applySettingsToApi()
  → api.setMcpServersJson(json)：解析失败 → bbLog + 保留旧值；成功 → config.mcpServers（共享引用）
  → api.setCustomAgentsJson(json)：解析失败同上；成功 → client.setExtraArgs(['--agents', json])；进程在跑则 dispose（下次发送自动重启，会话经 session/load 恢复）
session.ensureLoaded → session/new 与 session/load 的 params.mcpServers 均取 config.mcpServers（默认 []）
```

### 3.3 组件改动

- `types/index.ts`：两个新字段 + 默认值 + `CURRENT_SETTINGS_VERSION` 11 + migrateSettings 归一（非 string 回落 ''）。
- `acp/session.ts`：`SessionConfig` 加 `mcpServers: unknown[]`；ensureLoaded 两处请求带 `mcpServers: this.config.mcpServers`。
- `acp/client.ts`：`setExtraArgs(args: string[])`；`buildSpawnCommand` 的 args 变为 `['--acp', ...extraArgs]`；`setCodebuddyPath/setNodePath/setExtraArgs` 变更时若进程在跑 → `dispose()`（下次 ensureStarted 重启，死亡恢复链已测）。
- `providers/codebuddy/index.ts`：`setMcpServersJson/setCustomAgentsJson`（解析 + 分发 + bbLog）。
- `main.ts`：applySettingsToApi 加两行。
- `features/settings/tab.ts`：「CodeBuddy 连接」组加两个 textarea（JSON 占位符示例）。
- `i18n`：`settings.mcpServers`/`settings.mcpServersDesc`/`settings.customAgents`/`settings.customAgentsDesc`（中英）。

### 3.4 错误处理

- JSON 非法：不生效、不炸设置页；bbLog 记录；保存时 Notice 提示（`settings.invalidJson`）。
- MCP server 进程起不来：CLI 侧降级（工具不可用），不影响会话——ACP 层无额外处理。
- agents/mcp 改动 → dispose：在飞轮次按进程死亡链 error 收尾；下一轮自动重启 + load 恢复（v2 已验）。

## 4. 测试策略

- types：新字段迁移默认。
- session：ensureLoaded 在 new/load 均带 config.mcpServers。
- client：buildSpawnCommand 追加 extraArgs；setExtraArgs 在 running 时 dispose。
- provider：setMcpServersJson 合法/非法两路；setCustomAgentsJson 合法时 client.setExtraArgs 收到 `['--agents', json]`。
- settings UI 不可测：build + 手测。
- 手测清单新增 B 组用例（fake MCP + reviewer 子代理，探针脚本可作参照）。

## 5. 非目标（YAGNI）

- MCP http/sse 传输的设置 UI（JSON 里写了也不拦，但只测 stdio）
- Skills / @外部目录（入档搁置，见 §1）
- MCP/agents 的运行时热切换（dispose 重启已覆盖，无单独开关）

## 6. 验收标准

1. 全量 jest 绿 + `npm run build` 过。
2. demo-vault 手测：配置 MCP JSON 后新会话可调用 `mcp__*` 工具；配置 agents JSON 后 prompt 可唤起 `Agent` 工具行；JSON 非法时 Notice 提示且不影响会话。
