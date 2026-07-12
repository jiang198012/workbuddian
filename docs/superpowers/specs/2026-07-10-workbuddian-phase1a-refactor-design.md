# workbuddian 阶段1·步骤 1a（全面重构 + 改名 + 迁移）— 设计文档

## 背景与范围

这是 workbuddian（原 AI-Buddy，fork 自 BuddyBridge）对标 Claudian roadmap 的**阶段 1 第一步**。roadmap（`docs/superpowers/specs/2026-07-10-ai-buddy-claudian-roadmap.md`）定的阶段 1 = 全面重构成 Claudian 式分层架构 + 改名 workbuddian + 双向流/审批地基，用户选择**两步走**：

- **步骤 1a（本 spec）**：纯重构 + 改名 + 迁移现有功能。**行为完全不变**，只换架构和名字，跑通现有全部功能验证无回归。
- **步骤 1b（后续单独 brainstorming）**：在干净的新架构上加双向流 stream-json 运行时 + 工具审批 UI。等 1a 落地后再设计——那时在真实新架构上设计审批 UI 更有实感。

**1a 的核心原则**：结构变化与命名变化，零行为变化。任何"顺便改行为"的冲动都推到 1b 或后续阶段。唯一允许的结构性改进是把 `chat.ts` 里与 UI 纠缠的上下文拼装逻辑抽成独立模块（`core/context`），因为它是干净迁移的自然产物、且有纯逻辑测试兜底。

## 关键决策（本轮 brainstorming 用户拍板）

1. **两步走**：先 1a 纯迁移（验证无回归），再 1b 加地基。
2. **完整 Claudian 分层**：目录骨架照 claudian 完整分层建（不精简），因 roadmap 后续阶段会填满这些层（inline-edit 阶段3、i18n 阶段5、security 阶段1·1b、context 阶段2）。但**阶段1 不强行填满**——未到的阶段留空目录占位。
3. **展示名 Workbuddian**：manifest id 小写 `workbuddian`，展示 name `Workbuddian`（首字母大写，弱化对 WorkBuddy 商标的视觉蹭靠）。
4. **无回归策略**：纯逻辑靠搬 Jest 测试兜底；UI 靠逐块手动验证 + 最后完整回归清单。

## 目标目录结构

完整 Claudian 式分层。标注：无标注 = 1a 迁移填充；`[1b]` = 阶段1 第二步填；`[阶段N]` = 留到对应阶段。

```
src/
├─ main.ts              入口瘦身（注册 view/command/settings/ribbon）
├─ core/
│  ├─ runtime/          [1b] 双向流 stream-json 运行时（占位）
│  ├─ providers/        provider 注册表（单 provider，轻量壳）
│  ├─ session/          ← chat/manager.ts（ConversationManager）
│  ├─ context/          ← 从 chat.ts 抽出的上下文拼装（vault/当前笔记/@注入）
│  └─ security/         [1b] 审批/权限（占位）
├─ providers/
│  └─ codebuddy/        ← api.ts（1a 保持"一发一收"，1b 改双向流）
├─ features/
│  ├─ chat/             ← views/chat.ts 拆 view/render/tabs/input（审批卡 [1b] 加）
│  ├─ inline-edit/      [阶段3] 空目录占位
│  └─ settings/         ← settings/tab.ts + types.ts 的设置部分
├─ shared/              ← chat/atReferences.ts + chat/export.ts + markdown 辅助
├─ i18n/                [阶段5] 空目录占位
├─ types/               ← types.ts 的非设置类型
├─ utils/               ← 从 api.ts 抽的路径/字符串杂项
└─ style/              ← styles.css（1a 先整体搬，拆模块可选）
```

空目录占位用一个 `.gitkeep` 或一行 `index.ts` 注释说明"预留给阶段N"，避免空目录不被 git 跟踪。

## 命名映射

规则：所有 `BuddyBridge*` 标识符 → `Workbuddian*`；CSS class 前缀 `buddybridge-*` → `workbuddian-*`（保持全称风格；通用 `markdown-*` 不动）。主要项：

