# 消息气泡内图片缩略图 + 粘贴图保留数量可配置 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户消息气泡内的图片附件显示为缩略图（失效时优雅降级为文件名），并把粘贴图保留数量做成可配置项（0 = 不限制）。

**Architecture:** `ChatMessage.attachments` 的语义从「文件名」改为「绝对路径」，渲染层用新纯函数 `isAbsolutePath()` 区分新旧数据，图片走复用自输入框的 `thumbSrc()` 出图、`onerror` 就地降级为文件名 chip。设置项 `pastedImageKeep` 走既有的 `migrateSettings` 迁移管线（版本 9 → 10），`pruneImages` 对 `keepN <= 0` 直接返回。

**Tech Stack:** TypeScript + esbuild 打包、Jest + ts-jest 单测、Obsidian Plugin API。

## Global Constraints

- 不新增任何 npm 依赖。
- 纯逻辑必须放 `src/shared` / `src/core` / `src/types` 并配 jest 单测；`import ... from 'obsidian'` 的文件（`features/**`）按项目惯例**不写单测**。
- 所有用户可见文案必须走 `t()` 且中英双语齐全（`src/i18n/index.ts`）。
- `main.js` 是提交进仓库的构建产物：**凡是改了 `src/**` 的提交，都要先 `npm run build` 再把 `main.js` 一并 `git add`**（见 `git show --stat c107b6a`）。
- `npm run build` 内含 `tsc -noEmit` 类型检查，必须零错误。
- 保留数量上限常量 `MAX_PASTED_IMAGE_KEEP = 500`，默认值 `20`，`0` 语义为「不限制」。
- 日志前缀保持 `[WB]`；发给 CLI 的 prompt 保持中文。

## File Structure

| 文件 | 责任 | 本计划中的改动 |
|---|---|---|
| `src/shared/attachments.ts` | 附件路径的纯字符串工具 | 新增 `isAbsolutePath()` |
| `src/shared/imageStore.ts` | 粘贴图落盘 / 清理 | `pruneImages` 支持 `keepN <= 0` = 不限制 |
| `src/types/index.ts` | 设置类型 + 迁移管线 | 新增 `pastedImageKeep` 字段、版本 9 → 10、迁移校验 |
| `src/i18n/index.ts` | 中英文案字典 | 新增 2 条设置文案 |
| `src/features/settings/tab.ts` | 设置页 UI | 「上下文注入」组新增一项 |
| `src/features/chat/input.ts` | 输入区 / 发送 / 附件采集 | `thumbSrc` 改 export；prune 读设置；`addMessage` 传绝对路径 |
| `src/features/chat/render.ts` | 消息渲染 | 附件分支按条目分派：缩略图 / 文件名 chip |
| `styles.css` | 样式 | **无需改动**（`.workbuddian-image-chip` / `.workbuddian-image-thumb` 是全局类，气泡内加同名 class 即生效） |

---

### Task 1: `isAbsolutePath` 纯函数

