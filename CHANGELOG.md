# Changelog

## v2.1.0 — 2026-08-09

UX 全面改造（首轮体检驱动）+ E2E 测试基建。617 项单测全绿；e2e 连真实 Obsidian 全流程验证。

### 新增（2026-08-09 补）

- **context-saving MCP**：MCP 服务器改为 `@mcp/xxx` 激活才注入会话，未引用时不占上下文（省 token）；无引用时保持全局注入兼容旧行为。
- **国内模型 UI 优化**：模型选择菜单显示中文名（DeepSeek V4 Pro 深度求索 / GLM-5.2 智谱 / Kimi 月之暗面 / MiniMax 稀宇），国内模型优先排序；模型按钮文字同步中文名。
- **CodeBuddy 插件管理**：设置页新增「CodeBuddy 插件」分组，扫描 `~/.codebuddy/plugins` 按市场列出插件（含中文描述），启停 / 更新经 CLI 可信通道执行。
- **模板 prompt**：`/translate`、`/summarize`、`/rewrite`、`/polish`、`/review`、`/explain` 六个常用模板，选中即填入输入框供编辑（⚡ 标识与 CLI 命令区分）。
- **@stats vault 统计**：消息含 `@stats` 时注入 vault 统计摘要（文件/笔记/目录数/热门标签/文件示例），`@st` 前缀补全。
- **会话导出增强**：导出 Markdown 带元数据行（导出时间/消息数）+ 每条消息时间戳 + 附件标注 + 错误标记。
- **命令面板增强**：新增「新建对话 / 编辑常驻指令 / 打开设置 / 导出当前会话 / 搜索会话」命令。
- **会话搜索**：标签栏搜索框实时过滤（调 manager.search，标题+消息正文），命中标题高亮；`/resume` 选择器加搜索过滤 + 无结果提示。
- **删除会话确认**：标签 ✕ 与右键删除都弹 Notice 确认（点「确认删除」才真删，3 秒不点自动消失），防误删。
- **上下文用量预警条**：用量 ≥80% 时输入框上方显示「上下文已用（NN%）」+ 一键「压缩 /compact」/「新建对话」。
- **dual-pane 常驻会话管理器**：主编辑区大面板左侧新增常驻会话列表栏（新建+搜索+竖向列表）；侧栏窄面板保持顶部标签。
- **会话置顶/星标**：右键「置顶/取消置顶」，置顶会话排最前 + 📌 标识。
- **e2e 测试环境修复**：start-obsidian-debug.sh 启动前临时 pin demo-vault 为唯一 open（避免 Obsidian 恢复正式 vault 导致测试加载旧插件），退出恢复。
- 644 项单测全绿（新增 27 项覆盖 mcpServers / cliOptions / codebuddyPlugins / promptTemplates / vaultStats / export）。

### UX 改进（7 项）
- **修复思考内容泄漏进回复正文**：`renderMarkdownContent` 原用「插到思考块之前」定位正文容器，思考块在流式过程中重建后容器落到其后面，思考文本被渲染成正文。改为始终把正文容器锚定在 bubble 末尾（思考/工具块之后）。
- **输入工具栏分组**：左组输入相关（模型/附件）、右组会话控制（授权/指令/用量/发送），缓解窄面板下模型按钮被压到 31px。
- **消息操作入口**：复制按钮默认半透明可见（原仅 hover 浮出，触屏/不常 hover 难发现）；新增代码块级复制按钮（代码块右上角，hover 浮出）。
- **标签栏会话管理**：选中标签自动滚入可视区、悬停显示完整标题、细滚动条（标签多时不再把当前对话挤出屏幕）。
- **空态快速开始**：加「总结当前笔记 / 解释这个想法 / 改写这段文字」建议 chips，点击填入输入框。
- **Bash 输出默认展开**：命令结果是用户关心的，不再默认折叠；思考/工具/diff 保持折叠。
- **错误卡时间戳**：错误卡右上角显示发生时间，区分「刚发生」与「历史遗留」。