| 现在 | 改为 |
|---|---|
| manifest id `ai-buddy` | `workbuddian` |
| manifest name `AI-Buddy` | `Workbuddian` |
| `BuddyBridgePlugin` | `WorkbuddianPlugin` |
| `BuddyBridgeAPI` | `CodebuddyProvider`（归入 `providers/codebuddy/`） |
| `BuddyBridgeChatView` | `WorkbuddianChatView` |
| `BuddyBridgeSettingTab` | `WorkbuddianSettingTab` |
| `BuddyBridgeSettings` | `WorkbuddianSettings` |
| CSS `buddybridge-*`（111 处；通用 `markdown-*` 不改） | `workbuddian-*` |
| `manifest.description` | 重写为 workbuddian 的功能描述 |
| `manifest.author` / `authorUrl` | 改为作者本人；**保留对 `ben4202121/buddybridge` 的 MIT 致谢与来源标注**（放 README/LICENSE） |

`ConversationManager`、`VIEW_TYPE_CHAT` 等不带 `BuddyBridge` 前缀的标识符保持不变（仅随文件移动调整 import 路径）。

## 现有代码盘点（迁移源，共 src 1756 行 / test 1024 行）

| 现有文件 | 行数 | 职责 | 有测试 | 去向 |
|---|---|---|---|---|
| `chat/manager.ts` | 168 | 会话管理 | ✅ manager.test | `core/session/` |
| `chat/atReferences.ts` | 23 | @解析（纯函数） | ✅ atReferences.test | `shared/` |
| `chat/export.ts` | 16 | 导出 markdown（纯函数） | ✅ export.test | `shared/` |
| `types.ts` | 132 | 类型 + 设置迁移 | ✅ types.test | 设置部分→`features/settings/`，其余→`types/` |
| `api.ts` | 493 | CLI spawn / 路径解析 | ✅ api.test | `providers/codebuddy/`（路径杂项→`utils/`） |
| `views/chat.ts` | 681 | 聊天视图（UI） | ❌ | `features/chat/` 拆 view/render/tabs/input；上下文拼装→`core/context/` |
| `settings/tab.ts` | 102 | 设置面板 UI | ❌ | `features/settings/` |
| `main.ts` | 141 | 插件入口 | ❌ | `main.ts` 瘦身 |

## 迁移顺序（每步独立可验证）

1. **建目录骨架 + 构建配置**：创建完整分层目录（空层放占位），调整 `tsconfig`/`esbuild` 的入口与路径。build 通过（此时源码还在旧位置，仅骨架就绪）。
2. **迁移纯逻辑 + 测试**（有 Jest 兜底，逐层跑测试确认绿）：
   - `chat/manager.ts` → `core/session/`（连 manager.test）
   - `chat/atReferences.ts`、`chat/export.ts` → `shared/`（连各自 test）
   - `types.ts` 拆：设置部分 → `features/settings/`，其余类型 → `types/`（连 types.test）
   - `api.ts` → `providers/codebuddy/`（路径杂项抽 `utils/`），**保持一发一收行为不变**（连 api.test）
   - 每迁一层跑 `npm test` 确认对应测试全绿。
3. **抽 `core/context/`**：把 `chat.ts` `sendMessage` 里的上下文拼装（vault 路径/当前笔记链接/@引用注入，含 `injectVaultContext`/`injectCurrentNoteLink` 开关逻辑）抽成纯函数模块，**补纯逻辑单测**（此前无测试，是重构顺带补的净改进）。
4. **拆 `features/chat/`**（最大、最易回归的一步，无自动化测试）：`views/chat.ts` 681 行按职责拆 `view`（外壳/生命周期）、`render`（消息/思考块/工具卡/markdown）、`tabs`（多标签/搜索/改名）、`input`（输入框/@引用/发送/停止）。**每拆一块：build + 在真实 vault 手动验证该块对应功能没坏**（尤其 rename 的事件边界、@引用的光标处理——这些磨过多轮）。
5. **迁移 `features/settings/` + `main.ts` 瘦身**：设置面板搬到新位；main 只保留注册 view/command/ribbon/settings 的接线。build + 手动验证设置面板 6 项。
6. **全局改名**：`BuddyBridge*`→`Workbuddian*`、CSS `→wb-`、manifest（id/name/description/author）、vault 插件目录 `ai-buddy`→`workbuddian`（改目录后 Obsidian 视作新插件，需重新 enable，并把旧数据迁移或接受重置——实现时确认数据文件位置）。
7. **全量验证**：`npm test` 全绿（纯逻辑无回归）+ `npm run build` 无错 + **完整手动回归清单**（下节）逐项过。

