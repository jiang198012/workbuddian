# 图片粘贴 / 拖拽 + 视觉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能把图片粘贴（Cmd+V 截图）或拖拽进聊天输入框，交给 CodeBuddy CLI 做视觉分析。

**Architecture:** 复用现有「文件绝对路径 → `buildAttachmentBlock` 注入 → CLI 读文件」链路。粘贴的截图先落盘到 vault 内隐藏目录拿到路径；纯逻辑（落盘/命名/清理/判类型）放 `src/shared/imageStore.ts` 单测，DOM 事件（paste/drop/缩略图）在 `features/chat/` 视图层接线。

**Tech Stack:** TypeScript、Obsidian API、Node `fs`/`path`、esbuild、Jest + ts-jest。

## Global Constraints

- 纯逻辑放 `src/shared/`（不 import `obsidian`）→ 必须单测；视图层 `features/chat/*` 不写测试。
- 新增用户可见文案走 `src/i18n/index.ts` 的 `STRINGS` + `t()`；prompt / 日志 / 注释保持中文。
- 粘贴图存储目录：`<vaultPath>/<app.vault.configDir>/plugins/workbuddian/pasted/`；保留最近 `20` 个。
- 不引入新运行时依赖。构建门槛：`npm run build`（`tsc -noEmit -skipLibCheck` 通过 + esbuild 产出 `main.js`）。
- 测试命令：全量 `npm test`；单文件 `npx jest tests/<file>`。
- 提交作者为 `jiang198012`，**提交消息不加 `Co-Authored-By` 尾注**。
- 不做：消息气泡内联大图、图片裁剪/编辑、OCR。

---

### Task 1: `imageStore` 纯逻辑模块（TDD）

**Files:**
- Create: `src/shared/imageStore.ts`
- Test: `tests/imageStore.test.ts`

**Interfaces:**
- Consumes: 仅 Node `fs`/`path`。
- Produces（Task 2 依赖这些确切签名）：
  - `extForMime(mime: string): string`
  - `pastedImageName(seq: number | string, ext?: string): string`
  - `isImagePath(p: string): boolean`
  - `writeImageFile(dir: string, bytes: Uint8Array, name: string): string`
  - `pruneImages(dir: string, keepN: number): void`

- [ ] **Step 1: 写失败测试**

创建 `tests/imageStore.test.ts`：

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extForMime, pastedImageName, isImagePath, writeImageFile, pruneImages } from '../src/shared/imageStore';

describe('imageStore', () => {
    it('extForMime maps known mimes and falls back to .png', () => {
        expect(extForMime('image/png')).toBe('.png');
        expect(extForMime('image/jpeg')).toBe('.jpg');
        expect(extForMime('image/webp')).toBe('.webp');
        expect(extForMime('image/gif')).toBe('.gif');
        expect(extForMime('IMAGE/PNG')).toBe('.png');
        expect(extForMime('application/octet-stream')).toBe('.png');
    });

    it('pastedImageName formats basename with seq and ext', () => {
        expect(pastedImageName(5, '.png')).toBe('paste-5.png');
        expect(pastedImageName('a1', '.jpg')).toBe('paste-a1.jpg');
        expect(pastedImageName(1)).toBe('paste-1.png');
    });

    it('isImagePath detects image extensions case-insensitively', () => {
        expect(isImagePath('/a/b.png')).toBe(true);
        expect(isImagePath('/a/b.JPG')).toBe(true);
        expect(isImagePath('/a/b.webp')).toBe(true);
        expect(isImagePath('/a/b.txt')).toBe(false);
        expect(isImagePath('/a/b')).toBe(false);
    });

    it('writeImageFile creates dir and writes bytes, returns path', () => {
        const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'imgstore-')), 'nested');
        const p = writeImageFile(dir, new Uint8Array([1, 2, 3, 4]), 'x.png');
        expect(p).toBe(path.join(dir, 'x.png'));
        expect(Array.from(fs.readFileSync(p))).toEqual([1, 2, 3, 4]);
    });

    it('pruneImages keeps newest keepN and deletes older', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgprune-'));
        for (let i = 0; i < 5; i++) {
            const p = path.join(dir, `f${i}.png`);
            fs.writeFileSync(p, 'x');
            fs.utimesSync(p, new Date(1000 + i * 1000), new Date(1000 + i * 1000));
        }
        pruneImages(dir, 2);
        expect(fs.readdirSync(dir).sort()).toEqual(['f3.png', 'f4.png']);
    });

    it('pruneImages is a no-op on a missing directory', () => {
        expect(() => pruneImages('/no/such/dir/xyz', 5)).not.toThrow();
    });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/imageStore.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/imageStore'`。

- [ ] **Step 3: 写实现**

创建 `src/shared/imageStore.ts`：

