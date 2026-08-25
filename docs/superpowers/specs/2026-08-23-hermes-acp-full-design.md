# Hermes ACP 完整版 · 设计

> 日期：2026-08-23 ｜ 状态：已获用户批准（brainstorming 四问全对齐）
> 前序：v2.5.1 Hermes 后端 MVP（OpenAI 兼容 HTTP 纯对话，`src/providers/hermes/index.ts`）

## 0. 需求决策记录（用户拍板）

| 问题 | 结论 |
|---|---|
| 集成路线 | **A. ACP 直连**：spawn `hermes acp`，复用插件现有 ACP 桥；弃选 HTTP runs+events 重写与混合路线 |
| HTTP MVP 去留 | **保留为自动降级 + 远程兜底**：ACP 为主，CLI 不可用或填了远程 gateway 时自动落回 HTTP 轻量对话 |
| 首期范围 | **全量对齐** CodeBuddy 后端体验（工具/批准卡/thinking/usage/历史回放/fork/模型切换/图片/MCP），唯一缺口 thoughtLevel 置灰 |
| 设置页 | **方案一**：ACP 状态为主，gateway 配置折叠进「高级」 |

## 1. 探针证据（2026-08-23 活探）

- 本机 Hermes Agent v0.20.5（`/Users/jiang/.local/bin/hermes`，`hermes-acp` 同路径），`hermes acp --check` exit 0。
- `~/.hermes/hermes-agent/acp_adapter/server.py`（约 110K）确认支持：`initialize` / `authenticate` / `new_session` / `load_session` / `resume_session` / `fork_session` / `list_sessions` / `cancel` / `prompt` / `set_session_model` / `set_session_mode` / `set_config_option`。
- 历史回放 `_replay_session_history`：text + thought（`AgentThoughtChunk`）+ 工具调用重建。
- usage：`_send_usage_update`；MCP：`_register_session_mcp_servers`；斜杠命令：available_commands update。
- **权限模式**：hermes 把 edit approval policy 映射为 ACP **session modes**（`_session_modes` / `_MODE_TO_EDIT_APPROVAL_POLICY`），不走 config option。
- **thoughtLevel 缺口**：`set_config_option` 仅存储不执行（源码注释 "no typed ACP config surface yet"），reasoning_effort 未暴露 → UI 置灰。
- 模型编码：`set_session_model` 接受 `custom:<provider>:<model>` 形态 id（`_resolve_model_selection` 解码）。
- 现有 ACP 客户端耦合面：`acp/client.ts` 的 spawn 仅依赖 `scriptPath + extraArgs`（`buildSpawnCommand`），耦合浅。

## 2. 总体架构：ACP 引擎提升为共享层

```
src/providers/
├── acp/                    # 共享引擎（从 codebuddy/acp/ 平移，逻辑不变）
│   ├── client.ts           # 传输层：spawn + 握手 + 请求分发 + 死亡检测
│   ├── session.ts          # 会话状态机 + SessionRegistry
│   ├── events.ts           # session/update → StreamChunk 纯映射
│   ├── permission.ts       # 批准卡数据纯映射
│   └── profile.ts          # 新增：BackendProfile 接口（方言抽象点）
├── codebuddy/
│   ├── index.ts            # 不变（薄壳）
│   └── profile.ts          # CodeBuddy profile：spawn=codebuddy --acp [--agents …]
└── hermes/
    ├── index.ts            # 路由器：ACP 完整版 / HTTP 轻量版 自动选择
    ├── acpProvider.ts      # Hermes ACP 薄壳（profile + fork/models/modes 方言）
    ├── httpProvider.ts     # 现 index.ts 内容平移（MVP 能力原样保留）
    └── profile.ts          # Hermes profile：spawn=hermes acp
```

`BackendProfile` 抽象点：spawn 命令构建、CLI 发现、preflight 探针、握手 clientInfo、fork 机制、模型列表来源、权限模式映射。

## 3. 方言映射表

