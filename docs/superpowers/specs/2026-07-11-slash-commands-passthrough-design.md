# 3.2 斜杠命令安全透传 — 设计文档

- 日期：2026-07-11
- 阶段：ROADMAP 第三阶段 3.2
- 状态：已确认设计，待实现

## 目标

支持斜杠命令：`/clear` 在插件侧本地新建对话；其余 `/` 开头的命令跳过 context 注入、原样透传给 CodeBuddy CLI（能否被 CLI 识别取决于 CLI，插件只保证不污染命令）。

## 背景与现状

`src/features/chat/input.ts` 的 `sendMessage()` 对所有输入一视同仁：经 `assembleContextText()` 包装（加 vault 路径前缀、当前笔记链接、@引用块）后发给 CLI。用户输入 `/cost` 时，CLI 实际收到 `当前 Vault 路径:…\n---\n/cost`，命令被前缀污染；也没有任何斜杠命令的本地处理。

## 非目标（Non-goals）

- 不做 3.3 的输入 `/` 自动补全 UI。
- 不做 3.4 的交互式命令（`/model` 弹选择器等）。
- 不在插件侧逐个实现命令语义（除 `/clear` 外一律透传给 CLI）。
- 不引入命令白名单（采用「通用」判定：任意 `/` 开头都当命令）。

## 设计

### ① 解析器（新 `src/shared/slashCommand.ts`，纯函数，可单测）

```ts
export interface SlashCommand {
    name: string;   // 命令名，不含前导 /
    rest: string;   // 命令名之后的参数串（已 trim）
}

export function parseSlashCommand(text: string): SlashCommand | null {
    const firstLine = text.trim().split('\n')[0];
    const m = firstLine.match(/^\/(\S+)\s*(.*)$/);
    if (!m) return null;
    return { name: m[1], rest: m[2].trim() };
}
```

判定规则：`text` trim 后**第一行**以 `/` 紧跟非空白字符才算命令。`/`（单独）、`/ 空格开头`、普通文本 → 返回 `null`（当普通消息）。

### ② `sendMessage()` 分派（`src/features/chat/input.ts`）

在拿到 `text` 之后（现有 `if (!text) return;` 之下）插入：

1. `const slash = parseSlashCommand(text);`
2. **`/clear` 本地拦截**（在 `addMessage` 之前，命令不进当前对话）：
   `if (slash?.name === 'clear') { await createNewChat(view); view.inputEl.value = ''; adjustTextareaHeight(view); return; }`
3. **其它斜杠命令透传**：走正常发送流程，但 context 组装改为：
   - 是斜杠命令 → `contextText = text`（原样，不算 referenceBlock / currentNoteLink / vault 前缀）
   - 否则 → 现有 `assembleContextText(...)`
4. 普通消息：逻辑完全不变。

`createNewChat` 已存在于 `src/features/chat/tabs.ts`（新增 import）。

## 测试

- `tests/slashCommand.test.ts`：`parseSlashCommand` 纯函数单测：
  - `/clear` → `{name:'clear', rest:''}`
  - `/model glm-5.2` → `{name:'model', rest:'glm-5.2'}`
  - `/cost` → `{name:'cost', rest:''}`
  - 普通文本 `hello` → `null`
  - 单独 `/` → `null`
  - `/ 空格开头` → `null`
  - 前后空白 `  /status  ` → `{name:'status', rest:''}`
- `sendMessage` 分派是 obsidian 耦合，不测（符合项目测试边界）。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/shared/slashCommand.ts` | 新增 `parseSlashCommand` + `SlashCommand` |
| `src/features/chat/input.ts` | `sendMessage` 加斜杠分派、import `parseSlashCommand`/`createNewChat` |
| `tests/slashCommand.test.ts` | `parseSlashCommand` 单测 |

## 验收标准

1. 输入 `/clear` 回车：本地新建一个空对话并切换过去，**不向 CLI 发送**，输入框清空。
2. 输入 `/cost`（或任意非 `clear` 的 `/` 命令）回车：作为消息发送，但发给 CLI 的 prompt 是**原始命令文本**（无 vault 前缀）；正常流式渲染 CLI 返回。
3. 普通消息（不以 `/` 开头）行为完全不变（仍注入 context / @引用）。
4. `npx jest` 全量绿（含新增 `parseSlashCommand` 用例）；`npm run build` 通过。

## 风险与缓解

- **CLI 非交互模式是否识别 `/cost` 等未知**：本设计只保证「不污染命令」，识别与否由 CLI 决定；不构成插件侧 bug。后续若确认 CLI 不支持某命令，再在 3.4 做插件侧替代。
- **误把以 `/` 开头的普通消息当命令**：采用通用判定的已知取舍；用户如需发以 `/` 开头的普通文本，属极少数场景，暂不处理（YAGNI）。