### 工程
- **i18n `t()` 回落链**（当前语言 → en → zh → key），为 ja/ko 等多语言扩展铺路（全量翻译留后续）。
- **E2E 测试基建**（`scripts/e2e/`，Playwright CDP 驱动真实 Obsidian）：`start-obsidian-debug.sh`（直接 exec 二进制传参 + allow-origins）、`probe-cdp.mjs`（端口/页面探针）、`probe-selectors.mjs`（UI 选择器校准）、`probe-ui.mjs`（UI 体检，抓布局数据）、`run.mjs`（完整 e2e：插件加载→开面板→发消息→流式回复→截图）、`run-all.sh`（构建+同步+启动+e2e 一键）。安全闸：脚本侧读 data.json 的 `settings.e2e` 才发真消息（防误发）。
- 新增 devDependency `playwright-core`；`.gitignore` 排除 e2e 截图产物。

## v2.0.2 — 2026-08-04

发布合规修复（Obsidian 市场审核口径）：日志弹窗、常驻指令弹窗、/resume 会话选择弹窗的标题由直接 `createEl('h3')` 改为 `Setting.setName(...).setHeading()`。无行为变更。

## v2.0.1 — 2026-08-04

独立化收官：与上游 BuddyBridge 的代码关系清零。全部 48 个源文件与上游逐行比对相似度 <30%（其中 45 个 <10%，styles.css 仅 7.5%），`LICENSE` 版权行、`NOTICE` 衍生声明、`README` 致谢同步移除。

- **行为等价重写**（表达式全新，公开 API 与持久化数据格式均不变）：`types`（设置迁移改为描述表驱动、uuid 改用加密随机源）、`ConversationManager`（工厂/查询/变更/持久化四段重组）、`cliPath`（候选路径表驱动 + 调用期读环境）、`main.ts`（分步启动 + 会话持久化单点）。617 项单测全程锁定行为。
- **styles.css 彻底档重写**：新增设计令牌（间距 5/7/10/14、圆角 3/7/10/16、accent 变量），组件分节重组、声明重排、数值换新（diff 配色改 `rgba(46,160,67)` / `rgba(214,69,65)`、气泡/卡片内边距、用量环粗细、缩略图尺寸等）。选择器集合与原完全一致（机器校验零缺失），视觉变化为刻意微调，需一轮回归手测。
- 无功能新增、无行为变更：本版只做独立性与代码整洁。

## v2.0.0 — 2026-08-04

架构级大版本。底层从「每条消息起一个进程」切换为 **ACP 持久会话协议**；在此之上完成三轮真实 GUI 手测 × wire 探针驱动的可靠性攻坚——CLI 的多个隐蔽行为（会话路由、配置生效、状态机死锁）被逐一实锤并防御。

### 架构：ACP 持久会话（provider 重写）
- 单进程 `codebuddy --acp` 常驻 + 多会话懒加载：上下文真保持，第二轮起明显加速；进程意外退出后重发消息自动 `session/load` 恢复，报错卡如实提示。
- 权限批准卡进气泡：Write（路径+行数）/ Edit（路径+diff 预览）/ Bash（命令全文）/ MCP 工具按卡批准；计划模式出「计划已就绪」卡，批准后**同一轮**继续执行，不再重发一轮。
- 工具调用增量渲染：同一调用一行就地演化（流式 → 完成），完成态出默认折叠的结构化 diff，vault 内 Edit 可一键撤销（多重安全闸门：文件已变/替换不唯一/纯删除均拒绝）。
- 会话分叉：标签右键「分叉当前会话」，CLI `/branch` 开出含全部历史的支线并自动切入。
- 双面板真隔离：主面板与侧栏各自绑定会话，定向停止互不误杀。

### 新增
- **@ 提及四源聚合**：子代理（`@reviewer`）/ MCP 服务器（`@fake`）/ Vault 笔记（`@[[名]]` 读正文）/ 任意文件（附件 chip）。
- **MCP 可视化管理**：列表增删改/启停/剪贴板导入；JSON 直编双向即时同步（合法即刷、非法不动）。子代理 JSON（CLI `--agents`）实测支持 tools/model 键。
- **自动会话标题**：首轮后 AI 命名（可关；手动改名不覆盖）。标题轮是**可抢占**后台任务——你一发消息它立即让位，绝不拖慢吐字。
- **思考力度七档**（thought_level）设置；`/effort` 改动同步回设置页（CLI 重启后保持）；「查看日志」可见全部出站配置请求。
- **原生图片**：截图 / Finder 复制 / 粘贴均生成图片块直接发送，无需 Read 工具；tiff 自动转 PNG。
- **vault 外附件授权窗**：发送前确认（允许一次 / 按路径总是允许 / 取消），取消则文件内容根本到不了模型——CLI 对 Read 一律自动放行（含 cwd 之外，探针实测），授权只能由插件把关。
- **inline edit 词级高亮**：变更词加深底色，不再是整行饱和红绿；弹窗关闭路径加固。
- Bash「输出」终端块（命令/stdout/stderr/退出码）；Agent「子代理输出」折叠块；流式渲染 150ms 节流合并。

