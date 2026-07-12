# 自定义主色调 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在设置页选一个主色调，聊天面板全部强调色跟随；留空/恢复默认时回退 Obsidian 主题的 `--interactive-accent`。

**Architecture:** 新增设置字段 `primaryColor`（空=跟随主题），把 `styles.css` 的 10 处强调色改为 `var(--workbuddian-primary, var(--interactive-accent))` 原生回退；插件在 `document.body` 单点写入该 CSS 变量（`applyPrimaryColor`），由 `saveSettings` 统一应用，设置页提供原生取色器 + 恢复默认。

**Tech Stack:** TypeScript 4.7、esbuild、Obsidian Plugin API（`addColorPicker`/`addExtraButton`）、Jest + ts-jest、纯 CSS 变量。

## Global Constraints

（以下为 spec 全局约束，每个 Task 隐含遵守）

- CSS 变量名固定 `--workbuddian-primary`；CSS 引用形式固定 `var(--workbuddian-primary, var(--interactive-accent))`。
- `primaryColor` 空串 `''` = 跟随主题（不写入 body 变量，靠 CSS 原生 fallback）。
- 注入点固定为 `document.body`（单点覆盖侧边栏 + 主编辑区两个 view）。
- 设置版本 `CURRENT_SETTINGS_VERSION` 升到 `5`；迁移对缺失/非法值回退默认。
- UI 文案用中文。
- **本仓库不是 git 仓库**：计划中不做 `git commit`；每个 Task 以「构建 + 测试验证」作为收尾门。
- 测试命令：单文件 `npx jest tests/types.test.ts`；全量 `npx jest`。构建：`npm run build`（先 `tsc -noEmit` 类型检查再 esbuild 打包到 `main.js`）。
- `styles.css` 是独立分发文件，**不经 esbuild 打包**，改动靠 grep 断言 + Obsidian 内人工验收。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/types/index.ts` | 设置类型、默认值、版本、迁移 | Modify |
| `tests/types.test.ts` | 迁移单测 | Modify |
| `styles.css` | 10 处强调色改带回退的自定义变量 | Modify |
| `src/shared/primaryColor.ts` | `applyPrimaryColor` —— body 变量注入/清理（单一职责） | Create |
| `src/main.ts` | 生命周期接线（onload/saveSettings/onunload） | Modify |
| `src/features/settings/tab.ts` | 「聊天主色调」取色器 + 恢复默认 | Modify |

---

## Task 1: 设置模型与迁移（primaryColor 字段 + version 5）

**Files:**
- Modify: `src/types/index.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `WorkbuddianSettings.primaryColor: string`
  - `DEFAULT_SETTINGS.primaryColor === ''`
  - `DEFAULT_SETTINGS.version === 5`
  - `migrateSettings(stored).primaryColor` —— 合法 string 保留，否则 `''`

- [ ] **Step 1: 写失败测试**

在 `tests/types.test.ts` 的 `describe('DEFAULT_SETTINGS', ...)` 块内（`should default model to auto` 用例后）追加：

```ts
    it('should default primaryColor to empty string', () => {
        expect(DEFAULT_SETTINGS.primaryColor).toBe('');
    });
    it('should have settings version 5', () => {
        expect(DEFAULT_SETTINGS.version).toBe(5);
    });
```

在 `describe('migrateSettings', ...)` 块内（`should reset version to current` 用例后）追加：

```ts
    it('should default primaryColor to empty when missing', () => {
        expect(migrateSettings({}).primaryColor).toBe('');
    });
    it('should preserve a valid primaryColor', () => {
        expect(migrateSettings({ primaryColor: '#a855f7' }).primaryColor).toBe('#a855f7');
    });
    it('should reset non-string primaryColor to empty', () => {
        expect(migrateSettings({ primaryColor: 123 }).primaryColor).toBe('');
        expect(migrateSettings({ primaryColor: { r: 1 } }).primaryColor).toBe('');
    });
    it('should migrate stored version 4 up to 5', () => {
        expect(migrateSettings({ version: 4 }).version).toBe(5);
    });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/types.test.ts`
Expected: FAIL —— `DEFAULT_SETTINGS.primaryColor` 为 `undefined`、version 仍是 4。

- [ ] **Step 3: 实现改动**

在 `src/types/index.ts` 中：

(a) `WorkbuddianSettings` 接口在 `model: string;` 与 `version: number;` 之间加一行：

```ts
    model: string;
    primaryColor: string;
    version: number;
```

(b) 版本常量：

