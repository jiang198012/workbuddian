# 任务 B 实现计划：MCP 服务器与子代理配置

> inline 执行。Spec: `docs/superpowers/specs/2026-08-03-acp-mcp-agents-design.md`

**Goal:** 设置页新增 MCP servers JSON 与 custom agents JSON 两个设置项，分别注入 `session/new|load` 的 mcpServers 与 CLI spawn 的 `--agents`。

## Global Constraints
- acp/* 零 obsidian import；settings 版本 10→11；i18n 中英双语。
- 非法 JSON 不生效、不炸页：bbLog + Notice。
- 每 Task jest 绿，最后全量 + build + smoke 不受影响（smoke 不传 mcpServers/agents，默认路径必须不变）。

### Task 1: types + i18n
- [x] `types/index.ts`：`mcpServersJson: string`、`customAgentsJson: string`（默认 `''`），`CURRENT_SETTINGS_VERSION` 10→11，migrateSettings 归一（`getString(stored.x, '')` 模式）；types.test.ts 补两条默认断言。
- [x] `i18n/index.ts`：`settings.mcpServers`（MCP 服务器（JSON）/ MCP servers (JSON)）、`settings.mcpServersDesc`（stdio 服务器数组，例：`[{"name":"x","command":"npx","args":["-y","pkg"]}]`；改后新会话生效）、`settings.customAgents`（子代理（JSON）/ Custom agents (JSON)）、`settings.customAgentsDesc`（`{"名":{"description":"…","prompt":"…"}}`，对应 CLI `--agents`；改动后进程自动重启）、`settings.invalidJson`（JSON 无法解析，未生效：{field}）。
- [x] `npx jest tests/types.test.ts tests/i18n.test.ts` 绿。
- [x] Commit: `feat(settings): mcpServersJson/customAgentsJson 设置项与文案（v11）`

### Task 2: session mcpServers 注入 + client extraArgs/dispose
- [x] 测试先行（acpSession.test.ts / acpClient.test.ts）：
  - ensureLoaded 时 `session/new` 与 `session/load` 的 params 带 `mcpServers` 等于 config 值（默认 `[]`）；
  - `buildSpawnCommand(script, node, ['--acp', '--agents', '{}'])` 原样透传；
  - `setExtraArgs` 在进程 running 时触发 dispose（fake proc kill 被调）。
- [x] 实现：`SessionConfig` 加 `mcpServers: unknown[]`（provider 构造时 `mcpServers: []`）；session.ensureLoaded 两处 params 用 `mcpServers: this.config.mcpServers`；client 加 `extraArgs` 字段 + `setExtraArgs()`，spawn args = `['--acp', ...this.extraArgs]`；`setCodebuddyPath/setNodePath/setExtraArgs` 变更且 running → `this.dispose()`。
- [x] jest 绿。Commit: `feat(acp): mcpServers 注入 session/new|load；client extraArgs 与变更即重启`

### Task 3: provider setters + main/settings 接线
- [x] 测试先行（providerCallbacks.test.ts / api.test.ts）：
  - `setMcpServersJson('[{"name":"x"}]')` → 之后 sendMessage 的 session/new 带该数组；非法 JSON → 保留旧值（断言 session/new 的 mcpServers 未变）。
  - `setCustomAgentsJson('{"reviewer":{...}}')` → fake client 的 setExtraArgs 收到 `['--agents', json]`；非法 → 不调用。
- [x] 实现：provider 两个 setter（解析+分发+bbLog）；main.ts applySettingsToApi 加两行；settings/tab.ts 「CodeBuddy 连接」组加两个 textarea（读 tab.ts 现有文本框模式校准：值回填、onChange 保存、非法 JSON 时 Notice `settings.invalidJson`）。
- [x] jest 绿 + `npm run build` 过。Commit: `feat: MCP/子代理设置接入 provider 与设置页`

### Task 4: 验收 + 手测清单 B 组
- [x] 全量 `npx jest` 绿 + build 过 + `node scripts/acp-smoke.mjs` 仍 11/11（默认路径回归）。
- [x] `docs/manual-test-2026-08-03-acp-v2.md` 加 B 组：
  - B6 MCP：设置页填 fake server JSON（`[{"name":"fake","command":"node","args":["/tmp/fake-mcp-server.mjs"]}]`，脚本内容附在清单里）→ 新会话发「调用 echo 工具」→ 出现工具行且回答含 ECHO；default 模式会弹 DeferExecuteTool 批准卡（工具名显示 `mcp__fake__echo`——**不是**「计划已就绪」，顺带回归 20c4014 修复）。
  - B7 子代理：设置页填 `{"reviewer":{"description":"Reviews code","prompt":"You are a terse reviewer."}}` → 发送「用 reviewer 子代理审查这段代码」→ 出现 `Agent` 工具行。
  - B8 非法 JSON：填 `{bad` → 保存时 Notice 提示，会话功能不受影响。
- [x] Commit: `docs: 手测清单 B 组（MCP/子代理/非法 JSON）`

## Self-Review
- Spec §3.1/3.2/3.3 逐项落 Task 1-3；§3.4 错误处理落 Task 1 key + Task 3 Notice；§4 测试策略逐条有落点；§5 非目标未安排。
- 签名一致：`setMcpServersJson(string)`/`setCustomAgentsJson(string)`、`setExtraArgs(string[])`、`config.mcpServers: unknown[]` 全文一致。