```ts
import * as fs from 'fs';
import * as path from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

const MIME_EXT: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
};

/** MIME → 扩展名，未知回退 .png */
export function extForMime(mime: string): string {
    return MIME_EXT[mime.toLowerCase()] || '.png';
}

/** 粘贴图基名；seq 由调用方传入保证唯一，本函数纯格式化便于测试 */
export function pastedImageName(seq: number | string, ext = '.png'): string {
    return `paste-${seq}${ext}`;
}

/** 按扩展名判断是否图片（决定缩略图 / 文字 chip） */
export function isImagePath(p: string): boolean {
    return IMAGE_EXTS.has(path.extname(p).toLowerCase());
}

/** 确保 dir 存在、写文件、返回绝对路径 */
export function writeImageFile(dir: string, bytes: Uint8Array, name: string): string {
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, name);
    fs.writeFileSync(full, bytes);
    return full;
}

/** 按 mtime 保留最近 keepN 个、删除更旧的（仅作用于 dir 内文件） */
export function pruneImages(dir: string, keepN: number): void {
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return; // 目录不存在 → no-op
    }
    const files = names
        .map((n) => path.join(dir, n))
        .filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } })
        .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime); // 新 → 旧
    for (const { p } of files.slice(keepN)) {
        try { fs.unlinkSync(p); } catch { /* 忽略 */ }
    }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/imageStore.test.ts`
Expected: PASS，6 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/shared/imageStore.ts tests/imageStore.test.ts
git commit -m "feat: imageStore 纯逻辑模块（落盘/命名/清理/类型判断）"
```

---

### Task 2: 视图层接线 —— 粘贴、拖拽、缩略图 chip

**Files:**
- Modify: `src/features/chat/input.ts`（新增 `handlePaste`/`handleDrop`/`thumbSrc`/`pastedDir`，扩展 `renderAttachmentChips`）
- Modify: `src/features/chat/view.ts`（在 `buildUI()` 里注册 paste/drop/dragover 事件）
- Modify: `src/i18n/index.ts`（新增 `input.imageSaveFailed`）
- Modify: `styles.css`（缩略图 chip + drop 高亮）

**Interfaces:**
- Consumes（来自 Task 1）：`extForMime`、`pastedImageName`、`isImagePath`、`writeImageFile`、`pruneImages`。
- Produces：`handlePaste(view, e)`、`handleDrop(view, e)`（view.ts 注册用）。

- [ ] **Step 1: i18n 加文案**

`src/i18n/index.ts` 的 `STRINGS` 里，在 `'input.attach'` 那条后面加一行：

```ts
    'input.imageSaveFailed': { zh: '图片保存失败', en: 'Failed to save image' },
```

- [ ] **Step 2: input.ts 顶部加 import**

把第 9 行下方（`attachments` import 之后）补一行：

```ts
import { extForMime, pastedImageName, isImagePath, writeImageFile, pruneImages } from '../../shared/imageStore';
```

- [ ] **Step 3: input.ts 扩展 `renderAttachmentChips` 支持缩略图**

用下面整段替换现有 `renderAttachmentChips`（第 89–107 行）：

```ts
/** 渲染附件 chips：图片显示缩略图，其它显示文件名；均带 ✕ 删除 */
export function renderAttachmentChips(view: WorkbuddianChatView) {
    view.attachChipsEl.empty();
    if (view.attachments.length === 0) {
        view.attachChipsEl.addClass('workbuddian-hidden');
        return;
    }
    view.attachChipsEl.removeClass('workbuddian-hidden');
    view.attachments.forEach((p, idx) => {
        const chip = view.attachChipsEl.createDiv({ cls: 'workbuddian-ref-chip' });
        if (isImagePath(p)) {
            chip.addClass('workbuddian-image-chip');
            const img = chip.createEl('img', {
                cls: 'workbuddian-image-thumb',
                attr: { alt: fileBasename(p), title: p },
            });
            img.src = thumbSrc(view, p);
        } else {
            chip.createSpan({ cls: 'workbuddian-ref-chip-name', text: fileBasename(p), attr: { title: p } });
        }
        const close = chip.createSpan({ cls: 'workbuddian-ref-chip-close', attr: { 'aria-label': t('input.removeReference'), role: 'button', tabindex: '0' } });
        setIcon(close, 'x');
        close.onclick = () => {
            view.attachments.splice(idx, 1);
            renderAttachmentChips(view);
        };
    });
}

/** 缩略图源：vault 内文件用 Obsidian 资源路径，vault 外文件读盘转 data URL */
function thumbSrc(view: WorkbuddianChatView, absPath: string): string {
    const base = view.vaultPath;
    if (base && absPath.startsWith(base)) {
        const rel = absPath.slice(base.length).replace(/^[\\/]/, '');
        return view.app.vault.adapter.getResourcePath(rel);
    }
    try {
        const buf = require('fs').readFileSync(absPath) as Buffer;
        const ext = require('path').extname(absPath).slice(1) || 'png';
        return `data:image/${ext};base64,${buf.toString('base64')}`;
    } catch {
        return '';
    }
}