```ts
const CURRENT_SETTINGS_VERSION = 5;
```

(c) `DEFAULT_SETTINGS` 在 `model: 'auto',` 后加一行：

```ts
    model: 'auto',
    primaryColor: '',
    version: CURRENT_SETTINGS_VERSION
```

(d) `migrateSettings` 的 return 对象在 `model: ...,` 后加一行：

```ts
        model: getString(stored, 'model') ?? DEFAULT_SETTINGS.model,
        primaryColor: getString(stored, 'primaryColor') ?? DEFAULT_SETTINGS.primaryColor,
        version: CURRENT_SETTINGS_VERSION
```

（`getString` 对非 string 返回 `undefined`，`?? ''` 完成非法值回退。）

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/types.test.ts`
Expected: PASS（含新增 6 条）。

- [ ] **Step 5: 全量回归（代替 commit）**

Run: `npx jest`
Expected: 全绿；旧用例 `migrateSettings('string')).toEqual(DEFAULT_SETTINGS)` 仍通过（DEFAULT_SETTINGS 与 migrate 返回都含 primaryColor，形状一致）。

---

## Task 2: CSS 变量回退（styles.css 10 处）

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Consumes: 无（CSS 独立）
- Produces: 聊天面板强调色改为读取 `--workbuddian-primary`，未设置时回退 `--interactive-accent`

10 处待改的实例位于行 57、70、241、250、333、421、533、575、576、608，均为精确子串 `var(--interactive-accent)`（`--text-on-accent` 不含该子串，不会误伤）。

- [ ] **Step 1: 全局替换**

Run（macOS `sed` 需 `-i ''`）:

```bash
cd <project>
sed -i '' 's/var(--interactive-accent)/var(--workbuddian-primary, var(--interactive-accent))/g' styles.css
```

- [ ] **Step 2: 验证替换数量与完整性**

Run:

```bash
grep -c "var(--workbuddian-primary, var(--interactive-accent))" styles.css
# 期望输出: 10
grep -nE "var\(--interactive-accent\)" styles.css | grep -v "workbuddian-primary" || echo "OK: 无裸 accent 残留"
# 期望输出: OK: 无裸 accent 残留
```

Expected: 第一条为 `10`；第二条为 `OK: 无裸 accent 残留`（每处 accent 都嵌在 fallback 内）。

- [ ] **Step 3: 构建不回归（代替 commit）**

Run: `npm run build`
Expected: `build-exit:0`（styles.css 不参与打包，此步确认 TS 侧无回归）。人工验收留到 Task 4 之后在 Obsidian 内进行。

---

## Task 3: 注入函数 + 生命周期接线

**Files:**
- Create: `src/shared/primaryColor.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `WorkbuddianSettings.primaryColor`（Task 1）
- Produces:
  - `PRIMARY_COLOR_VAR = '--workbuddian-primary'`
  - `applyPrimaryColor(color: string): void` —— 非空则 `body.style.setProperty`，空则 `removeProperty`
  - `saveSettings()` 成为主色的**唯一应用点**（保存后自动 `applyPrimaryColor(this.settings.primaryColor)`）

- [ ] **Step 1: 新建注入模块**

Create `src/shared/primaryColor.ts`:

```ts
/** 聊天面板主色调对应的 CSS 变量名（styles.css 以 var() 回退引用） */
export const PRIMARY_COLOR_VAR = '--workbuddian-primary';

/**
 * 把主色写入 document.body（单点覆盖侧边栏 + 主编辑区两个 view）。
 * 空字符串表示「跟随主题」，此时移除变量，靠 CSS 原生 fallback 回退 --interactive-accent。
 */
export function applyPrimaryColor(color: string): void {
    if (color) {
        document.body.style.setProperty(PRIMARY_COLOR_VAR, color);
    } else {
        document.body.style.removeProperty(PRIMARY_COLOR_VAR);
    }
}
```

- [ ] **Step 2: main.ts 导入**

在 `src/main.ts` 现有 import 段（`import { registerWorkbuddianIcon, ... } from './shared/icon';` 之后）加：

```ts
import { registerWorkbuddianIcon, WORKBUDDIAN_ICON_ID } from './shared/icon';
import { applyPrimaryColor } from './shared/primaryColor';
```

- [ ] **Step 3: onload 应用已存主色**

在 `onload` 内 `registerWorkbuddianIcon();` 之后加一行：

```ts
            // 注册品牌图标，供 ribbon 按钮与视图 tab 使用（须在使用该 id 之前）
            registerWorkbuddianIcon();

            // 应用已保存的主色调（空则跟随主题）
            applyPrimaryColor(this.settings.primaryColor);
```