### 可靠性攻坚（wire 探针实锤的根因与对策）
- **CLI 把 prompt 的事件流与模型上下文路由给「最近 new/load 的会话」，直接忽略请求里的 sessionId**（探针：A 的 54 个 chunk 全打到标题会话名下）。这是自动标题后无响应、fork 后原会话失效、双面板互扰的共同根因。对策：prompt 串行队列 + 队首再激活（重发 `session/load`）+ 误标事件纠偏路由（归给唯一在飞会话）。
- **`set_mode` / `set_config_option` 同样跟随活动指针**（探针：B 激活时对 A set_mode 无效）：灌配置前先激活目标会话，「完全访问仍弹卡」「设置不生效」同愈。
- **CLI 会话状态机可永久卡死**（GUI 日志实锤：`AGENT_ENDED` / `RUN_PREPARING` 被 `ignored invalid transition`，`cancelling` 死态后所有 prompt 进门即丢，重发无用）：零 chunk 落账即判定卡死，**自动重启进程自愈**，下条消息经 `session/load` 恢复上下文。
- Write/Edit 完成态丢失路径与 diff：rawInput 快照按 toolCallId 聚合、批准卡水合、空更新不再冲掉快照；撤销判定前路径规范化（相对→绝对）。
- Agent 最终文本重复 2-3 次：子代理中继与主代理总结两路同进正文；中继现归入 Agent 行「子代理输出」折叠块，正文只剩一遍。
- Reject 批准后泄露英文内部推理：thinking 永不升格为正文，拒绝轮写本地化固定终态。
- 未支持的 agent→client 请求此前一律不回（CLI 干等挂死）：现回 `method not found`。
- 模型菜单修复：CLI 列表自带 `auto` 导致的双 auto 去重；兜底列表补齐 `kimi-k3-1`，与 WorkBuddy 完全一致。
- 标题轮可被发送即时抢占（排队中被取消的轮次到队首直接作废），恢复持续吐字的响应感。

### 测试与工程
- **617 项单测**全绿；CLI smoke **14 项门禁**：握手/多轮/权限落盘/cancel/load 回放/plan 链/fork（含多词中文分支名）/交叉会话再激活。
- 新增 `scripts/acp-probe.mjs` 行为探针（write-perm / reactivate / titlefix / configroute / bypass / agent / attach / cadence 八场景），wire 级回答「CLI 到底怎么行为」，本次多数根因由它实锤。
- 「查看日志」弹窗每秒自动刷新；新增出站请求摘要、误标纠偏、prompt 前再激活、工具完成快照、卡死自愈等诊断行，排查不再靠猜。

## v1.5.0 — 2026-07-28

ROADMAP 第四阶段遗留项收官。**其中一项是修复：此前所有工具调用在界面上根本不显示。**

### 修复
- **工具调用块此前完全不可见**：CLI 的工具事件类型是 `tool_use`，而解析器只接受 `tool_call`，导致每一次工具调用都被静默丢弃——`toolName` / `toolDetail` 一路是死代码。修好后工具调用才第一次真正到达界面，本版其余功能均以此为基础。
- **长工具参数撑破布局**：工具条目会把含绝对路径的完整 JSON 铺开。此前虽写了 `text-overflow: ellipsis`，却因父元素是 flex 容器、子项默认 `min-width: auto` 而完全不生效，长文本把气泡一起撑开、出现横向滚动条，并把撤销按钮挤出可视区。

