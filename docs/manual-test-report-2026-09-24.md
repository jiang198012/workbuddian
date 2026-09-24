# Workbuddian 2.6.9：demo-vault Computer Use 全量手动测试报告

## 结论

本次使用 Computer Use 在真实 Obsidian `demo-vault` 中逐项走查了产品功能入口、主要交互和可见结果。核心聊天链路、模型选择、模板、常驻指令、`/` 命令/Skills、`@` Vault 聚合、会话切换、回复复制/插入/保存、导出和设置页入口均有界面证据。

本次不签发“全量通过”：工具调用、计划卡片执行、Edit/Write 行级 diff、撤销安全矩阵、内联编辑、图片上传/缩略图和 Hermes 后端切换没有可重复的 demo fixture 或外部服务条件，因此按 `BLOCKED`/`PARTIAL` 记录；不能将“按钮可见”当成“功能已验收”。

## 测试基线与方法

| 项目 | 实际值 |
|---|---|
| 测试日期 | 2026-09-24 |
| 测试方式 | macOS Obsidian + Computer Use（AX 树、截图、真实点击/键盘输入） |
| 目标 Vault | `/Users/jiang/claude/workbuddian/demo-vault` |
| 插件版本 | `2.6.9` |
| 代码基线 | `6a5f9bf release: publish 2.6.9` |
| 发布资产 | `main.js`、`manifest.json`、`styles.css` 均已存在于 demo-vault 插件目录 |
| 备份 | `/tmp/workbuddian-demo-vault-backup-20260924-062339` |
| 清理 | 测试临时笔记、导出笔记已删除；代码工作区保持干净 |

发布包与 demo-vault 资产 SHA-256 一致：

```text
main.js     cad187a0566384784c6a8939dda81bba2c8f57dcbe236ab150fe0adbfa4d6e87
manifest    0588ec724eb7b18106c2b214268c6c3fce8a823005af2d4fa415dbf31ec35a94
styles.css  0c9a2ab3bc7ac8dc52d61c0523ccaf829faf745ea200415897a17b055f390223
```

## 全量覆盖矩阵

状态含义：`PASS` = 有真实界面/文件证据；`PARTIAL` = 入口或部分行为通过，但关键断言未完成；`BLOCKED` = 已定位到功能/入口，但缺少可重复条件或 Computer Use 操作被 AX 重绘阻断；`NOT_IMPLEMENTED` = 当前版本没有该功能；`FAIL` = 明确违反预期。本次没有把 BLOCKED 误报为 FAIL。