/** 粘贴图存储目录：<vault>/.obsidian/plugins/workbuddian/pasted */
function pastedDir(view: WorkbuddianChatView): string {
    return `${view.vaultPath}/${view.app.vault.configDir}/plugins/workbuddian/pasted`;
}
```

- [ ] **Step 4: input.ts 加 paste / drop 处理器**

在 `openAttachmentPicker`（第 156–168 行）之后追加：

```ts
/** 粘贴：剪贴板里的图片落盘成文件加入附件；纯文本粘贴不拦截 */
export async function handlePaste(view: WorkbuddianChatView, e: ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const images = items.filter(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (images.length === 0) return; // 让默认文本粘贴发生
    e.preventDefault();
    const dir = pastedDir(view);
    for (const it of images) {
        const file = it.getAsFile();
        if (!file) continue;
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const seq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
            const name = pastedImageName(seq, extForMime(it.type));
            const p = writeImageFile(dir, bytes, name);
            if (!view.attachments.includes(p)) view.attachments.push(p);
        } catch {
            new Notice(t('input.imageSaveFailed'));
        }
    }
    pruneImages(dir, 20);
    renderAttachmentChips(view);
}

/** 拖拽放下：文件（图片或其它）用其绝对路径加入附件 */
export function handleDrop(view: WorkbuddianChatView, e: DragEvent) {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    for (const f of files) {
        const p = attachmentPath(f);
        if (p && !view.attachments.includes(p)) view.attachments.push(p);
    }
    renderAttachmentChips(view);
}
```

- [ ] **Step 5: view.ts 注册事件**

在 `view.ts` 顶部 import（第 9 行的 `./input` 那条）里补 `handlePaste, handleDrop`。然后在 `buildUI()` 里、`this.inputEl.addEventListener('focus', ...)`（约第 137 行）之后追加：

```ts
        // 粘贴图片 → 落盘加附件
        this.inputEl.addEventListener('paste', (e) => void handlePaste(this, e));
        // 拖拽文件 → 加附件（带 drop 高亮）
        inputBox.addEventListener('dragover', (e) => { e.preventDefault(); inputBox.addClass('workbuddian-drop-active'); });
        inputBox.addEventListener('dragleave', () => inputBox.removeClass('workbuddian-drop-active'));
        inputBox.addEventListener('drop', (e) => { inputBox.removeClass('workbuddian-drop-active'); handleDrop(this, e); });
```

- [ ] **Step 6: styles.css 加样式**

在 `styles.css` 末尾追加：

```css
/* 图片附件缩略图 chip */
.workbuddian-image-chip { padding: 2px; }
.workbuddian-image-thumb {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
    display: block;
}
/* 拖拽悬停高亮 */
.workbuddian-drop-active {
    outline: 2px dashed var(--workbuddian-primary, var(--interactive-accent));
    outline-offset: 2px;
}
```

- [ ] **Step 7: 构建（类型检查门槛）**

Run: `npm run build`
Expected: exit 0，产出新的 `main.js`（`tsc` 无类型错误）。

- [ ] **Step 8: 全量测试无回归**

Run: `npm test`
Expected: 全绿（Task 1 的 6 个新用例 + 原有 235 个）。

- [ ] **Step 9: 手动验证（部署到 vault + 重载）**

按项目约定，把 `main.js` / `manifest.json` / `styles.css` 复制到你真实 vault 的 `.obsidian/plugins/workbuddian/`，在 Obsidian 里 `Cmd+R` 重载，然后：
1. 截图 → 在聊天框 `Cmd+V` → **输入框上方出现缩略图 chip**。
2. 输入「描述这张图里有什么」发送 → **CLI 给出基于图片的描述**（非瞎编）。
3. 从访达拖一张图片进输入框 → **拖拽时有虚线高亮**、放下后出现缩略图 chip。
4. 点缩略图上的 ✕ → chip 移除。
5. 确认 vault 里 `.obsidian/plugins/workbuddian/pasted/` 生成了粘贴图文件。

- [ ] **Step 10: 提交**

```bash
git add src/features/chat/input.ts src/features/chat/view.ts src/i18n/index.ts styles.css main.js
git commit -m "feat: 聊天输入支持粘贴/拖拽图片 + 缩略图 chip（CLI 视觉分析）"
```

---

## Self-Review 记录

- **Spec coverage**：粘贴（Task 2 Step 4/5）、拖拽（Task 2 Step 4/5）、vault 内隐藏目录存储（`pastedDir`）、清理保留 20（`pruneImages` 调用）、缩略图 chip（Step 3）、发送链路不变（复用 `buildAttachmentBlock`/`attachmentDirs`，本计划未改 `sendText`）、错误 Notice（Step 4）、i18n（Step 1）、单测（Task 1）——spec 各条均有对应任务。可选的「含图片时给 CLI 加措辞」按 YAGNI 未纳入（现有「请用文件工具查看其内容」措辞对图片路径已触发视觉）。
- **Placeholder scan**：无 TBD/TODO；每个改动步骤都给了完整代码。
- **Type consistency**：`imageStore` 导出的 `extForMime/pastedImageName/isImagePath/writeImageFile/pruneImages` 签名在 Task 1 定义、Task 2 按同名同参调用一致。