### 新增
- **行级 diff**：Edit / Write 的改动在工具块内以绿(+)红(-)行级 diff 展示，默认折叠，复用既有的 LCS 实现。
- **一键撤销**：vault 内的 Edit 改动可一键回退。三道安全闸门：文件已变化则拒绝、替换文本在文件中不唯一则拒绝、纯删除（新文本为空）不提供撤销——三种情况都只提示不改文件。Write 不提供撤销，因为 CLI 不提供被覆盖文件的旧内容，物理上无法回滚。
- **计划模式与计划卡片**：权限菜单恢复「计划模式（只读不改）」。该模式下 CLI 产出的计划以卡片呈现，可一键「按此执行」。由于 CLI 在非交互模式下无法原生批准计划（`ExitPlanMode` 必被拒绝），该按钮的实际语义是把计划正文重新发起一轮，卡片文案已如实说明；执行使用「自动接受编辑」权限，且**仅对这一次调用生效，不改动你的权限设置**。
- **`/resume` 会话选择器**：`/resume` 不带参数时弹出会话列表（按最近更新倒序，显示消息数与相对时间），选中即切换；带参数仍原样透传给 CLI。
- **无障碍改进**：ARIA 标签、`role="tablist"`/`aria-selected`、`:focus-visible` 焦点环（仅键盘聚焦时显示）、Esc 关闭补全下拉、chip 的 ✕ 与标签页支持 Enter/Space 激活、diff 展开头可键盘操作（此前撤销按钮对键盘用户完全不可达）。新回复经由独立的隐藏播报区通知屏幕阅读器，不会重复朗读整段历史。
- **补全下拉支持键盘**：`@` 与斜杠命令补全可用 ↑↓ 选择、回车确认，鼠标悬停与键盘高亮同步。此前下拉只响应鼠标，键盘按回车会把 `@` 当作正文发出去。
- **纯图片消息**：粘贴图片后无需再输入文字即可直接发送。

### 内部
- `parseFileChange` / `isPlanFilePath` / `formatConversationSummary` / `nextSuggestIndex` 等纯逻辑均在 `shared/` 并配单测，全量 526 项测试。
- `LICENSE` 恢复为标准 MIT 文本（此前因正文中插入说明段落而被 GitHub 判为 `NOASSERTION`），衍生说明移至 `NOTICE`。
- 新增发布工作流：打 tag 即校验 tag 与 `manifest.json` 版本一致、构建、测试、创建 Release，并为 `main.js` / `styles.css` 生成构建溯源证明（artifact attestations）。

## v1.4.0 — 2026-07-27

### 新增
- **上下文用量圆环**：输入区工具栏（发送键左侧）显示当前对话的上下文占用——14px 圆环，悬停出 `上下文用量 22.6k / 200.0k · 11%`，占比 ≥80% 时整环变红提醒该开新对话。没有用量数据的对话（新建、或历史旧对话）完全不显示该元素，不占工具栏横向空间——这正是它在 v0.3.0 因「圆环+常驻文字太占地方」被移除后，这次只保留圆环、把数字挪进悬停提示的原因。分母沿用设置项「上下文窗口上限」（默认 200000），窗口被改为 0 或负数时显示 0% 而非报错，用量超出窗口时封顶 100%。
- 新增纯逻辑 `usageTooltip` / `isUsageWarning` / `USAGE_WARNING_PERCENT`（`shared/contextUsage.ts`），含 6 项单测。usage 的采集与持久化链路（`parseUsage` → `Conversation.lastUsage`）自 v0.3.0 起一直在运行，本次只恢复 UI。

## v1.3.0 — 2026-07-26