## 无回归策略

- **纯逻辑**（session/shared/types/context/codebuddy-provider）：Jest 测试随代码搬迁，每步跑绿即证明无回归。这是 1a 大部分改动的安全网。
- **UI**（chat/settings/main）：无自动化测试（DOM/Obsidian 运行时），靠"每拆一块即时手动验证" + 第 7 步的完整回归清单。
- **行为基线**：1a 前后，除了名字和文件位置，用户可观察行为必须**逐项一致**。

## 手动回归清单（1a 完成后逐项验证）

在真实 vault 里过一遍所有现有功能，确认无回归：

- [ ] 侧边栏聊天面板：ribbon 图标 / "打开聊天面板"命令均能打开，且加入右侧标签组（`getRightLeaf(false)`，不新开 split）。
- [ ] 主编辑区大面板："在主编辑区打开大面板"命令，全宽 tab 打开。
- [ ] 多轮对话 + 流式输出实时显示。
- [ ] 思考块 / 工具调用卡片可折叠。
- [ ] assistant 消息 Markdown 渲染（代码/表格/列表/引用）。
- [ ] 多标签会话：+ 新建、切换、每标签独立 activeConvId。
- [ ] 会话持久化：重启 Obsidian 后历史恢复。
- [ ] 对话改名：双击标题改名，Escape 取消/Enter 提交/blur 边界/点击不误触（磨过 5 轮的边界全过）。
- [ ] 导出：右键导出到笔记 / 复制到剪贴板，含错误处理。
- [ ] 全文搜索：标题 + 消息内容。
- [ ] @笔记引用：@ 触发建议、插入、光标处理（磨过 3 轮）、buildReferenceBlock。
- [ ] 真实停止生成：停止按钮中断，activeProc 正确清理。
- [ ] 设置面板 6 项：codebuddy 路径 / CLI 超时 / Node 路径 / 模型下拉（10 项）/ Vault 注入开关 / 当前笔记链接开关，均可改且持久化。
- [ ] 上下文注入：injectVaultContext 开/关、injectCurrentNoteLink 开/关行为差异可观察。
- [ ] Mac 路径自动发现：codebuddy（WorkBuddy.app）/ node（Homebrew）自动探测。
- [ ] 模型 `--model` 参数正确传递。

## 验收标准

1a 完成 = 以下全部满足：
1. 目录结构为完整 Claudian 分层，现有代码按映射表各就各位，未到阶段的层留占位。
2. 所有 `BuddyBridge*` → `Workbuddian*`，manifest id=`workbuddian`/name=`Workbuddian`，无残留旧名（grep 确认）。
3. `npm test` 全绿（迁移后的纯逻辑测试全部通过）。
4. `npm run build` 无错，产物装入真实 vault（`.obsidian/plugins/workbuddian/`）。
5. 手动回归清单逐项通过——**零行为回归**。
6. README/LICENSE 保留 buddybridge MIT 致谢与来源标注。

## 明确不做（1a 范围外）

- **双向流 stream-json 运行时、工具审批 UI、权限模式** → 步骤 1b。
- **Inline Edit** → 阶段 3；**MCP** → 阶段 4；**fork/resume/Skills/#/i18n** → 阶段 5。
- 任何现有功能的**行为改动/增强**（1a 只搬不改）。
- `core/runtime`、`core/security`、`features/inline-edit`、`i18n` 的实质内容（仅建占位目录）。

## 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `chat.ts` 拆分引 UI 回归（rename/@引用等磨过多轮的事件坑） | 中高 | 逐块拆、每块即时手动验证；保留原逻辑不"顺手优化"；完整回归清单兜底 |
| vault 插件目录改名导致数据/启用状态丢失 | 中 | 改名前确认数据文件位置，迁移或明确告知需重新 enable |
| 抽 `core/context` 时不慎改了注入行为 | 中 | 抽成纯函数 + 补单测锁定当前拼装输出，比对 1a 前后一致 |
| 改名遗漏残留 `BuddyBridge`/`bb-` | 低 | 第 7 步 grep 全库确认零残留 |
