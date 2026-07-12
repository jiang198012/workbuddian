# BuddyBridge 改进路线图

> 本路线图基于 v1.0.9 的用户反馈和长期产品方向整理，按优先级和依赖关系分阶段推进。

---

## 第一阶段：稳定性与打磨（当前优先）

### 1.1 修复「回答完成后仍显示思考中」

**状态**：已修复（v1.0.10）

**问题**：流式响应结束时，如果最后只收到 `done`/`result` 事件或没有任何 `text` chunk，占位用的思考指示器没有被清除。

**修复方式**：在 `sendMessage` 流式循环结束后，统一调用一次 `renderMessages()`，确保 DOM 与最终 message 状态一致。

### 1.2 输入框体验优化

- **多行输入**：`Shift + Enter` 换行，`Enter` 发送（当前已支持，但输入框高度不会自动增长）。
- **自动增高**：根据内容自动扩展 textarea 高度，减少滚动条。
- **发送按钮状态**：流式响应时禁用输入框和发送按钮，避免重复发送。

### 1.3 错误与空状态优化

**状态**：已完成（2026-07-11）。`ChatMessage.isError` + manager `setError`/`deleteLastExchange`；`sendMessage` 解耦出 `sendText`；`render.ts` 的 `renderErrorCard` 渲染错误卡片（⚠️ + 文案 + 重试/打开设置）；重试经 `deleteLastExchange` 重发最近一次出错的 user 文本。空状态早已有（`workbuddian-empty-chat`）。

- 网络/CLI 错误时显示更友好的错误卡片，而不是纯文本。
- 无响应时给出可操作提示（重试、检查路径）。

---

## 第二阶段：个性化与可配置性

### 2.1 自定义主色调

**状态**：已完成（2026-07-11）。设置页原生取色器 + `--workbuddian-primary` 经 `document.body` 单点注入（CSS 用 `var(--workbuddian-primary, var(--interactive-accent))` 回退）+ 恢复默认按钮；同轮把 ribbon/tab 图标换成自绘小猪线条图标。

**目标**：让用户通过命令或设置页修改聊天面板的主色调，而不是固定使用 Obsidian 的 `--interactive-accent`。

**实现思路**：
1. 在 `styles.css` 中定义 `--buddybridge-primary` 变量，默认回退到 `--interactive-accent`。
2. 把所有紫色强调色（用户气泡、Assistant 左边框、按钮、focus ring）改用该变量。
3. 在设置页添加颜色选择器，或在命令面板添加「设置 BuddyBridge 主色调」命令。
4. 将用户选择的颜色写入聊天容器元素的 `style` 属性。

**优先级**：高。改动小、见效快、能显著提升品牌感。

### 2.2 设置页重构

**状态**：已完成（2026-07-11）。设置项按「CodeBuddy 连接 / 上下文注入 / 外观」三组重排（`setHeading`）+ 底部「重置为默认」按钮（二次点击确认）+ onload 与重置复用 `applySettingsToApi()`。并含导入/导出：`exportSettings` 复制为 JSON、粘贴导入走 `migrateSettings` 容错（2026-07-11 补做）。

- 将设置项分组：通用、CodeBuddy 路径、外观、快捷键。
- 添加「重置为默认」按钮。
- 支持导入/导出设置。

---

## 第三阶段：斜杠命令（Slash Commands）

### 3.1 设计原则

- **不照搬 Claudian**：只借鉴「输入 `/` 触发命令」这一通用交互，代码独立实现。
- **优先透传**：CodeBuddy CLI 本身支持大量 `/` 命令，先把输入原样透传给 CLI，让 CLI 自己处理。
- **本地命令插件化处理**：对需要特殊 UI 或不能交互的命令，在插件侧提供替代实现。

### 3.2 第一阶段：安全透传

**状态**：已完成（2026-07-11）。`parseSlashCommand`（`src/shared/slashCommand.ts`）解析斜杠命令；`/clear` 在插件侧本地新建对话，其余 `/` 命令跳过 context 注入原样透传给 CLI（通用判定，非白名单）。CLI 对非交互斜杠命令的支持由 CLI 决定，插件只保证不污染。

这些命令不需要交互，直接透传给 CLI：

- `/clear` → 实际在插件侧新建对话（更快）
- `/compact`
- `/context`
- `/cost`
- `/model <model-name>`
- `/permissions`
- `/resume <session-id>`
- `/export`
- `/status`

### 3.3 第二阶段：输入框自动补全

**状态**：已完成（2026-07-11，内置命令表部分）。`BUILTIN_SLASH_COMMANDS` + `extractSlashQuery`/`filterSlashCommands`（`src/shared/slashCommand.ts`）+ `updateSlashSuggest`（复用 @ 补全的 `atSuggestEl` 下拉，`oninput` 先 slash 后 @ 分派）。并含自定义命令：扫描 `.codebuddy/commands` 的 md（`commandNameFromPath` + `parseCommandFrontmatter`）实时合并进补全（2026-07-11 补做）。