### 新增
- **气泡内图片缩略图**：用户消息发出后，图片附件在气泡内以 40×40 缩略图显示（vault 内走 Obsidian 资源路径，vault 外读盘转 data URL）；图片已被清理或路径失效时自动降级为 paperclip + 文件名，不出现碎图。`ChatMessage.attachments` 语义由文件名改为绝对路径，旧消息经新纯函数 `isAbsolutePath` 识别后按原样显示，无需迁移。(#1)
- **粘贴图保留数量可配置**：设置页「上下文注入」组新增「粘贴图保留数量」，默认 20、最大 500，**填 0 表示不限制**（历史消息缩略图永不失效，代价是图片持续累积）。settings 版本 9 → 10。(#2)

## v1.2.4 — 2026-07-21

### 新增
- **动态模型列表**：插件启动时后台执行 `codebuddy --help`，实时拉取当前 CLI 支持的模型列表；模型选择菜单自动展示 CLI 返回的可用模型，新增模型无需插件更新即可出现。CLI 不可达或解析失败时回退到内置硬编码白名单，不影响使用。
- 新增纯逻辑模块 `providers/codebuddy/models.ts`（含 `parseModelList` / `fetchModels`）与对应单测 13 项。

### 改进
- `CodebuddyProvider` 新增 `availableModels`、`setAvailableModels()`、`getAvailableModels()`、`getScriptPath()`，模型菜单改为从 provider 获取列表。
- `utils/cliPath.ts` 新增跨平台 `spawnCli()` 辅助函数，统一 CLI 启动策略；原 `providers/codebuddy/index.ts` 中的 `isWindowsWrapper`/`isBareFallback`/`needsWindowsShell` 迁移至 utils 并复用。

## v1.2.3 — 2026-07-21

### 新增
- **附件文件名标签**：用户发送带附件的消息后，`ChatMessage` 新增可选 `attachments` 字段保存文件名；`ConversationManager.addMessage` 支持附件参数；渲染层在消息正文上方显示 paperclip + 文件名的 chip。不影响 prompt 注入、标题生成、搜索、导出；旧消息无 `attachments` 字段时正常渲染。

## v1.2.2 — 2026-07-17

### 修复
- **中文输入法 Enter 误发送**：输入法组字（有候选）时按 Enter 只确认候选、不再发送消息；候选为空时 Enter 才发送（Shift+Enter 换行不变）。判断抽为纯函数 `shouldSendMessage`（`isComposing || keyCode 229`），含 6 个单测。

### 新增
- **消息复制按钮**：每条消息鼠标悬停时，气泡下方浮出复制按钮，一键复制该消息原文；图标短暂变 ✓ 反馈，中英双语。

## v1.2.1 — 2026-07-17

### 修复
- **`spawn ENAMETOOLONG`（Windows）**：针对大笔记 / 大 `@` 引用提问时，整段 prompt 曾作为命令行位置参数传给 CodeBuddy CLI，超出 Windows 命令行长度上限（cmd.exe 8191 / CreateProcess 32767 字符）导致 spawn 失败、无法提问。改为经 **stdin** 传入 prompt（CLI 默认 `--input-format text` 从标准输入读），命令行只剩固定 flag，彻底消除长度限制，笔记多大都不再报错。(#3)

### 内部
- 品牌命名统一：清理面向用户文档与运行日志前缀里的历史项目名残留（`LICENSE` / `NOTICE` 的 MIT 归属致谢按许可证要求保留），并移除改名重构阶段的历史过程文档。

## v1.2.0 — 2026-07-14

### 新增
- **指令模式 `#`**：聊天框输 `#你的规则` 设一条**全局常驻指令 / 人设**，作为最前置块注入每条消息、对所有对话生效；弹窗可编辑，工具栏 `#` 按钮指示 / 编辑 / 清除。新增纯逻辑 `shared/instruction`（含单测），settings 升 v9。
- **`@` 引用扩展到任意文件**：从「仅 markdown 笔记」扩到任意 vault 文件——md 读正文嵌入，非 md 作附件路径交 CLI 读。
- README 重构：What's New 打头、功能亮点、致谢下沉。全量 253 测试全绿。

## v1.1.0 — 2026-07-13

### 新增
- **图片粘贴 / 拖拽 + 视觉**：聊天输入框支持 `Cmd+V` 粘贴截图、从访达拖拽图片文件。粘贴图落盘到 vault 内 `.obsidian/plugins/workbuddian/pasted/`（保留最近 20 张），以缩略图 chip 展示，交 CodeBuddy CLI 做视觉分析。新增纯逻辑模块 `shared/imageStore`（含单测），全量 241 测试全绿。

## v1.0.0 — 2026-07-13

首个面向 Obsidian 社区插件市场的稳定版：manifest 描述精简（只讲功能、≤250 字）、`authorUrl` 指向作者主页、去掉 console 噪音、README 增补「与同类插件的差异说明」。

## v0.4.0 — 2026-07-12

逐字流式 / 附件外部读取 / i18n 即时切换 / 设置页重构 / 标签右键菜单。

## v0.3.0 — 2026-07-12

输入区工具栏重构 + 选区注入 + 默认配色 + 界面语言；首个对外开源版本。

### 新增
- **输入区重构**：输入框改为带边框容器 + 框内底部工具栏，发送键改小图标（流式时变停止图标）。
- **模型下拉**：工具栏内点击弹出模型菜单，切换即持久化（复用 `MODEL_OPTIONS`）。
- **附件**：系统文件选择器挑任意文件 → 可删 chips → 发送时注入绝对路径，交 CLI 用文件工具读取（`shared/attachments`）。
- **授权模式**：工具栏盾牌菜单「默认 / 完全访问」，透传 `--permission-mode`；完全访问时盾牌带感叹号（`shield-alert`）。
- **4.1 上下文用量**：实测 CLI `result.usage.input_tokens` 提供数据（后因占地移除展示，采集层保留）。
- **选区注入**：追踪 `lastMarkdownView`，笔记选中即实时显示选区 chip，发送时作只读上下文注入（`shared/selection`）。
- **界面语言设置**：外观组下拉 Auto（跟随 Obsidian）/ 中文 / English（`applyLang`）。

### 改进
- **默认配色**：默认强调色改土黄 `#C8B487`（`primaryColor` 为空时的 CSS fallback，仍可自定义覆盖）；强调底文字（用户气泡 / 激活标签）改黑。
- **设置页精简**：模型 / 授权已在工具栏前台，设置页移除重复项。
- 理顺版本：`versions.json` 清理为 0.x 映射，`manifest`/`package.json` 补作者与仓库地址。

### 测试
- 189 项测试全绿（v0.2.0 的 156 → 189），新增 `attachments`/`contextUsage`/`selection`/`cliOptions` 等纯逻辑单测；全程 TDD。

## v0.2.0 — 2026-07-11

第四阶段长任务收官版本。

### 新增
- **3.2 斜杠命令安全透传**：`/clear` 本地新建对话，其余 `/` 命令跳过 context 注入原样透传给 CLI。
- **3.3 输入 `/` 自动补全**：内置命令表 + 扫描 vault `.codebuddy/commands/**/*.md` 自定义命令（`commandNameFromPath` + frontmatter）。
- **1.3 友好错误卡片 + 重试**：错误以卡片呈现（⚠️ + [重试] [打开设置]）；`sendMessage` 解耦出 `sendText`，重试经 `deleteLastExchange` 重发。
- **2.2 导入/导出设置**：`exportSettings` 复制 JSON / 粘贴导入走 `migrateSettings` 容错。
- **4.2 文件引用 chips**：`@[[note]]` 在输入框上方可视化为可删除 chip（`renderReferenceChips` + `removeAtReference`）。
- **4.3 Inline Edit + Diff**：命令「用 CodeBuddy 编辑选区」→ 指令 Modal → 调 CLI → `lineDiff`(LCS) 行级 diff Modal → 接受写回。
- **4.4 i18n 中 / 英**：`src/i18n/index.ts` 98 个中英字典 key + `t()`，`initLang` 跟随 Obsidian 界面语言（发给 CLI 的 prompt 与 `[WB]` 日志保持中文）。

### 决策
- 3.4 交互式命令：暂缓（插件侧再造命令 UI 收益低）。
- 4.5 移动端：砍（`child_process.spawn` 本地 CLI，移动端不可行）。
- 4.1 上下文用量：待 CLI 提供 token 数据再做。

### 测试
- 156 项测试全绿（v0.1.0 的 107 → 156），含 `lineDiff`/`editPrompt`/`slashCommand`/i18n 等纯逻辑单测。

## v0.1.0 — 2026-07-11

首个入库版本。

### 新增
- 品牌小猪图标（原图 base64 内嵌，ribbon 按钮 + 侧边栏 tab）。
- **2.1 自定义主色调**：设置页原生取色器 + 「恢复默认」，`--workbuddian-primary` 经 `document.body` 单点注入，CSS `var(--workbuddian-primary, var(--interactive-accent))` 回退。
- **3.2 斜杠命令安全透传**：`parseSlashCommand`；`/clear` 本地新建对话，其余 `/` 命令跳过 context 注入原样透传给 CLI。
- **3.3 输入 `/` 自动补全**：内置命令表（`BUILTIN_SLASH_COMMANDS`）+ `extractSlashQuery`/`filterSlashCommands`，复用 @ 补全下拉。

### 改进
- **2.2 设置页重构**：按「CodeBuddy 连接 / 上下文注入 / 外观」分组 + 底部「重置为默认」（二次点击确认），`onload` 与重置复用 `applySettingsToApi()`。
- **1.3 友好错误卡片 + 重试**：`ChatMessage.isError` + `renderErrorCard`（⚠️ 图标 + 文案 + `[重试] [打开设置]`）；`sendMessage` 解耦出 `sendText`，重试经 `deleteLastExchange` 重发最近一次出错的消息。

### 测试
- 135 项测试全绿（`parseSlashCommand`/`extractSlashQuery`/`filterSlashCommands`、`ConversationManager` 的 `setError`/`deleteLastExchange` 等纯逻辑）。

### 备注
- ROADMAP 3.4 交互式命令暂缓（评估收益低）；`.codebuddy/commands` 自定义命令扫描 YAGNI 暂缓。