| 编号 | 功能覆盖 | 实际操作与证据 | 结果 | 后续意见 |
|---|---|---|---|---|
| ENV-01 | 版本、bundle、demo-vault 安装 | 读取 manifest、commit、三件发布资产并核对 demo-vault SHA | PASS | 无 |
| UI-01 | 打开聊天面板、新建对话、聊天标签 | 真实打开 Workbuddian，看到新建对话、置顶会话和多个会话标签 | PASS | 无 |
| UI-02 | 会话切换 | 从“新对话”切换到“测试-消息操作”，AX 标记 selected 且消息内容改变 | PASS | 无 |
| UI-03 | 搜索会话 | 命令/按钮入口可见，但未提交真实搜索条件 | BLOCKED | 增加带固定会话数据的 demo 搜索夹具 |
| UI-04 | 会话 fork、双面板 | 当前会话标签可见，但没有稳定的 fork/双面板 demo 操作和结果断言 | BLOCKED | 增加固定会话 fork 与双面板夹具 |
| CHAT-01 | CodeBuddy CLI 对话 | 发送“请用一句话回答：1+1等于几？”，得到“1 + 1 等于 2” | PASS | 无 |
| CHAT-02 | 流式回复、思考块、自动标题、上下文环 | AX/截图看到“已思考”、回复、标题“⼀句话回答1+1等于几”和上下文用量 | PASS | 无 |
| MODEL-01 | 动态模型列表与去重 | 打开模型菜单，看到 15 个唯一模型标签，无重复项 | PASS | 无 |
| AUTH-01 | 默认/计划/完全访问授权菜单 | 菜单同时显示三种模式；计划模式标签曾被真实选中；最终恢复默认模式 | PASS | 无 |
| AUTH-02 | 计划卡片、按此执行、模式恢复 | 未能稳定生成计划卡片并完成执行；AX 菜单重绘导致选择索引失效 | BLOCKED | 提供只读计划 demo 命令和固定文件断言 |
| TEMPLATE-01 | 模板菜单 | 打开模板菜单，看到写作助手、翻译助手、代码审查、笔记整理；选中写作助手后输入框填入模板前缀 | PASS | 无 |
| PROMPT-01 | 常驻指令编辑/保存 | 打开编辑器，读取现有中文写作指令并保存；弹窗关闭 | PASS | 未改变原指令内容 |
| CMD-01 | `/` 命令与 Skills | 看到 `/clear`、`/resume`、`/effort`、`/context`、`/obsidian`、`/translate`、`/summarize`、`/review` 等 | PASS | 无 |
| CMD-02 | `#` 常驻指令快捷入口 | 常驻指令按钮可编辑/保存；未单独提交 `#` 快捷语法 | BLOCKED | 增加 `#` 语法的固定输入断言 |
| RESUME-01 | `/resume` 恢复历史会话 | 输入 `/resume`，真实看到“/resume 恢复历史会话”建议 | PASS | 选择器打开动作未稳定完成，见 RESUME-02 |
| RESUME-02 | 选择会话、`/resume abc123` 透传 | 未提交真实恢复，避免改变已有会话状态 | BLOCKED | 增加可恢复的固定测试会话和选择器断言 |
| REF-01 | `@` Vault 聚合与 `@stats` | 输入 `@`，看到 `@stats（Vault 统计）` 和多篇 Vault 笔记；此前已添加/移除 `未命名.md` chip | PASS | 无 |
| REF-02 | `@` MCP/Agents 聚合 | 本次菜单只有 Vault 文件和 stats，未出现 MCP/Agents 来源 | PARTIAL | 检查 MCP/Agents 注册与聚合数据源，补 demo fixture |
| FILE-01 | 附件入口与文件选择器 | 点击“附加文件”打开原生文件选择器，看到 demo-vault 文件，点击取消 | PASS | 无 |
| FILE-02 | 实际上传、图片视觉、缩略图 | 未上传真实图片，也未验证模型视觉返回 | BLOCKED | 提供固定 PNG 和可离线视觉测试后再验收 |
| REPLY-01 | 复制回复 | 点击复制，AX 显示“已复制” | PASS | 无 |
| REPLY-02 | 插入回复、保存为笔记 | 已观察插入使输入框出现回复文本；保存动作生成过导出笔记并由 shell 核对，随后清理 | PASS | 无 |
| REPLY-03 | 编辑并重发、重新生成 | 两个按钮在已有会话中可见，但未提交重发/重生成以免产生额外请求 | BLOCKED | 增加离线 mock 响应后验证消息替换和重试 |
| EXPORT-01 | 导出当前会话、导出全部会话 | 通过命令面板执行两项导出；实际生成文件并由 shell 核对，随后清理 | PASS | 无 |
| TOOL-01 | 工具调用卡片、审批卡 | 当前 demo 没有可重复的工具调用 fixture | BLOCKED | 增加固定只读工具与审批结果 |
| DIFF-01 | Edit 行级 diff、展开/键盘操作 | 本轮没有产生 Edit diff 卡片 | BLOCKED | 用固定测试工具生成单行替换并断言 diff |
| DIFF-02 | Write 卡片、非文件工具无 diff | 没有可重复的 Write/非文件工具响应 | BLOCKED | 补齐 A3 场景夹具 |
| UNDO-01 | 正常撤销、文件变更拒绝、非唯一替换拒绝、Write 无撤销 | 没有进入对应工具回写链路 | BLOCKED | 必须逐项跑 B1-B4 并核对文件内容/拒绝提示 |
| INLINE-01 | 选区内联编辑、浮动 diff 弹窗 | 入口可从命令面板发现，但未完成真实选区到弹窗链路 | BLOCKED | 提供固定选区笔记和可重复指令 |
| SETTINGS-01 | 设置页基础配置 | 设置页可见中文、CodeBuddy 后端、CLI 路径、Node 路径、超时、thought | PASS | 未修改用户配置 |
| SETTINGS-02 | MCP 服务器与自定义 Agents JSON | 设置页可见添加/剪贴板导入、JSON 编辑区和自定义 Agents JSON | PASS | 未提交外部服务器配置 |
| SETTINGS-03 | Vault/current note/auto-title、图片保留、语言、主题、context window | 所有复选框、图片保留、语言、颜色、上下文窗口控件可见 | PASS | 未改变用户偏好 |
| SETTINGS-04 | 导出/导入/重置/日志/CodeBuddy plugins | 看到导出、导入、重置、日志和插件过滤列表；日志窗口可打开并显示 ACP 请求 | PASS | 未执行重置/导入 |
| BACKEND-01 | Hermes ACP/HTTP fallback | 主链路日志确认当前使用 CodeBuddy ACP；未切换 Hermes 或制造断网回退 | BLOCKED | 需要 Hermes 可用服务或离线 mock |
| SEC-01 | 外部路径/权限审批 | 授权模式菜单可见，但未提交访问 Vault 外路径的请求 | BLOCKED | 加入受控外部路径 fixture，验证默认拒绝与明确授权 |
| ACCESS-01 | 键盘焦点、Tab 顺序、Esc、chip X、diff heading | 输入与菜单键盘路径部分验证；未完成 E1-E5 全部断言 | PARTIAL | 后续用键盘专用夹具逐条验收 |
| VIEW-01 | 自动滚动、context ring、实时阅览、内联 diff、图片缩略图 | context ring/实时阅览可见；自动滚动、内联 diff、图片缩略图缺 fixture | PARTIAL | 补长回复、图片和 diff 场景 |
| INPUT-01 | 长文本撑高后自动收缩 | AX 能接收多行长文本；源码确认固定 `min=30/max=200` 的自动收缩逻辑 | PARTIAL | CUA 对 contenteditable 的视觉高度断言不稳定 |
| INPUT-02 | 可配置自动调整、最小/最大高度设置 | 检查设置页和源码，当前版本没有 `autoResize`、min/max 设置字段 | NOT_IMPLEMENTED | 建议 P1：设置项、持久化、边界校验和 UI 断言 |
| ERROR-01 | 错误显示与重试入口 | 既有会话可见“Failed to fetch”错误态及“重试/打开设置”入口 | PARTIAL | 未在本轮点击重试并核对恢复 |
| SAFE-01 | 测试隔离与清理 | 临时测试笔记、导出笔记已删除；备份目录仍存在；`git status --short` 为空 | PASS | 无 |