- 用户输入 `/` 时弹出命令列表。
- 内置命令表硬编码在插件中。
- 扫描 vault 下 `.codebuddy/commands/**/*.md`，读取 frontmatter 的 `description` 和 `argument-hint`，作为自定义命令来源。
- 命令命名规则与 CodeBuddy 一致：
  - `commands/test.md` → `/test`
  - `commands/backend/deploy.md` → `/backend:deploy`

### 3.4 第三阶段：交互式命令

对无法在非交互模式下运行的命令，由插件提供 UI：

| 命令 | 插件行为 |
|---|---|
| `/model` 不带参数 | 弹出模型选择器 |
| `/resume` 不带参数 | 弹出历史会话选择器 |
| `/config` | 打开设置面板或快速切换常用配置 |
| `/theme` | 弹出主题选择器 |

---

## 第四阶段：高级功能（长期）

### 4.1 上下文用量指示器

**状态**：已完成（2026-07-12）。实测 CLI 的 `result` 事件带 `usage`，`input_tokens` 即整轮 prompt 总量（= cache_read + cache_creation，实测精确相等），取它作「已用上下文」。数据流：`parseUsage`（`providers/codebuddy`）把 usage 带到 `done` chunk → `input.ts` 流式 `done` 分支 `manager.setUsage` 写入 `Conversation.lastUsage`（随 flush 持久化）→ `renderContextUsage`（`input.ts`）在输入区新增的 `workbuddian-input-toolbar` 左侧渲染环形仪表盘（`conic-gradient` 跟随主色）+ `22.6k · 11%`，`renderMessages` 统一触发刷新。百分比分母 = 新设置项 `contextWindowSize`（默认 200000，可在「外观」组改），封顶 100%。纯函数 `formatTokenCount`/`contextPercent`（`shared/contextUsage`）+ `parseUsage`/`setUsage`/迁移 均有 jest 覆盖；设置版本 5→6。

参考 Claudian 的圆形仪表盘，在输入区工具栏显示当前会话的 token 使用百分比。

**依赖**：~~需要 CLI 提供 context 用量事件或接口~~ → 已确认 `result.usage.input_tokens` 提供。

### 4.2 文件引用（@mention / file chips）

**状态**：已完成（2026-07-11）。`@[[note]]` 补全已有；新增输入框上方引用 chips（`renderReferenceChips` 实时镜像 textarea 里的 `@[[...]]`，点 ✕ 经 `removeAtReference` 删除）。发送注入（`buildReferenceBlock`）未变。

- 输入 `@` 弹出文件选择器。
- 选中文件后显示为可删除 chip。
- 发送时把文件路径注入 prompt。

### 4.3 Plan Mode / Inline Edit / Diff 视图

**状态**：Inline Edit + Diff 已完成（2026-07-11，第四阶段长任务阶段 1）。命令「用 CodeBuddy 编辑选区」→ 指令 Modal → `buildEditPrompt` 强约束 → 调 CLI → `lineDiff`(LCS) 行级 diff Modal → 接受写回 `replaceSelection`。Plan Mode 暂缓（依赖 CLI 计划事件未知）。

- **Plan Mode**：当模型返回计划时，以卡片形式展示，用户可批准或拒绝。
- **Inline Edit**：在笔记中高亮选区，调用 CodeBuddy 编辑并展示 diff。
- **Diff 视图**：对 Write/Edit 工具结果展示行级 diff，支持接受/拒绝。

### 4.4 多语言与无障碍

**状态**：i18n 中/英已完成（2026-07-11，第四阶段长任务阶段 2）。`src/i18n/index.ts` 98 个中英字典 key + `t()`（`initLang` 跟随 Obsidian 界面语言）；用 workflow 6 agents 并行抽 6 文件 UI 串 + 主汇总 settings/slashCommand + 全量 build/test/key 校验。发给 CLI 的 prompt 与 `[BB]` 日志保持中文。ARIA 已有基础，未专项加强。

- 提取所有用户可见字符串到 i18n 文件。
- 支持中文 / English。
- 完善键盘导航、焦点管理和 ARIA 属性。

### 4.5 移动端适配

- 当前插件是桌面端专用（`isDesktopOnly: true`）。
- 后续评估是否支持移动端 Obsidian，主要障碍是 CodeBuddy CLI 的调用方式。

---