| 能力 | CodeBuddy | Hermes ACP | 适配方式 |
|---|---|---|---|
| spawn | `codebuddy --acp` | `hermes acp`（`hermes-acp` 同效） | profile.spawn |
| CLI 发现 | `resolveCodebuddyPath()` | 新增 `resolveHermesPath()`：设置覆盖 → `~/.local/bin/hermes` → PATH → Win 各安装位 | utils/cliPath.ts |
| preflight | CLI 版本探测分级 | `hermes acp --check`（exit 0 即可用）+ `--version` 展示 | profile.preflight |
| 权限模式 | permissionMode | session modes（edit approval policy 映射） | profile 映射 |
| 模型列表 | session/new 结果 | SessionModelState（`custom:<provider>:<model>` 编码，解码显示/编码回传） | acpProvider 适配 |
| fork | `/branch` + newSessionId 捕获 | 原生 `fork_session` | profile.fork 两实现 |
| thoughtLevel | set_config_option | hermes 收下不执行 → UI 置灰 | 设置页 |
| MCP 注入 | mcpServersJson | `_register_session_mcp_servers`（同 ACP schema） | 直接透传 |
| usage/thinking/工具/历史回放 | 已有 | 已有，事件形态一致 | 引擎原样复用 |

## 4. 路由器逻辑（providers/hermes/index.ts）

- `settings.backend === 'hermes'` 构造路由器；对 view 层暴露的公共契约一字不变（main.ts 联合类型不动）。
- 模式选择：
  - gateway 地址为非本机地址（非 `localhost` / `127.0.0.1` / `::1` / 空）→ 直接 HTTP 模式（远程场景，不 spawn）。
  - 否则 `resolveHermesPath()` 找到 CLI 且 `--check` 通过 → **ACP 模式**。
  - CLI 找不到/自检失败 → HTTP 降级（沿用 `~/.hermes/config.yaml` 自动发现）。
- 暴露只读 `mode: 'acp' | 'http'`，view 层据此显示降级顶条。
- ACP 进程中途死亡 → 沿用引擎现有行为（在飞轮次失败、下次发送自动重启 + session/load 恢复）；不做中途切 HTTP（丢上下文）。

## 5. 设置与迁移

- `CURRENT_SETTINGS_VERSION` 4 → 5，新增 `hermesCliPath: string`（默认 `''` = 自动发现），走 `migrateSettings()` 既有管线。
- 设置页方案一布局：ACP 状态行（✅/❌ + 版本 + 路径）→ 模型下拉 → 「高级：HTTP 降级 / 远程 gateway」折叠组（地址/key/测试连接）。
- 模型下拉：ACP 模式用握手模型态（`custom:` 解码为可读名），HTTP 模式维持 `/api/model/options`。
- thoughtLevel 下拉：Hermes 后端下置灰 + tooltip「Hermes 暂不支持调节推理强度」。
- 会话内降级顶条：HTTP 模式时显示「轻量模式：工具/批准卡不可用」。
- 全部新文案进 i18n（中英）。

## 6. 测试与验收

- **探针先行**：`scripts/probe-hermes-acp.mjs` 活探握手/session-new/prompt 流式/批准请求/set_model/set_mode/fork/cancel/历史回放；发现记录进 `docs/`；方言与 §3 有出入时以探针为准回修本设计。
- 引擎平移后：现有 668 项测试全绿不动（仅 import 路径更新）。
- 新增单测：hermes profile（spawn 构建、模型编解码）、路由器模式选择（mock 探测）、事件映射 hermes 方言样本（`_meta.hermes.*` 优雅忽略）、fork 原生路径。
- `scripts/acp-smoke.mjs` 扩 hermes 变体，对真 `hermes acp` 回归。
- 手测清单增补：ACP 全能力 + 降级路径 + 远程 gateway 路径。
- 收尾：`npm run build` 过 + jest 全绿 + smoke 不回退 + README What's New 同步。

## 7. 明确不做（YAGNI）

- hermes 的 skills/personalities/platforms 等 CLI 特有概念不映射。
- 手动 ACP/HTTP 模式切换开关（「自动」已覆盖）。
- thoughtLevel 对 hermes 生效（等 hermes ACP 面暴露 reasoning_effort 再评估）。
- ACP 与 HTTP 之间的会话迁移（两条路径会话历史各自独立）。
