# 消息气泡内图片缩略图 + 粘贴图保留数量可配置

## 背景

两个已提但未落地的需求（GitHub issue #1 / #2 已被标记为 COMPLETED，但代码中并未实现）：

- **#1**：粘贴/拖拽的图片只在输入框上方显示缩略图 chip；消息发出后，用户气泡里看不到那张图。v1.2.3 只做到显示 paperclip + 文件名标签（`src/features/chat/render.ts:42-49`）。
- **#2**：`handlePaste` 里 `pruneImages(dir, 20)` 的保留数量写死为 20（`src/features/chat/input.ts:234`），无法配置。

真正的卡点在数据层：`ConversationManager.addMessage` 存进 `ChatMessage.attachments` 的是 `fileBasename(p)` 的结果（`input.ts:437`），**只有文件名没有路径**，渲染层无从定位图片文件。

## 目标

- 用户消息气泡内，图片附件以缩略图形式显示；非图片附件保持文件名 chip。
- 图片文件已被清理（或换机器路径失效）时，缩略图优雅降级为文件名 chip，不出现碎图标。
- 粘贴图保留数量成为设置项，支持「不限制」。
- 旧对话数据零迁移、不报错。

## 非目标

- 缩略图不可点击（不做放大预览、不做系统程序打开）。
- 不把图片复制进归档目录，不改变粘贴图的落盘位置。
- 不给 assistant 消息渲染附件（它没有附件）。
- 不改 prompt 注入、`--add-dir` 授权、标题生成、搜索、导出等既有行为。

## 方案

### 数据层：`attachments` 语义从「文件名」改为「绝对路径」

`src/features/chat/input.ts:437`：

```ts
// 原：const attachmentNames = view.attachments.map(fileBasename);
view.manager.addMessage(convId, 'user', text, [...view.attachments]);
```

字段名与类型（`ChatMessage.attachments?: string[]`）不变，只有语义变化。拷贝数组是因为 `view.attachments` 在发送后会被重置。

**旧数据兼容**：历史消息存的是纯文件名（无路径分隔符），渲染时通过 `isAbsolutePath()` 判定为「非路径」，走原有的文件名 chip 分支。不需要 settings/数据迁移。

**代价（已确认接受）**：绝对路径会持久化进 `data.json`，换机器后旧消息的图片路径失效 —— 由下面的 `onerror` 降级兜住。

### 新增纯逻辑：`src/shared/attachments.ts`

```ts
/** 跨平台判断是否绝对路径：POSIX /a/b、Windows C:\a\b、UNC \\host\share */
export function isAbsolutePath(p: string): boolean;
```

放在 `attachments.ts` 而非 `imageStore.ts`，因为它服务于附件条目的解释，且该文件已是零依赖的纯字符串工具集。

### 渲染层：`src/features/chat/render.ts`

`renderMessage` 中的 attachments 分支改为按条目分派：

| 条件 | 渲染 |
|---|---|
| `isAbsolutePath(e) && isImagePath(e)` | `<img class="workbuddian-image-thumb">`，`src = thumbSrc(view, e)` |
| 其余（非图片 / 旧数据的纯文件名） | 现状：paperclip 图标 + `fileBasename(e)` |

文件名 chip 的现有渲染逻辑抽成 render.ts 内的小函数（如 `renderNameChip(chip, name)`），供正常分支与降级分支复用：图片 `onerror` 时 `chip.empty()` 后调用它，保证图被清理后不出现碎图标。`isImagePath` 从 `src/shared/imageStore.ts` import（纯 `path` 判断，不触发 IO）。

`thumbSrc()`（`input.ts:133`）从模块私有改为 `export`，供 render.ts 复用。它已处理两种来源：vault 内文件走 `app.vault.adapter.getResourcePath()`，vault 外文件读盘转 data URL。render.ts 本就 import 自 input.ts（`retryLastMessage` / `openWorkbuddianSettings`），不新增依赖边。

`styles.css`：确保 `.workbuddian-image-thumb` 在 `.workbuddian-message-attachments` 容器内也有与输入框 chip 一致的尺寸约束。

### 设置项：`pastedImageKeep`

**`src/types/index.ts`**

- `WorkbuddianSettings` 新增 `pastedImageKeep: number`，`DEFAULT_SETTINGS` 为 `20`。
- `CURRENT_SETTINGS_VERSION` 9 → 10。
- `migrateSettings` 校验规则：非数字 / 非整数 / 负数 / 大于 500 → 回退 20；**0 合法，语义为「不限制」**。

**`src/shared/imageStore.ts`**

```ts
export function pruneImages(dir: string, keepN: number): void {
    if (keepN <= 0) return; // 0 = 不限制，永不清理
    ...
}
```

**`src/features/chat/input.ts:234`**

```ts
pruneImages(dir, view.settings.pastedImageKeep);
```

`view.settings` 是与插件共享的同一个对象引用（`view.ts:53`），改设置即时生效，无需刷新面板。

**`src/features/settings/tab.ts`**

在「上下文注入」组（`settings.inject`）末尾新增一项文本输入：粘贴图保留数量，描述注明「0 = 不限制」。放该组而非「外观」组，因为它属于发送给 CLI 的材料管理。

**`src/i18n/index.ts`**：新增 `settings.pastedKeep` 与 `settings.pastedKeepDesc` 的中英文案。

## 测试

沿用现有惯例：纯逻辑走 jest，`obsidian` 依赖的 view 层不测。

| 文件 | 用例 |
|---|---|
| `tests/attachments.test.ts` | `isAbsolutePath`：POSIX 绝对路径、Windows 盘符、UNC、纯文件名、相对路径、空串 |
| `tests/imageStore.test.ts` | `pruneImages(dir, 0)` 一个文件都不删（现有 tmp 目录 + `utimesSync` 模式） |
| `tests/types.test.ts` | `migrateSettings`：缺字段补 20、非法值（负数 / 小数 / 字符串 / >500）回退 20、0 保留、合法值保留、版本号为 10 |

## 风险与缓解

- **绝对路径进 `data.json`**：含本机用户名，换机器失效 → `onerror` 降级为文件名 chip；已与用户确认接受。
- **`.obsidian` 目录下 `getResourcePath` 是否可用**：输入框 chip 自 v1.1.0 起就用同一函数显示同一目录的图，已验证可用。
- **设置为 0 导致粘贴图无限堆积**：属于用户显式选择，设置项描述中说明。

## 验收标准

- [ ] `npm run build` 通过（tsc typecheck + esbuild）。
- [ ] `npm test` 全绿，含上表新增用例。
- [ ] 粘贴一张图并发送后，用户气泡内显示该图缩略图；非图片附件仍显示文件名。
- [ ] 手动删除 `pasted/` 下的图片文件后重开面板，对应气泡显示文件名 chip 而非碎图。
- [ ] 旧对话（v1.2.4 时期产生、attachments 存文件名）打开后仍正常显示文件名 chip。
- [ ] 设置页可改保留数量，填 0 后连续粘贴多张图不再清理旧图；填非法值回退 20。