## 结果汇总

- `PASS`：21 项
- `PARTIAL`：5 项
- `BLOCKED`：14 项
- `NOT_IMPLEMENTED`：1 项
- `FAIL`：0 项

`PASS` 只代表该行列出的断言有证据，不代表所有下游链路都已通过。由于 BLOCKED 项包含工具、回写/撤销、计划执行、图片、Hermes、fork/双面板和外部路径审批，当前报告不能作为发布签字。

## 建议形成的 Issue

1. **P1：输入框高度设置缺失**。在设置页增加自动调整开关、最小高度、最大高度；校验最小值不大于最大值，且长文本减少时持续压缩到最小值。
2. **P1：建立离线全功能 demo fixture**。固定提供工具调用、审批、Edit、Write、非文件工具、图片和 Hermes mock，使 A/B/C/D/F 手动用例可重复。
3. **P1：计划模式验收链路**。增加“生成计划 → 展示计划卡 → 按此执行 → 恢复授权模式”的稳定入口和文件断言。
4. **P2：降低菜单重绘导致的 AX/键盘索引失效**。菜单或弹窗重绘时保留焦点语义，便于键盘和辅助技术连续操作。
5. **P2：补齐 Hermes 切换与 HTTP fallback 验收**。在 demo-vault 中加入可控服务状态和恢复断言。

## 清理与边界

本次只在 `demo-vault` 生成并随后删除测试临时笔记和导出文件；没有修改源码、设置用户配置或发布版本。备份保留在 `/tmp/workbuddian-demo-vault-backup-20260924-062339`，可用于复核或恢复测试现场。
