# ROADMAP B 类批次：工具块修复 / Diff 视图 / Plan Mode / `/resume` 选择器 / 无障碍

## 背景

ROADMAP 里长期挂着的第四阶段遗留项。本批次开工前对 CodeBuddy CLI 做了实测（`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`，`--print --output-format stream-json`），实测结论直接决定了下面每一项的形态：

| 实测事实 | 影响 |
|---|---|
| assistant 信封内的工具块 `type` 是 **`tool_use`**，19 个事件里没有任何顶层 `tool_call` 事件 | `parseMessageBlock` 只认 `tool_call`，**当前工具块全部被丢弃、UI 上不显示**；`blockToChunk` 的 `toolName`/`toolDetail` 是死代码 |
| `Edit` 的 input 为 `{file_path, old_string, new_string}` | 行级 diff 与撤销的数据齐备 |
| `Write` 的 input 为 `{file_path, content}` | 只有新内容，无旧内容 |
| `file-history-snapshot` 事件的 `trackedFileBackups` 只有 `{version, backupTime}` | CLI 把旧内容存在自己的备份区，**插件拿不到**，故 Write 不支持撤销 |
| plan 模式下 CLI 把计划写成 `~/.codebuddy/plans/<name>.md` | 计划正文可读，可渲染成卡片 |
| 提交计划走 `DeferExecuteTool`（`toolName: "ExitPlanMode"`，`params` 为空 `{}`），且在非交互模式下报错 `permission prompts are not available in non-interactive mode` | **无法让原会话继续执行**，「批准」只能实现为「用计划正文重发一轮」 |
| `acceptEdits` 模式下文件已真实写盘 | Diff 只能是「事后展示 + 撤销」，不是「批准后写入」 |

## 目标与非目标

**目标**：恢复工具块显示；对 Edit/Write 展示行级 diff 并支持 Edit 撤销；提供计划卡片与「按此执行」；`/resume` 弹出会话选择器；补齐五条可验收的无障碍改进。

**非目标**：不实现 CLI 原生的计划批准（技术上不可达）；不支持 Write 撤销（无旧内容）；不做配色对比度调整与完整 WCAG 审计；不改 usage / 附件 / 缩略图等既有链路。

---

## 1. 前置修复：工具块被丢弃

`src/providers/codebuddy/index.ts:58` 的 `parseMessageBlock` 放行 `tool_use`，同时保留 `tool_call` 兼容：

```ts
if (type !== 'thinking' && type !== 'text' && type !== 'tool_call' && type !== 'tool_use') return null;
```

`MessageBlock.type` 联合类型加上 `'tool_use'`；`blockToChunk` 的分派把两者一并视为工具块。纯逻辑，`tests/api.test.ts` 补用例：喂一条真实形状的 `tool_use` 信封，断言产出 `{type:'tool', toolName:'Edit', toolDetail:<json>}`。

## 2. Diff 视图（工具块内）

新增纯逻辑 `src/shared/toolDetail.ts`：

```ts
export interface FileEdit { kind: 'edit'; path: string; oldText: string; newText: string; }
export interface FileWrite { kind: 'write'; path: string; newText: string; }
/** 从 toolName + toolDetail(JSON 字符串) 解析出可 diff 的文件改动；不是文件工具或字段缺失时返回 null */
export function parseFileChange(toolName: string, toolDetail: string): FileEdit | FileWrite | null;
```

渲染层（`input.ts` 的 tool 分支）：解析成功时，在该工具条目下渲染一个**默认折叠**的 diff 区，展开后用现成的 `lineDiff(oldText, newText)` 输出 `add`/`remove`/`equal` 行（绿/红/常规）。`Edit` 用 `old_string`/`new_string` 直接 diff；`Write` 以空串为旧文本，等价于「整篇新增」。解析失败或非文件工具时，保持现在的纯文本展示。

**撤销**：仅 `Edit`、且目标路径在 vault 内时，diff 区提供「撤销此修改」按钮——读文件、把 `new_string` 换回 `old_string`、写回，成功后按钮变为已撤销态。`Write` 不提供该按钮（无旧内容）。撤销失败（文件已变、找不到 `new_string`）时 `Notice` 提示，不静默。

