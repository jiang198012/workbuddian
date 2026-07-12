# 2.2 设置页重构 — 设计文档

- 日期：2026-07-11
- 阶段：ROADMAP 第二阶段 2.2
- 状态：已确认设计，待实现

## 目标

把设置页现有 7 项按职责分三组（加小标题），并新增「重置为默认」按钮（二次点击确认）。

## 背景与现状

`src/features/settings/tab.ts` 的 `display()` 目前是 7 项平铺，仅一个 `Configuration` 标题：CodeBuddy 路径、CLI 超时、Node.js 路径、模型、注入 Vault 上下文、注入当前笔记链接、聊天主色调。项多了以后缺少视觉分区，也没有一键恢复默认的入口。

## 非目标（Non-goals）

- 不做设置的导入/导出（本插件的 `codebuddyPath`/`nodePath` 是本机绝对路径，跨机器不可迁移，投入产出比低，YAGNI）。
- 不新增设置字段、不改数据模型、不涉及版本迁移。
- 不引入快捷键设置分组（当前无快捷键类设置）。

## 设计

### ① 分组（重排 `display()`）

移除原单一 `Configuration` 标题，改为三个分组标题（`new Setting(containerEl).setName('组名').setHeading()`），把 7 项归入：

- **CodeBuddy 连接**：CodeBuddy 路径、Node.js 路径、CLI 超时时长、模型
- **上下文注入**：注入 Vault 上下文、注入当前笔记链接
- **外观**：聊天主色调

各设置项自身的构造代码不变，仅调整顺序与分组标题。

### ② 重置为默认

- 位置：设置页**最底部**（避免误点）。
- 一个 `new Setting(containerEl).setName('重置设置').addButton(...)`，按钮 warning 样式。
- 二次点击确认（无需新建 Modal 类）：
  - 首次点击：`setButtonText('确认重置？')` + `setWarning()`，并启动一个 3000ms 定时器，超时未再点则 `this.display()` 复位。
  - 计时内再次点击：执行重置。
- 重置行为：
  1. `this.plugin.settings = { ...DEFAULT_SETTINGS }`
  2. `this.plugin.applySettingsToApi()`（把路径/超时/node/模型灌回 provider —— 见 ③）
  3. `await this.plugin.saveSettings()`（内部已做 `setCodebuddyPath` + `applyPrimaryColor(this.settings.primaryColor)`，此时 primaryColor 为空 → 主色回退主题）
  4. `this.display()`（刷新 UI，按钮文案随之复位）
- `tab.ts` 需新增 `import { DEFAULT_SETTINGS } from '../../types'`。

### ③ 顺带重构：抽取 `applySettingsToApi()`

`main.ts` 的 `onload` 里现有 4 行 provider 接线：

```ts
this.api.setCodebuddyPath(this.settings.codebuddyPath);
this.api.setTimeout(this.settings.cliTimeoutMinutes * 60_000);
this.api.setNodePath(this.settings.nodePath);
this.api.setModel(this.settings.model);
```

抽成 `WorkbuddianPlugin` 的一个方法 `applySettingsToApi()`，`onload` 与「重置」都调用它，消除重复（重置若不重灌 provider，恢复默认后 provider 仍持旧路径/模型）。

## 测试

- 设置页与 plugin 生命周期均依赖 `obsidian`，jest 无 `moduleNameMapper` 覆盖不到，不新增单测。
- 验证：`npm run build`（tsc 类型检查 + 打包）+ 现有 113 测试不回归 + Obsidian 内人工验收。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/main.ts` | 抽取 `applySettingsToApi()`，`onload` 改为调用它 |
| `src/features/settings/tab.ts` | 三组标题重排 7 项、底部「重置为默认」按钮（二次点击确认）、import `DEFAULT_SETTINGS` |

## 验收标准

1. 设置页显示三个分组标题（CodeBuddy 连接 / 上下文注入 / 外观），7 项各归其位。
2. 底部有「重置为默认」按钮；点一次变「确认重置？」，3 秒内不再点则复位；计时内再点执行重置。
3. 重置后：路径清空、CLI 超时回 5、Node 路径清空、模型回 auto、两个注入开关回默认、主色回退主题色。
4. 重置后各设置**立即生效**（如发消息使用默认 model/path；主色即时回退），无需重启。
5. `npm run build` 通过；`npx jest` 全量 113 绿（无回归）。

## 风险与缓解

- **重置不重灌 provider** → 恢复默认后仍用旧路径/模型：由 `applySettingsToApi()`（步骤 ②.2）解决。
- **误点重置**：二次点击确认 + 3 秒复位窗口。
- **抽取方法改动 onload**：`applySettingsToApi()` 逻辑与原 4 行逐字等价，仅位置变化，行为不变。
