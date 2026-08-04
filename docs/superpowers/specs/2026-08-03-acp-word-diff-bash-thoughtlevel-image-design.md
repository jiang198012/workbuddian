# 任务 C + 图片升级设计：词级 diff / Bash 终端块 / thought_level / 原生图片块

> 日期：2026-08-03 ｜ 状态：自主执行（用户授权收尾第二步，范围按探针证据收敛）
> 前置事实：2026-08-03 活探针（/tmp/acp-c-probe.mjs）+ traffic.jsonl 复查

## 1. 探针结论（逐项终态）

| 子项 | 实测 | 终态 |
|---|---|---|
| Bash 终端块 | completed 的 `tool_call_update` 带 **`rawOutput: {type:'text', text:"Command:…\nStdout:…\nStderr:…\nExit Code:…"}`** | **实现** |
| 文生图 | CLI 自身能生成图片落盘（`A_cute_cat_*.png` 实测出现于 cwd），走 ToolSearch→DeferExecuteTool 链 | **搁置**：CLI 开箱即用，插件侧无需代码；批准卡已覆盖 |
| thought_level | `set_config_option` 七档实测在册：`minimal/low/medium/high/xhigh/max/enabled`；config_option_update 回流含该 id | **实现**（设置页下拉 + 按会话应用 + 回流同步） |
| 原生图片块 | `session/prompt` 接受 `{type:'image', data:base64, mimeType}`：实测 AI 准确描述图片内容 | **实现**（图片升级项并入本任务） |
| 词级 diff | 纯 UI 增强，无需 CLI 能力 | **实现**（共用前缀/后缀裁剪的最小内联高亮） |

## 2. 设计

### 2.1 词级 diff（纯模块 + 两处渲染接入）

- 新增 `shared/wordDiff.ts`：`splitInlineDiff(oldLine, newLine): { oldSegs, newSegs }`，算法=去公共前缀+公共后缀，中段为 changed（字符级，YAGNI 不做词法 LCS）。
- 接入点：工具 diff 块（input.ts diff 渲染循环）与批准卡 Edit 预览（renderApprovalDetail）——add/remove 成对行内高亮 changed 段。
- 行级配对规则：lineDiff 输出的 remove 行与紧随的 add 行一一配对做内联高亮；不配对的行维持现状。

### 2.2 Bash 终端块

- `StreamChunk` 加 `toolOutput?: string`；`mapToolCallUpdate` completed 时若 `update.rawOutput?.type==='text'` 则带 `toolOutput = rawOutput.text`（session 透传）。
- UI：completed 且 toolName 为 Bash/Shell 且带 toolOutput → 行下渲染 `.workbuddian-bash-block`（等宽 pre，含 Command/Stdout/Stderr/Exit Code 全文，默认折叠与 diff 同构）。
- 批准卡 Bash 预览维持命令全文（v2 已有），不动。

### 2.3 thought_level 设置

- `settings.thoughtLevel: string`（默认 `'enabled'`；settings 版本沿用 11——本批均未发布）。
- 设置页「CodeBuddy 连接」组下拉（七档原值作 label，与模型菜单同风格）。
- `provider.setThoughtLevel(level)` → `config.thoughtLevel` → session `applyConfig` 追加 `set_config_option {configId:'thought_level', value}`（失败仅 bbLog）；新会话加载时同样应用。
- 回流：`mapConfigUpdate` 扩展提取 thought_level → `onConfigUpdate` cfg 加 `thoughtLevel?: string` → input.ts 回写 settings.thoughtLevel + saveSettings（不回回调 provider，防回环——沿用 mode/model 同款）。

### 2.4 原生图片块

- `provider.sendMessage(...)` 追加第 6 可选参 `images?: Array<{ data: string; mimeType: string }>`；`session.prompt(text, handlers, images?)` 构造 `prompt: [...images.map(i => ({type:'image', data:i.data, mimeType:i.mimeType})), {type:'text', text}]`。
- input.ts sendText：附件拆分——`isImagePath` 且位于 vault 内的图片 → `vault.adapter.readBinary` 读字节转 base64 进 images；**图片从 `buildAttachmentBlock` 的路径注入中剔除**（v1 路径注入对图片退役）；vault 外图片与非图片附件维持路径注入不变（外部图片读字节依赖 Node fs，留待后续）。
- inline-edit 不传 images，行为不变。

### 2.5 错误处理

- 图片读失败（被删/权限）：降级回路径注入该图片（不阻断发送），bbLog 记录。
- thought_level set_config_option 失败：bbLog，不影响会话。

## 3. 测试策略

- wordDiff 纯函数测试（前后缀裁剪、全同/全异、空串）。
- events/session：completed 带 rawOutput → chunk.toolOutput；Bash 之外也通用携带（UI 只对 Bash/Shell 渲染）。
- session.prompt images 参数→ blocks 顺序（image 在前 text 在后）；无 images 不变。
- provider：setThoughtLevel 对已加载会话发 set_config_option；sendMessage images 透传到 session/prompt params。
- types：thoughtLevel 默认与迁移。
- mapConfigUpdate：thought_level 提取。
- UI 部分 build + 手测 C 组。

## 4. 非目标（YAGNI）

- 文生图插件侧 UI（CLI 已能做，入档）
- vault 外图片的原生块注入（维持路径注入）
- 词法级（word-boundary）diff、多行移动检测
- thought_level 进工具栏（设置页足够）

## 5. 验收标准

1. 全量 jest 绿 + `npm run build` 过 + smoke 11/11 不回退。
2. demo-vault 手测 C 组：词级高亮、Bash 终端块、thought_level 切换（日志可见 set_config_option）、粘贴图片不再产生 Read 工具调用且 AI 能描述图片内容、文生图用例（CLI 能力展示）。
