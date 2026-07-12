# 2.1 自定义主色调 — 设计文档

- 日期：2026-07-10
- 阶段：ROADMAP 第二阶段 2.1
- 状态：已确认设计，待实现

## 目标

让用户在设置页选择一个主色调，聊天面板中所有「强调色」元素跟随该色；留空或点击「恢复默认」时回退到 Obsidian 主题的 `--interactive-accent`。

## 背景与现状

`styles.css` 当前有 **10 处**硬编码 `var(--interactive-accent)`，语义均为强调色：用户气泡背景、Assistant 消息左边框、发送按钮、搜索/新建按钮、输入框 focus 边框与 box-shadow、思考/工具卡片强调边框等。用户无法自定义，只能跟随 Obsidian 主题。

## 非目标（Non-goals）

- 不做预设色板 / 一键品牌色切换（YAGNI，后续可加）。
- 不做命令面板入口（本轮仅设置页取色器）。
- 不改功能性小图标（+/搜索/扳手等 lucide 图标）的颜色。
- 不引入完整主题/多变量外观系统（那是 2.2 的范畴）。

## 设计

### ① 数据模型（`src/types/index.ts`）

- `WorkbuddianSettings` 新增字段 `primaryColor: string`。
  - 语义：CSS 颜色字符串（如 `#a855f7`）；空串 `''` 表示「跟随主题」。
  - 默认值 `''`。
- `CURRENT_SETTINGS_VERSION`：`4` → `5`。
- `migrateSettings`：读取 `primaryColor`（类型非 string 或缺失 → `''`），并写入新 version。旧数据（v4，无该字段）平滑升级为 `primaryColor: ''`，行为与升级前完全一致。

### ② CSS 变量与原生回退（`styles.css`）

- 将 10 处 `var(--interactive-accent)` 统一改为：
  `var(--workbuddian-primary, var(--interactive-accent))`
- 未设置 `--workbuddian-primary` 时，靠 CSS 原生 fallback 自动使用 `--interactive-accent`。
- **零副作用不变量**：只要不写入 `--workbuddian-primary`，渲染结果与改动前逐像素一致。

### ③ 注入方式（选定方案 A：body 单点）

在 `document.body` 上写入 CSS 变量：

- 新增函数 `applyPrimaryColor(color: string)`：
  - `color` 非空 → `document.body.style.setProperty('--workbuddian-primary', color)`
  - `color` 为空 → `document.body.style.removeProperty('--workbuddian-primary')`（回退主题色）
- 调用时机（`src/main.ts`）：
  - `onload`：应用已保存的 `settings.primaryColor`。
  - `saveSettings`：颜色变更保存后重新应用。
  - `onunload`：`removeProperty` 清理，避免残留污染。
- 选 A 的理由：`body` 是侧边栏 view 与主编辑区 view 的共同祖先，单点写入即覆盖两个面板；变量名带 `--workbuddian-` 私有前缀且仅本插件 CSS 引用，污染风险可忽略。备选 B（每 view 容器各设）需处理多 view + 容器重建 + 变更刷新，代码更多；C（动态 `<style>`）最重，均不采用。

### ④ 设置页 UI（`src/features/settings/tab.ts`）

新增一个 Setting「聊天主色调」：

- `addColorPicker`：`onChange(value)` → 写 `settings.primaryColor = value` → `saveSettings()` → `applyPrimaryColor(value)`（即时生效，无需重启）。
- 取色器初始显示：`primaryColor` 非空时显示该值；为空时显示当前主题 `--interactive-accent` 的计算值（`getComputedStyle(document.body).getPropertyValue('--interactive-accent')`），作为「当前实际色」的直观呈现。
- `addExtraButton`（图标 `rotate-ccw`，提示「恢复默认」）：`primaryColor = ''` → 保存 → `applyPrimaryColor('')` → 刷新设置页使取色器显示回主题色。

说明：Obsidian `ColorComponent` 需要有效 hex，无法表达「空」；「空=跟随主题」的语义由「恢复默认」按钮承担。

## 测试

- `tests/types.test.ts` 新增 `primaryColor` 迁移用例：
  - 缺失字段 → 默认 `''`，version 升为 5。
  - 已存合法值（如 `#123456`）→ 保留。
  - 非 string（如数字/对象）→ 回退 `''`。
- 注入逻辑 `applyPrimaryColor` 为薄 DOM 包装，不强制单测（无 `obsidian` 依赖但依赖 `document`，与现有测试边界一致地不覆盖 DOM 层）。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/types/index.ts` | 加 `primaryColor` 字段、默认值、version 4→5、迁移逻辑 |
| `styles.css` | 10 处 accent → `var(--workbuddian-primary, var(--interactive-accent))` |
| `src/main.ts` | `applyPrimaryColor` + onload/saveSettings/onunload 三处接线 |
| `src/features/settings/tab.ts` | 「聊天主色调」取色器 + 恢复默认按钮 |
| `tests/types.test.ts` | `primaryColor` 迁移用例 |

## 验收标准

1. 设置页出现「聊天主色调」取色器与「恢复默认」按钮。
2. 选色后，聊天面板用户气泡 / 发送按钮 / Assistant 左边框 / 输入框 focus ring 等即时变色，**无需重启**。
3. 点「恢复默认」后回退到 Obsidian 主题 accent。
4. 侧边栏面板与主编辑区面板**均生效**。
5. 重启 Obsidian 后所选颜色保持。
6. `npm test` 全绿（含新增迁移用例），`npm run build` 通过；旧设置数据（v4）平滑迁移不报错。

## 风险与缓解

- **body 变量污染**：变量名私有前缀 + 仅本插件 CSS 引用 + `onunload` 清理 → 风险可忽略。
- **旧数据迁移**：`migrateSettings` 对缺失/非法值回退 `''`，保证向后兼容。
- **取色器无法表达空**：由「恢复默认」按钮承担清空语义。