## 3. Plan Mode

- `PERMISSION_MODE_CHOICES` 加回 `'plan'`，工具栏权限菜单出现「计划模式」（图标 `eye`，`PERMISSION_MODE_ICONS` 已有该映射）。
- 新增纯逻辑 `isPlanFilePath(p: string): boolean`（`shared/toolDetail.ts`）：识别 `.codebuddy/plans/` 下的 `.md` 路径。
- 渲染层：当权限模式为 `plan` 且捕获到写入计划文件的 `Write` 工具块时，用其 `content` 字段（Write 的 input 自带全文，无需读盘）在气泡内渲染**计划卡片**：`MarkdownRenderer` 渲染正文 + 两个按钮。
  - **「按此执行（重新发起一轮）」**：把计划正文作为新的用户消息，以 `default` 权限模式发起新一轮。文案如实说明是重发，不伪装成原生批准。
  - **「忽略」**：移除卡片。
- CLI 因 `ExitPlanMode` 被拒而返回的那段错误文本不再直接抛给用户——命中该特征时，改为在卡片下方以一行说明呈现（i18n 文案），避免用户以为出错了。

## 4. `/resume` 会话选择器

`/resume` 已在 `BUILTIN_SLASH_COMMANDS` 中。改动只在发送路径：`parseSlashCommand` 得到 `name === 'resume'` 且 `rest === ''` 时，不发给 CLI，改为打开 `ResumeModal`（仿 `instructionModal.ts` 的写法）：列出本插件的全部会话（标题、最后更新时间、消息数），点击即 `switchToConversation`，输入框清空。带参数（`/resume <session-id>`）时保持现状原样透传。

新增纯逻辑 `formatConversationSummary(conv, now)`（`shared/conversationSummary.ts`）：返回 `{ title, meta }`，`meta` 形如 `12 条 · 3 小时前`，供 Modal 显示，可独立测试。

## 5. 无障碍（五条可验收项）

1. 所有可交互元素补 `aria-label` / `role="button"` / `tabindex="0"`：工具栏四个按钮、发送键、chip 的 ✕、标签页、tab 的关闭键。
2. 消息容器加 `aria-live="polite"` + `aria-relevant="additions text"`，助读软件能播报新回复。
3. 输入框补 `aria-label`（不引入可见 label，避免动布局）。
4. `:focus-visible` 焦点环：统一 `outline: 2px solid var(--workbuddian-primary, #C8B487); outline-offset: 2px;`，只在键盘聚焦时出现。
5. 键盘可达：`Esc` 关闭 @ / 斜杠补全下拉与所有 Modal；chip 的 ✕ 支持 `Enter`/`Space` 触发（现在只有 `onclick`）。

## 测试

| 文件 | 覆盖 |
|---|---|
| `tests/api.test.ts` | `tool_use` 信封产出工具 chunk；`tool_call` 旧形状仍兼容 |
| `tests/toolDetail.test.ts`（新） | `parseFileChange` 的 Edit / Write / 非文件工具 / 字段缺失 / 非法 JSON；`isPlanFilePath` 的正反例（含 Windows 反斜杠路径） |
| `tests/conversationSummary.test.ts`（新） | `formatConversationSummary` 的消息数与相对时间（刚刚 / 分钟 / 小时 / 天） |

视图层（`features/**`）按项目惯例不写单测。

## 验收标准

- [ ] `npm run build` 零 TS 错误；`npm test` 全绿。
- [ ] 提问触发一次 Edit 后，气泡内出现工具块（这是修复前完全看不到的），展开可见绿红行级 diff。
- [ ] Edit 的 diff 区点「撤销此修改」，文件内容回到修改前。
- [ ] 权限菜单可选「计划模式」；该模式下提问，气泡内出现计划卡片而非一段错误文本。
- [ ] 点「按此执行」后，以默认权限模式重新发起一轮并真正执行。
- [ ] 输入 `/resume` 回车 → 弹出会话列表 → 选中即切换到该对话。
- [ ] 键盘 Tab 可遍历工具栏与标签栏且焦点环可见；Esc 能关掉补全下拉与 Modal。
