# 图片粘贴 / 拖拽 + 视觉 — 设计文档

日期：2026-07-13
状态：已确认，待写实现计划

## 目标

让用户能把图片**粘贴（Cmd+V 截图）**或**拖拽**进聊天输入框，交给 WorkBuddy/CodeBuddy CLI 做视觉分析。已确认前提：**CLI 支持读图（视觉）**。

## 非目标（YAGNI）

- 不做消息气泡内联大图预览
- 不做图片裁剪 / 编辑
- 不做本地 OCR
- 不改变发送链路的既有语义

## 核心决策（brainstorm 结论）

1. **走现有「路径 → CLI 读文件」链路**，不另造 base64 塞 prompt 的通道（CLI 本就按路径读文件、且能看图，base64 多余且撑大上下文）。
2. **输入方式**：粘贴 + 拖拽都做。
3. **粘贴图存储**：写入 vault 内隐藏目录 `<vault>/.obsidian/plugins/workbuddian/pasted/`——在 vault 内、CLI 直接可读（免 `--add-dir`）、Obsidian 文件树不显示、随对话持久；配轻量清理（保留最近 N=20）。
4. **UI**：输入框上方用**缩略图 chip**（图片）+ 现有文字 chip（非图片）。

## 架构与分层

遵循仓库约定：纯逻辑放 `src/shared/`（可单测、不 import `obsidian`）；DOM 事件在 `features/chat/` 视图层（不写测试）。

### 新增 `src/shared/imageStore.ts`（纯 Node `fs`/`path`，可单测）

- `extForMime(mime: string): string` —— `image/png → ".png"`、`image/jpeg → ".jpg"`、`image/gif → ".gif"`、`image/webp → ".webp"`；未知回退 `.png`。
- `pastedImageName(seq: number | string): string` —— 返回 `paste-<seq>.png` 形态的**基名**。`seq` 由调用方传入（视图层用时间戳/计数器保证唯一），本函数纯格式化、便于测试（不调用 `Date.now`）。
- `writeImageFile(dir: string, bytes: Uint8Array, ext: string): string` —— 确保 `dir` 存在、写文件、返回绝对路径。
- `pruneImages(dir: string, keepN: number): void` —— 按 mtime 保留最近 `keepN` 个，删除更旧的（只作用于该目录内我们自己写的文件）。
- `isImagePath(p: string): boolean` —— 按扩展名（png/jpg/jpeg/gif/webp/bmp/svg）判断是否图片，决定缩略图还是文字 chip。

### `src/shared/attachments.ts`（复用，基本不变）

- 继续用 `buildAttachmentBlock(paths)` 拼注入区块、`attachmentDirs(paths)` 算 vault 外目录供 `--add-dir`。
- 可选微调：当 `paths` 含图片时，块内措辞补一句「（含图片，请查看图片内容）」，帮 CLI 走视觉。

## 数据流

### 粘贴（paste）

1. 输入框 `paste` 事件读 `clipboardData.items`，筛出 `type` 以 `image/` 开头者。
2. 取 blob → `arrayBuffer` → `Uint8Array`。
3. `dir = <vaultPath>/<app.vault.configDir>/plugins/workbuddian/pasted`；`ext = extForMime(item.type)`；`name = pastedImageName(seq)`（seq = 时间戳/计数器）。
4. `writeImageFile(dir, bytes, ext)` → 绝对路径 → push 进 `view.attachments`（沿用去重）。
5. `pruneImages(dir, 20)`。
6. `renderAttachmentChips(view)` 渲染缩略图 chip。
7. **纯文本粘贴不拦截**（无 image item 时走默认行为）。

### 拖拽（drag & drop）

1. 输入区 `dragover`：`preventDefault` + 加 drop 高亮类。
2. `dragleave`/`drop`：移除高亮。
3. `drop`：读 `dataTransfer.files`——文件自带 `.path`（Electron），图片文件路径直接入 `view.attachments`；非图片文件也入（复用现有逻辑，显示文字 chip，属顺带白送）。
4. `renderAttachmentChips`。

### 缩略图 chip（扩展 `renderAttachmentChips`）

- `isImagePath(path)` 为真：chip 内放 `<img>` + ✕。
  - **图片源**：vault 内文件用 `app.vault.adapter.getResourcePath(vaultRelativePath)`（Obsidian 允许的 `app://` 资源）；vault 外文件 `fs.readFileSync` → base64 data URL。
  - CSS 限尺寸（约 40×40，`object-fit: cover`），避免大图撑爆。
- 否则维持现有文字 chip（文件名 + ✕）。

### 发送（不变）

- `buildAttachmentBlock(view.attachments)` 拼路径区块；`attachmentDirs(view.attachments)` 对 vault 外路径生成 `--add-dir`（vault 内的粘贴图不需要）。
- CLI 读图 → 视觉分析。发送后清空 `view.attachments` 与 chips（沿用现有）。

## 错误处理 / 边界

- 写盘失败 → `Notice` 报错、不崩，跳过该图。
- 一次粘贴/拖拽多张 → 逐个处理。
- 纯文本粘贴 → 不拦截、走默认。
- 缩略图大图 → CSS 限尺寸。
- 去重 → 沿用现有「按绝对路径」。

## 测试

- 新增 `tests/imageStore.test.ts`，覆盖：`extForMime`、`pastedImageName`、`writeImageFile`（写临时目录再读回校验字节）、`pruneImages`（造 N+ 个文件验证只保留最近 N、删对了最旧的）、`isImagePath`。
- 视图层（paste/drop/缩略图渲染）不写测试，与现有 `features/chat/*` 一致。

## i18n

- 新增用户可见文案（如 drop 提示、缩略图 aria-label、写盘失败提示）走 `STRINGS` + `t()`；prompt/日志/注释保持中文。

## 涉及文件

- 新增：`src/shared/imageStore.ts`、`tests/imageStore.test.ts`
- 修改：`src/features/chat/input.ts`（paste/drop 处理、`renderAttachmentChips` 扩展缩略图）、`src/features/chat/view.ts`（在输入区注册 paste/drop 事件）、`styles.css`（缩略图 chip + drop 高亮）、`src/i18n/index.ts`（新文案）、可选 `src/shared/attachments.ts`（含图片时措辞）