**Files:**
- Modify: `src/shared/attachments.ts`
- Test: `tests/attachments.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `isAbsolutePath(p: string): boolean` —— Task 5 用它区分「绝对路径」与旧数据的纯文件名

- [ ] **Step 1: 写失败的测试**

在 `tests/attachments.test.ts` 顶部 import 里加上 `isAbsolutePath`，并在文件末尾追加：

```ts
describe('isAbsolutePath', () => {
    it('accepts POSIX absolute paths', () => {
        expect(isAbsolutePath('/Users/x/paste-1.png')).toBe(true);
    });
    it('accepts Windows drive paths with either separator', () => {
        expect(isAbsolutePath('C:\\Users\\x\\paste-1.png')).toBe(true);
        expect(isAbsolutePath('C:/Users/x/paste-1.png')).toBe(true);
    });
    it('accepts UNC paths', () => {
        expect(isAbsolutePath('\\\\server\\share\\paste-1.png')).toBe(true);
    });
    it('rejects a bare filename (legacy attachment data)', () => {
        expect(isAbsolutePath('paste-1.png')).toBe(false);
    });
    it('rejects relative paths', () => {
        expect(isAbsolutePath('docs/paste-1.png')).toBe(false);
        expect(isAbsolutePath('./paste-1.png')).toBe(false);
    });
    it('rejects an empty string', () => {
        expect(isAbsolutePath('')).toBe(false);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/attachments.test.ts`
Expected: FAIL —— `isAbsolutePath is not a function` / TS 报找不到导出。

- [ ] **Step 3: 写最小实现**

在 `src/shared/attachments.ts` 末尾追加：

```ts
/** 跨平台判断是否绝对路径：POSIX `/a/b`、Windows `C:\a\b` 或 `C:/a/b`、UNC `\\host\share`。
 *  用于区分新数据（绝对路径）与旧消息里存的纯文件名。 */
export function isAbsolutePath(p: string): boolean {
    return /^([\\/]|[A-Za-z]:[\\/])/.test(p);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/attachments.test.ts`
Expected: PASS，全部用例绿。

- [ ] **Step 5: 提交**

```bash
npm run build
git add src/shared/attachments.ts tests/attachments.test.ts main.js
git commit -m "feat: attachments 新增 isAbsolutePath（区分绝对路径与旧文件名数据）"
```

---

### Task 2: `pruneImages` 支持「不限制」

**Files:**
- Modify: `src/shared/imageStore.ts:40`
- Test: `tests/imageStore.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `pruneImages(dir: string, keepN: number): void` 语义扩展 —— `keepN <= 0` 表示不限制、直接返回

- [ ] **Step 1: 写失败的测试**

在 `tests/imageStore.test.ts` 的 `describe('imageStore', ...)` 内、现有 `pruneImages is a no-op on a missing directory` 之后追加：

```ts
    it('pruneImages keeps every file when keepN is 0 (unlimited)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgprune0-'));
        for (let i = 0; i < 3; i++) {
            const p = path.join(dir, `f${i}.png`);
            fs.writeFileSync(p, 'x');
            fs.utimesSync(p, new Date(1000 + i * 1000), new Date(1000 + i * 1000));
        }
        pruneImages(dir, 0);
        expect(fs.readdirSync(dir).sort()).toEqual(['f0.png', 'f1.png', 'f2.png']);
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/imageStore.test.ts -t "unlimited"`
Expected: FAIL —— 目录被清空，实际得到 `[]`。

- [ ] **Step 3: 写最小实现**

`src/shared/imageStore.ts` 的 `pruneImages` 函数体首行插入：

```ts
export function pruneImages(dir: string, keepN: number): void {
    if (keepN <= 0) return; // 0 = 不限制，永不清理
    let names: string[];
```

同时把该函数上方的注释改为：

```ts
/** 按 mtime 保留最近 keepN 个、删除更旧的（仅作用于 dir 内文件）；keepN <= 0 表示不限制 */
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/imageStore.test.ts`
Expected: PASS，含原有的 `keeps newest keepN and deletes older`（keepN=2 仍照常清理）。

- [ ] **Step 5: 提交**

```bash
npm run build
git add src/shared/imageStore.ts tests/imageStore.test.ts main.js
git commit -m "feat: pruneImages 支持 keepN<=0 表示不限制"
```

---

### Task 3: `pastedImageKeep` 设置字段与迁移

**Files:**
- Modify: `src/types/index.ts`（interface / DEFAULT_SETTINGS / CURRENT_SETTINGS_VERSION / migrateSettings）
- Test: `tests/types.test.ts`（含修正 2 处旧的版本号断言）

**Interfaces:**
- Consumes: 无
- Produces:
  - `WorkbuddianSettings.pastedImageKeep: number`（默认 20，0 = 不限制）
  - `export const MAX_PASTED_IMAGE_KEEP = 500` —— Task 4 的设置页输入校验复用
  - `CURRENT_SETTINGS_VERSION` 变为 `10`

- [ ] **Step 1: 写失败的测试**

`tests/types.test.ts` 顶部 import 加上 `MAX_PASTED_IMAGE_KEEP`。

改掉两处写死 9 的旧断言：
- 第 34-35 行：`it('should have settings version 9'` → `it('should have settings version 10'`，`expect(DEFAULT_SETTINGS.version).toBe(9)` → `.toBe(10)`
- 第 140-141 行：`it('should migrate an older stored version up to 9'` → `... up to 10'`，`).version).toBe(9)` → `.toBe(10)`

在 `DEFAULT_SETTINGS` 的 describe 内追加：

```ts
    it('should default pastedImageKeep to 20', () => {
        expect(DEFAULT_SETTINGS.pastedImageKeep).toBe(20);
    });
```

在 `migrateSettings` 的 describe 内追加：

```ts
    it('should fill pastedImageKeep default when missing', () => {
        expect(migrateSettings({}).pastedImageKeep).toBe(20);
    });
    it('should keep 0 as unlimited', () => {
        expect(migrateSettings({ pastedImageKeep: 0 }).pastedImageKeep).toBe(0);
    });
    it('should keep a valid in-range value', () => {
        expect(migrateSettings({ pastedImageKeep: 50 }).pastedImageKeep).toBe(50);
        expect(migrateSettings({ pastedImageKeep: MAX_PASTED_IMAGE_KEEP }).pastedImageKeep).toBe(MAX_PASTED_IMAGE_KEEP);
    });
    it('should fall back to default for out-of-range, fractional or non-number values', () => {
        expect(migrateSettings({ pastedImageKeep: -1 }).pastedImageKeep).toBe(20);
        expect(migrateSettings({ pastedImageKeep: 501 }).pastedImageKeep).toBe(20);
        expect(migrateSettings({ pastedImageKeep: 1.5 }).pastedImageKeep).toBe(20);
        expect(migrateSettings({ pastedImageKeep: '30' }).pastedImageKeep).toBe(20);
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/types.test.ts`
Expected: FAIL —— TS 报 `MAX_PASTED_IMAGE_KEEP` 无导出、`pastedImageKeep` 不在类型上，版本断言 9 ≠ 10。

- [ ] **Step 3: 写实现**

`src/types/index.ts` 四处改动：

（1）`WorkbuddianSettings` 接口在 `customInstruction: string;` 之后加一行：

```ts
    pastedImageKeep: number;
```

（2）常量区（`DEFAULT_CONTEXT_WINDOW_SIZE` 旁边）：

```ts
const CURRENT_SETTINGS_VERSION = 10;
const DEFAULT_CONTEXT_WINDOW_SIZE = 200000;
const DEFAULT_PASTED_IMAGE_KEEP = 20;
/** 粘贴图保留数量上限；0 表示不限制 */
export const MAX_PASTED_IMAGE_KEEP = 500;
```

（3）`DEFAULT_SETTINGS` 在 `customInstruction: '',` 之后加：

```ts
    pastedImageKeep: DEFAULT_PASTED_IMAGE_KEEP,
```

（4）`migrateSettings`：在函数开头的取值区加一行

```ts
    const pastedImageKeep = getNumber(stored, 'pastedImageKeep');
```

并在返回对象的 `customInstruction: ...` 之后加：

```ts
        pastedImageKeep: typeof pastedImageKeep === 'number'
            && Number.isInteger(pastedImageKeep)
            && pastedImageKeep >= 0
            && pastedImageKeep <= MAX_PASTED_IMAGE_KEEP
            ? pastedImageKeep
            : DEFAULT_SETTINGS.pastedImageKeep,
```

- [ ] **Step 4: 跑全量测试确认通过**

Run: `npm test`
Expected: PASS。特别注意 `tests/manager.test.ts` / `tests/api.test.ts` 若有构造完整 settings 对象的地方，TS 会因缺 `pastedImageKeep` 报错 —— 若报错，给这些对象补上 `pastedImageKeep: 20`。

- [ ] **Step 5: 提交**

```bash
npm run build
git add src/types/index.ts tests/types.test.ts main.js
git commit -m "feat: 新增 pastedImageKeep 设置项与迁移（settings v10）"
```

---

### Task 4: 设置页 UI + i18n + 清理调用点接线

**Files:**
- Modify: `src/i18n/index.ts`（新增 2 条文案）
- Modify: `src/features/settings/tab.ts`（import + 「上下文注入」组新增一项）
- Modify: `src/features/chat/input.ts:234`（prune 读设置）

**Interfaces:**
- Consumes: `WorkbuddianSettings.pastedImageKeep`、`MAX_PASTED_IMAGE_KEEP`（Task 3）；`pruneImages` 的 `keepN <= 0` 语义（Task 2）
- Produces: 无（终端消费方）

本任务全在 `import 'obsidian'` 的文件里，按项目惯例不写单测；验证靠 `npm run build` + 手动。

- [ ] **Step 1: 加 i18n 文案**

`src/i18n/index.ts` 中，紧挨 `'settings.injectNoteDesc'` 那两行之后插入：

```ts
    'settings.pastedKeep': { zh: '粘贴图保留数量', en: 'Pasted image retention' },
    'settings.pastedKeepDesc': { zh: '插件目录内最多保留多少张粘贴的图片，超出的自动删除。填 0 表示不限制（历史消息里的缩略图不会失效，但图片会一直累积）。默认 20，最大 500。', en: 'How many pasted images to keep in the plugin folder; older ones are deleted automatically. 0 means unlimited (thumbnails in old messages stay valid, but images accumulate). Default 20, max 500.' },
```

- [ ] **Step 2: 加设置项**

`src/features/settings/tab.ts` 第 3 行的 import 改为：

```ts
import { DEFAULT_SETTINGS, migrateSettings, exportSettings, MAX_PASTED_IMAGE_KEEP } from '../../types';
```

在「上下文注入」组的 `settings.injectNote` 那个 `new Setting(...)` 块之后（即第 105 行 `}));` 之后、`// ===== 外观 =====` 之前）插入：

```ts
        new Setting(containerEl)
            .setName(t('settings.pastedKeep'))
            .setDesc(t('settings.pastedKeepDesc'))
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.pastedImageKeep))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 0 && num <= MAX_PASTED_IMAGE_KEEP) {
                        this.plugin.settings.pastedImageKeep = num;
                        await this.plugin.saveSettings();
                    }
                }));
```

- [ ] **Step 3: 接线清理调用点**

`src/features/chat/input.ts:234`：

```ts
    pruneImages(dir, view.settings.pastedImageKeep);
```

（`view.settings` 是与插件共享的同一对象引用，见 `view.ts:53`，改设置即时生效。）

- [ ] **Step 4: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零 TS 错误；测试全绿（`tests/i18n.test.ts` 若校验中英 key 对齐，新增的 2 条已成对，应当通过）。

- [ ] **Step 5: 提交**

```bash
git add src/i18n/index.ts src/features/settings/tab.ts src/features/chat/input.ts main.js
git commit -m "feat: 设置页可配置粘贴图保留数量（0=不限制）"
```

---

### Task 5: 渲染层按条目分派（缩略图 + 降级）

**Files:**
- Modify: `src/features/chat/input.ts:133`（`thumbSrc` 改为 export）
- Modify: `src/features/chat/render.ts:42-49`（附件分支重写 + 新增 `renderNameChip`）

**Interfaces:**
- Consumes: `isAbsolutePath()`（Task 1）、`isImagePath()`（`shared/imageStore.ts`，纯 `path` 判断不触发 IO）、`fileBasename()`（`shared/attachments.ts`）
- Produces: 渲染层已能处理绝对路径条目 —— Task 6 切换数据后即刻生效

**这一步不改数据层，所以行为暂时不变**（现存消息里 attachments 仍是纯文件名 → `isAbsolutePath` 为 false → 走文件名 chip）。这正是把它排在数据切换之前的原因：任一步单独提交都不会让 UI 变难看。

- [ ] **Step 1: 把 `thumbSrc` 导出**

`src/features/chat/input.ts:133`：

```ts
/** 缩略图源：vault 内文件用 Obsidian 资源路径，vault 外文件读盘转 data URL；失败返回空串 */
export function thumbSrc(view: WorkbuddianChatView, absPath: string): string {
```

- [ ] **Step 2: 重写 render.ts 的附件分支**

`src/features/chat/render.ts` 顶部 import 区加入：

```ts
import { fileBasename, isAbsolutePath } from '../../shared/attachments';
import { isImagePath } from '../../shared/imageStore';
import { retryLastMessage, openWorkbuddianSettings, thumbSrc } from './input';
```

（最后一行是在现有那条 import 上补 `thumbSrc`，不要新增重复 import。）

把第 42-49 行的附件块整体替换为：

```ts
        if (msg.attachments && msg.attachments.length > 0) {
            const attachmentsRow = bubble.createDiv({ cls: 'workbuddian-message-attachments' });
            for (const entry of msg.attachments) {
                renderAttachmentChip(view, attachmentsRow, entry);
            }
        }
```

并在 `renderMessage` 函数之后新增两个辅助函数：

```ts
/** 单个附件 chip：图片出缩略图，其余（含旧数据的纯文件名）出文件名 */
function renderAttachmentChip(view: WorkbuddianChatView, row: HTMLElement, entry: string) {
    const chip = row.createDiv({ cls: 'workbuddian-attachment-chip' });
    const name = fileBasename(entry);
    if (!isAbsolutePath(entry) || !isImagePath(entry)) {
        renderNameChip(chip, name);
        return;
    }
    const src = thumbSrc(view, entry);
    if (!src) {
        renderNameChip(chip, name); // 文件读不到（已被清理 / 换了机器）
        return;
    }
    chip.addClass('workbuddian-image-chip');
    const img = chip.createEl('img', {
        cls: 'workbuddian-image-thumb',
        attr: { alt: name, title: name },
    });
    img.onerror = () => {
        chip.empty();
        chip.removeClass('workbuddian-image-chip');
        renderNameChip(chip, name);
    };
    img.src = src;
}

/** paperclip + 文件名（正常的非图片附件，以及缩略图加载失败后的降级） */
function renderNameChip(chip: HTMLElement, name: string) {
    setIcon(chip.createSpan({ cls: 'workbuddian-attachment-chip-icon' }), 'paperclip');
    chip.createSpan({ cls: 'workbuddian-attachment-chip-name', text: name });
}
```

- [ ] **Step 3: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零 TS 错误、测试全绿（渲染层无单测，测试数量应与 Task 4 后一致）。

- [ ] **Step 4: 手动确认「不回归」**

在 Obsidian 里重载插件，打开一个**已有的**含附件的旧对话：附件仍显示为 paperclip + 文件名，与改动前一致。

- [ ] **Step 5: 提交**

```bash
git add src/features/chat/render.ts src/features/chat/input.ts main.js
git commit -m "feat: 消息附件按条目分派渲染（图片缩略图 + 失效降级为文件名）"
```

---

### Task 6: 数据层切换为绝对路径（点亮功能）

**Files:**
- Modify: `src/features/chat/input.ts:437-438`

**Interfaces:**
- Consumes: Task 5 的渲染分派
- Produces: `ChatMessage.attachments` 语义 = 绝对路径（旧数据仍是文件名，由 `isAbsolutePath` 兜住）

- [ ] **Step 1: 改发送时写入的内容**

`src/features/chat/input.ts` 第 437-438 行现在是：

```ts
    const attachmentNames = view.attachments.map(fileBasename);
    view.manager.addMessage(convId, 'user', text, attachmentNames);
```

改为：

```ts
    // 存绝对路径（而非文件名），渲染层据此出缩略图；旧消息存的是文件名，由 isAbsolutePath 区分
    view.manager.addMessage(convId, 'user', text, [...view.attachments]);
```

拷贝数组是必需的：`view.attachments` 在发送流程后段会被重置。

若 `fileBasename` 在 `input.ts` 中再无其它引用，把它从该文件的 import 里去掉（其余 import 项保留）；`npm run build` 的 TS 检查会指出未使用项。

- [ ] **Step 2: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 构建零 TS 错误、测试全绿。

- [ ] **Step 3: 手动验证（这是本计划的验收核心）**

在 Obsidian 中重载插件后逐条确认：

1. 截图后在聊天框 `Cmd+V` 粘贴 → 发送 → **用户气泡内出现 40×40 缩略图**。
2. 从访达拖一张 vault 外的图进输入框 → 发送 → 气泡内同样出缩略图（走 data URL 分支）。
3. 用附件按钮选一个非图片文件（如 .pdf）→ 发送 → 气泡内是 paperclip + 文件名。
4. 手动删掉 `<vault>/.obsidian/plugins/workbuddian/pasted/` 下那张图 → 重开面板 → 对应气泡变成 paperclip + 文件名，**不是碎图标**。
5. 打开一个改动前产生的旧对话 → 附件仍正常显示文件名。
6. 设置页把「粘贴图保留数量」改为 0 → 连续粘贴 25 张图 → `pasted/` 目录里 25 张都在；改回 20 后再粘一张 → 只剩最近 20 张。
7. 设置页填入 `-5` / `abc` / `999` → 不写入设置（重开设置页仍显示原值）。

- [ ] **Step 4: 提交**

```bash
git add src/features/chat/input.ts main.js
git commit -m "feat: 消息附件改存绝对路径，气泡内显示图片缩略图（closes #1）"
```

---

### Task 7: 文档收尾

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `manifest.json`、`package.json`、`versions.json`（版本号）

**Interfaces:**
- Consumes: Task 1-6 的全部改动
- Produces: 无

- [ ] **Step 1: 决定版本号并写 CHANGELOG**

本次是两个新增功能、无破坏性变更 → `1.3.0`。在 `CHANGELOG.md` 顶部（`# Changelog` 之下）插入：

```markdown
## v1.3.0 — 2026-07-26

### 新增
- **气泡内图片缩略图**：用户消息发出后，图片附件在气泡内以 40×40 缩略图显示（vault 内走 Obsidian 资源路径，vault 外读盘转 data URL）；图片已被清理或路径失效时自动降级为 paperclip + 文件名，不出现碎图。`ChatMessage.attachments` 语义由文件名改为绝对路径，旧消息经新纯函数 `isAbsolutePath` 识别后按原样显示，无需迁移。(#1)
- **粘贴图保留数量可配置**：设置页「上下文注入」组新增「粘贴图保留数量」，默认 20、最大 500，**填 0 表示不限制**（历史消息缩略图永不失效，代价是图片持续累积）。settings 版本 9 → 10。(#2)
```

- [ ] **Step 2: 同步版本号**

Run: `npm version 1.3.0 --no-git-tag-version`
Expected: `package.json` 变 1.3.0，`version-bump.mjs` 同步 `manifest.json` + `versions.json`。跑完用 `git diff --stat` 确认这三个文件都动了。

- [ ] **Step 3: 最终验证**

Run: `npm run build && npm test`
Expected: 构建零错误、测试全绿。用 `git status` 确认 `main.js` 已随构建更新。

- [ ] **Step 4: 提交**

```bash
git add CHANGELOG.md package.json manifest.json versions.json main.js
git commit -m "release: 1.3.0 — 气泡图片缩略图 + 粘贴图保留数量可配置"
```

- [ ] **Step 5: 关闭 issue（需先征得用户同意再执行）**

推送与 issue 操作属于对外动作，**必须先向用户报告并获得确认**，不要自行执行。确认后：

```bash
gh issue comment 1 --repo jiang198012/workbuddian --body "已在 v1.3.0 实现：气泡内图片缩略图 + 失效降级。"
gh issue comment 2 --repo jiang198012/workbuddian --body "已在 v1.3.0 实现：设置页「粘贴图保留数量」，0 表示不限制。"
```

（两个 issue 当前已是 CLOSED 状态，无需再次关闭，补一条说明即可。）