## 决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-06-27 | 不修改 `api.ts` 的 spawn 逻辑 | 该文件属于敏感区域，路径问题通过插件设置手动指定解决。 |
| 2026-06-27 | UI 参考 Claudian 但不复制代码 | 避免版权风险，只借鉴通用设计模式。 |
| 2026-06-27 | 斜杠命令优先透传给 CLI | 最大限度复用 CodeBuddy 已有能力，减少插件维护成本。 |
| 2026-07-11 | 3.4 交互式命令暂缓 | 插件侧再造一套命令 UI 成本高、收益低；`/config` 已由错误卡片「打开设置」覆盖，暂无必要。 |

---

## 下一步行动

1. 收集 v1.0.9/v1.0.10 的实际使用反馈。
2. 根据反馈调整第一阶段优先级。
3. ✅ 已完成 2.1 自定义主色调（2026-07-11）。
4. ✅ 已完成 2.2 设置页重构（分组 + 重置默认 + 导入导出）（2026-07-11）。
5. 第二阶段收官，进入第三阶段斜杠命令。
6. ✅ 已完成 3.2 安全透传（/clear 本地 + 斜杠命令跳过 context 透传；通用判定）（2026-07-11）。
7. ✅ 已完成 3.3 输入 `/` 自动补全（内置命令表 + 自定义命令扫描）（2026-07-11）。
8. ✅ 已完成 1.3 友好错误卡片 + 重试（2026-07-11）。第一阶段全部收官。
9. 3.4 交互式命令：暂缓（2026-07-11 评估过于复杂、暂无必要，需要时再启动）。
10. ✅ 补做 3.3 自定义命令扫描 + 2.2 导入导出（2026-07-11）。前三阶段（除跳过的 3.4）全部完成，仅剩第四阶段长期项。
11. ✅ 已完成 4.2 文件引用 chips（2026-07-11）。第四阶段剩：4.1 上下文用量（依赖 CLI）/ 4.3 Inline Edit / 4.4 i18n / 4.5 移动端评估。
12. ✅ 第四阶段长任务完成（2026-07-11）：4.5 砍（移动端不可行）、阶段 1 = 4.3 Inline Edit+Diff、阶段 2 = 4.4 i18n（workflow 6 agents 并行抽取 + 主汇总校验）。仅剩 4.1 上下文用量待 CLI 数据。
13. ✅ 已完成 4.1 上下文用量指示器（2026-07-12）：实测 `result.usage.input_tokens` 提供数据，输入区工具栏环形仪表盘 + 可配置窗口上限。第四阶段实质收官（3.4 交互式命令、4.5 移动端为主动搁置项）。
14. ✅ 输入区工具栏重排（2026-07-12）：输入框改为带边框容器 + 框内底部工具栏，发送改小图标；行内 `[模型下拉][附件][授权][圆环][发送]`。新增：**模型下拉**（复用 `MODEL_OPTIONS`，切换即持久化）、**附件**（系统文件选择器挑任意文件 → chips → 发送时注入绝对路径块交 CLI 读取，`shared/attachments`）、**授权**（permission 模式菜单 → `--permission-mode` 透传，实测 CLI 支持 `default/plan/acceptEdits/bypassPermissions`，设置版本 6→7）。模型/授权同步进设置页。
15. ✅ 工具栏微调 + 选区注入（2026-07-12）：删掉圆环用量展示（太占地方，数据层休眠保留）；发送键 `flex-shrink:0` 永不被挤出、模型下拉可收缩；图标全去框；模型框宽 70%；授权精简为「默认/完全访问」，完全访问用 `shield-alert`（盾内感叹号）。新增**选区注入**：抓当前笔记选区 → 选区 chip → 发送时作只读上下文注入（`buildSelectionBlock`，`shared/selection`）；仅聊天路径，不碰 inline-edit。
16. ✅ 选区实时 chip（2026-07-12）：选区来源改为追踪 `lastMarkdownView`（聚焦聊天后 `workspace.activeEditor` 会变空）；模型改回点击弹出（悬停易误触）；`document` 去抖监听 `selectionchange`，选区一变 chip 即出现/更新/消失（实时镜像，无 ✕，取消选择即消失，选中期间每次发送都带上）。曾同时做过编辑区「加入聊天」浮层（B），因干扰太大**已撤除**（连 `selectionWidgetPosition`/module/CSS/i18n 一并清干净）。
17. ✅ 默认色改土黄 + 设置精简（2026-07-12）：CSS 默认 fallback 从 `--interactive-accent` 改为土黄 `#C8B487`（`primaryColor` 为空时生效，仍可自定义覆盖）；强调底文字（用户气泡/激活标签）改黑。设置页删掉模型/授权两项（已在工具栏前台）。
18. ✅ 界面语言设置（2026-07-12）：设置「外观」组加语言下拉 Auto（跟随 Obsidian）/ 中文 / English；`language` 设置项（默认 auto，版本 7→8）+ `applyLang`（auto 走 `detectLang`）；onload 按设置应用；切换即时刷新设置页并提示重开聊天面板生效。补齐 4.4 缺的「用户可手选语言」。
