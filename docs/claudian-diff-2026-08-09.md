# Workbuddian vs Claudian 深度对比（2026-08-09）

> 对照对象：Claudian 2.1.2（2026-08-05 发布，仓库 YishenTu/claudian，插件 id realclaudian，14.6k stars / 1.7M 下载 / 8 个月 63 次更新）
> 本方：Workbuddian v2.1.0 + 8 个新功能（R7 插件管理 / R10 context-saving / 国内模型 UI / 模板 prompt / 导出增强 / @stats / 命令面板 / 会话搜索 / resume 搜索 / 删除确认）
> 前序：`docs/claudian-diff-2026-08-03.md`（对照 Claudian 2.0.44）

## 结论

**核心功能已全面反超，仅剩生态广度差距。** 经代码核实修正：Inline Edit 与可扩展斜杠命令 Workbuddian 均已实现（对比研究初稿误判）。当前 Workbuddian 在审批/撤销/安全/MCP 可视化/会话搜索/国内模型适配等**核心体验深度**全面反超 Claudian；真实差距收窄为：compact 上下文压缩、dual-pane 常驻会话管理器、MCP SSE/HTTP 传输、Linux 支持、多后端生态适配。对"中国 Obsidian 用户"目标市场，核心体验已领先。

## 逐维度对比

| 维度 | Claudian 2.1.2 | Workbuddian | 判定 |
|---|---|---|---|
| 审批/权限 | Plan Mode（Shift+Tab 探索-提交）+ provider 级审批 | 逐工具批准卡（留存可回看）+ 权限模式 + 按路径允许 + vault 外授权窗 + 三道安全闸门；计划卡批准同轮继续 | 🟢 WB 反超 |
| 图片/附件 | 附件随 provider 发送 | 粘贴/拖拽即分析 + 保留数量管理 + 附件 chips + vault 外授权窗 | 🟢 WB 反超 |
| 计划模式 | 独立探索-设计-批准两阶段流 | 计划权限模式「计划已就绪」卡同轮继续执行，交互连贯但无独立探索阶段 | 🟡 各有侧重 |
| 消息渲染 | 词级 diff + Claude task→todo 进度条 + Codex citations | 词级 diff + 行级 diff + 一键撤销 + Bash 全文块 + 代码块复制 + 错误卡时间戳 | 🟡 各有侧重 |
| MCP | stdio/SSE/HTTP 三传输 + @mention | stdio + 可视化管理 UI + @mcp 引用 + context-saving（@激活才注入） | 🟡 各有侧重 |
| 会话管理 | 多标签 + dual-pane 常驻管理器 + fork/resume/compact | 标签分叉 + 双面板隔离 + 定向 cancel + 自动标题 + 会话搜索 + 自动重启自愈 | 🟡 相当 |
| @ 引用 | 单类型单次提及 | 四源聚合一次带上（Agent/MCP/笔记/文件）+ @stats | 🟡 相当 |
| 指令模式 | # Instruction Mode | # 常驻指令/人设 | 🟡 相当 |
| 后端支持 | 五后端（Claude/Codex/Grok/OpenCode/Pi）+ 兼容 API | 单一 CodeBuddy CLI（原生支持 DeepSeek/GLM/Kimi/MiniMax） | 🔴 WB 落后 |
| Inline Edit | 内置（选中+热键原位改笔记，词级 diff） | 已实现（features/inline-edit + DiffModal 词级高亮，选中+指令 Modal+调 CLI+diff 预览+接受/拒绝） | 🟡 相当 |
| Skills/斜杠 | / 可复用 prompt 模板 + $ Skills（user+vault 两级） | / 模板（6 个）+ 自定义命令（扫描 vault .codebuddy/commands/**/*.md，frontmatter 描述/参数提示） | 🟡 相当 |
| 平台 | macOS/Linux/Windows 三平台 | 仅 Windows/macOS，Linux 不支持 | 🔴 WB 落后 |
| 多语言 | 10 locales | 中/英 2 种（中国用户为主，符合定位） | 🔴 落后（符合定位） |
| 独有特性 | compact 压缩、dual-pane、Skills、多后端 ACP | 一键撤销+安全闸门、会话搜索、设置导入导出、自动重启自愈、子代理 JSON、插件管理 UI、国内模型中文名、[WB] 日志 + e2e | 🟡 各有侧重 |

## Workbuddian 反超点（8/03 至今）

- 8/03 的 5 个反超点全部仍在：同轮真计划批准 / 真词级 diff / Bash 全文终端块 / 双面板定向 cancel / 批准卡历史留存
- 8/03 的 6 个真实差距 5 个已补齐：@mention 四源聚合 ✅、MCP 管理 UI ✅、渲染节流 ✅、DiffModal 词级 ✅、自动标题 ✅、插件管理 ✅（仅 i18n 扩展按产品定位定为最低优先级）
- 新增领先：context-saving MCP、会话搜索体系、国内模型中文名/排序、删除确认、自动重启自愈、e2e 测试基建

## Workbuddian 落后点（按优先级，已核实）

> 注：原稿的 "Inline Edit 未实现"、"无可扩展斜杠命令" 经代码核实为**误判**（两者均已实现），已修正。

1. **无 compact 上下文压缩**——已补（用量预警条 + /compact 一键触发，commit `048b281`）
2. **无双栏常驻会话管理器**——已补（主面板左侧会话列表，commit `7f4cacb`）
3. **MCP 仅 stdio 传输（不支持 SSE/HTTP）**——**不可做**：探针证实 ACP 不接受 http/sse 形态（mcpModal.ts 注释 + spec R5）。CLI 虽新增 `--mcp-config`/`--acp-transport streamable-http` 参数，但未登录无法验证完整握手，且中国用户本地 stdio MCP 为主，SSE/HTTP 需求低。等待 CLI 明确支持后再评估。
4. **Linux 不支持**——依赖 CodeBuddy CLI 的 Linux 支持，超出插件范围。
5. **后端生态**——依赖 CodeBuddy 支持更多 CLI，超出插件范围。

**结论：Claudian 对比差距项已基本触底。** 可做的（compact/dual-pane/会话搜索/MCP管理UI/context-saving）全部完成；剩余差距（SSE-HTTP/Linux/多后端）均依赖外部 CLI 能力或超出插件范围，暂不可行。转向不依赖外部的新方向继续提升产品。

## 生态定位差异

- Claudian：面向国际 Claude Code/多 CLI 生态，MIT，BEIKE/MOMA 赞助，oh-my-claudian 分叉生态
- Workbuddian：面向国内 CodeBuddy/WorkBuddy 生态，v2.0.1 起代码独立（与上游相似度 <30%），UI 仅参考 Claudian 设计模式
