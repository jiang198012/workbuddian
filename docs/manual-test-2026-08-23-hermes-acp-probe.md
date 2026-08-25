# Hermes ACP 活探针报告（2026-08-23）

> 探针：`scripts/probe-hermes-acp.mjs`，对真 `hermes acp`（v0.20.5,`/Users/jiang/.local/bin/hermes`）十问。
> 结果：**8/10 PASS**；两项 FAIL 均为探针断言预期错误（非 hermes 缺陷），已据此修正方言事实。

## 逐项结果

| # | 项 | 结果 | 关键数据 |
|---|---|---|---|
| 1 | initialize 握手 | ✅ | `loadSession=true image=true fork+list+resume`；agentInfo hermes-agent@0.20.5；protocolVersion 1 |
| 2 | session/new | ✅ | **models=13**（availableModels 含 `modelId`+`name`+`description`）；modes=`[default, accept_edits, dont_ask]`，current=`default` |
| 3 | 纯对话流式 | ✅ | agent_message_chunk 正常，stopReason=`end_turn` |
| 4 | dont_ask 写文件 | ✅ | 文件落盘、有 tool 事件、**0 批准请求** |
| 5 | default 写文件 | ✅ | **1 个批准请求**，应答 allow_once 后落盘 |
| 6 | session/set_model | ✅ | `custom:k3` 接受，无错误 |
| 7 | session/fork | ✅ | 返回新 uuid（≠旧 id） |
| 8 | load 回放 | ⚠️ 修正 | 回放 14 事件**全部在 load 响应前**、**无 meta 标记**；响应后 800ms 内另有 2 事件（源码确认为 `_schedule_available_commands_update` + `_schedule_usage_update` 的调度更新，非回放，引擎按 usage/旁路正常处理） |
| 9 | load 不存在会话 | ⚠️ 修正 | **返回 `{}`（空对象）**，不是 null、不抛错 |
| 10 | session/cancel | ✅ | stopReason=`cancelled` |

## 关键原始证据

### 模型条目形态（availableModels）
```json
[
  {"description":"Provider: Custom endpoint • current","modelId":"custom:k3","name":"Custom endpoint · k3"},
  {"description":"Provider: OpenCode Free","modelId":"opencode-free:x-preview-f-free","name":"OpenCode Free · x-preview-f-free"}
]
```
**结论：显示名直接用 `name` 字段**（"Custom endpoint · k3"），不要对 modelId 做 `custom:` 解码（实际形态是 `custom:<model>` 单冒号 / `<provider>:<model>`，无统一规则）。

### 批准卡 toolCall 形态
```json
{
  "toolCallId": "edit-approval-1",
  "title": "Approve edit: /tmp/.../probe-hello2.txt",
  "kind": "edit",
  "status": "pending",
  "rawInput": {"tool":"write_file","arguments":{"content":"hi2","path":"/tmp/.../probe-hello2.txt"}},
  "content": [{"type":"diff","path":"...","newText":"hi2"}],
  "_meta": null
}
```
options：`{"kind":"allow_once","optionId":"allow_once","name":"Allow edit"}` / `{"kind":"reject_once","optionId":"deny","name":"Deny"}`。

要点：
- `rawInput` 是 **`{tool, arguments}` 嵌套**（codebuddy 是平铺 file_path/content/command）→ 批准卡/工具摘要需按 profile 归一化（hermes 取 `rawInput.arguments`，工具名取 `rawInput.tool`，如 `write_file`）。
- 拒绝 kind 是 `reject_once`（`startsWith('reject')` 现有匹配兼容 ✅）。
- `_meta` 为空 → 工具名只能来自 title（"Approve edit: …" 句式）或 rawInput.tool（**后者才是机器名，展示优先用它**）。
- `content[].type==='diff'` 自带 newText/path，后续可做更精细的批准卡 diff（本期 YAGNI，仅记录）。

## 对方言事实的修正（spec §1 以此为准）

1. **load-miss 返回 `{}`**（非 null）→ 引擎 miss 判定：`result == null || (object && 无 models/modes 键)`。
2. **回放判别**：确认无 meta 标记；窗口 = load 请求生命周期内；响应后的调度更新（usage/available_commands）不属于回放，引擎按旁路正常路由。
3. **模型显示名**：用 availableModels 条目的 `name` 字段；modelId 原样往返（`custom:k3` 这类 id 不做解码）。
4. **权限输入归一化**：hermes `rawInput={tool, arguments}` 嵌套 → profile 提供归一化钩子；工具机器名从 `rawInput.tool` 取。