- [ ] **Step 4: saveSettings 末尾重新应用**

把现有 `saveSettings` 改为（新增最后一行）：

```ts
    async saveSettings() {
        const existingData = normalizePersistedData(await this.loadData());
        const merged: PersistedData = { ...existingData, settings: this.settings };
        await this.saveData(merged);
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
        applyPrimaryColor(this.settings.primaryColor);
    }
```

- [ ] **Step 5: onunload 清理**

把现有 `onunload` 改为：

```ts
    onunload() {
        this.api.cancel();
        applyPrimaryColor('');
    }
```

- [ ] **Step 6: 构建验证（代替 commit）**

Run:

```bash
npm run build
grep -c "workbuddian-primary" main.js
```

Expected: `build-exit:0`；`grep` ≥ 1（注入变量名已打进 bundle）。

---

## Task 4: 设置页取色器 + 恢复默认

**Files:**
- Modify: `src/features/settings/tab.ts`

**Interfaces:**
- Consumes: `settings.primaryColor`（Task 1）；`saveSettings()` 会自动应用主色（Task 3，故此处无需直接调 `applyPrimaryColor`，保持单一应用点 DRY）
- Produces: 无（终端 UI）

- [ ] **Step 1: 追加设置项**

在 `src/features/settings/tab.ts` 的 `display()` 方法内、最后一个 Setting（`注入当前笔记链接`）之后追加：

```ts
        new Setting(containerEl)
            .setName('聊天主色调')
            .setDesc('自定义聊天面板的强调色（用户气泡、发送按钮、边框、focus 高亮等）。点「恢复默认」跟随 Obsidian 主题色。')
            .addColorPicker(picker => {
                const current = this.plugin.settings.primaryColor
                    || getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim()
                    || '#7c3aed';
                picker
                    .setValue(current)
                    .onChange(async (value) => {
                        this.plugin.settings.primaryColor = value;
                        await this.plugin.saveSettings(); // saveSettings 内部会 applyPrimaryColor
                    });
            })
            .addExtraButton(btn => btn
                .setIcon('rotate-ccw')
                .setTooltip('恢复默认（跟随主题色）')
                .onClick(async () => {
                    this.plugin.settings.primaryColor = '';
                    await this.plugin.saveSettings();
                    this.display(); // 重绘，取色器回落到主题色
                }));
```

（无需新增 import：仅用到已导入的 `Setting` 与全局 `document`/`getComputedStyle`。）

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: `build-exit:0`（`addColorPicker`/`addExtraButton` 类型正确）。

- [ ] **Step 3: 人工验收（在 Obsidian 内）**

在 Obsidian 重载插件后逐条确认（对应 spec 验收标准）：

1. 设置 → Workbuddian 出现「聊天主色调」取色器 + 恢复默认按钮。
2. 选色后，用户气泡 / 发送按钮 / Assistant 左边框 / 输入框 focus ring 即时变色，无需重启。
3. 点「恢复默认」回退到主题 accent。
4. 侧边栏面板与主编辑区面板（`在主编辑区打开大面板` 命令）均生效。
5. 重启 Obsidian 后颜色保持。

---

## Self-Review

**1. Spec coverage：**
- spec ① 数据模型 → Task 1 ✅
- spec ② CSS 回退 → Task 2 ✅
- spec ③ 注入（方案 A body 单点）→ Task 3 ✅
- spec ④ 设置页取色器 + 恢复默认 → Task 4 ✅
- spec ⑤ 测试（primaryColor 迁移）→ Task 1 Step 1 ✅
- 验收标准 1–6 → Task 4 Step 3（1–5）+ Task 1 Step 5 / Task 3 Step 6（6：迁移/构建）✅

**2. Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码与确切命令、预期输出。

**3. Type consistency：** `primaryColor: string` 贯穿 interface/DEFAULT/migrate/settings UI；`applyPrimaryColor(color: string): void` 与 `PRIMARY_COLOR_VAR` 在 Task 3 定义、Task 3（main.ts）消费，Task 4 不直接调用（走 `saveSettings` 单点，已在 Interfaces 注明）；version 5 在 Task 1 各处一致。

**4. DRY 说明：** 主色应用收敛到 `saveSettings` 唯一入口（spec ④ 原写 onChange→applyPrimaryColor，实现上收敛，行为等价：onChange 先赋值再 saveSettings，saveSettings 内应用）。
