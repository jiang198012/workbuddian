# 设置页重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把设置页 7 项按职责分三组，并加「重置为默认」按钮（二次点击确认）。

**Architecture:** 纯 UI 重排 `tab.ts` 的 `display()` + 底部重置按钮；`main.ts` 把 onload 里 4 行 provider 接线抽成 `applySettingsToApi()` 供 onload 与重置复用。无新数据模型、无迁移。

**Tech Stack:** TypeScript、Obsidian Setting API（`setHeading`/`addButton`/`setWarning`）、esbuild、Jest（不覆盖 UI，仅回归）。

## Global Constraints

- 分组标题固定三个：`CodeBuddy 连接` / `上下文注入` / `外观`（另加 `重置` 标题段）。
- 重置二次确认：首点文案→`确认重置？`+warning+3000ms 复位；计时内再点执行。
- 重置行为顺序固定：`settings={...DEFAULT_SETTINGS}` → `applySettingsToApi()` → `saveSettings()` → `display()`。
- 无新设置字段、不改 `types.ts` 数据模型/版本。
- **本仓库非 git**：不做 `git commit`；每个 Task 以「构建/测试」收尾。
- **部署铁律**：改动只 build 到开发目录 `main.js` 不会生效；必须部署到 Obsidian 实际加载点（iCloud vault「我的工作」`.obsidian/plugins/workbuddian/`），见 Task 3。
- 命令：`npm run build`（tsc + esbuild）；`npx jest`（全量回归，须保持 113 绿）。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/main.ts` | 抽 `applySettingsToApi()`，onload 复用 | Modify |
| `src/features/settings/tab.ts` | 分组重排 + 重置按钮 | Modify |

---

## Task 1: main.ts 抽取 applySettingsToApi()

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `WorkbuddianPlugin.applySettingsToApi(): void` —— 把 `settings` 的 path/timeout/node/model 灌进 `this.api`

- [ ] **Step 1: onload 内 4 行替换为方法调用**

把 `onload` 中这段：

```ts
            this.api = new CodebuddyProvider();
            this.api.setCodebuddyPath(this.settings.codebuddyPath);
            this.api.setTimeout(this.settings.cliTimeoutMinutes * 60_000);
            this.api.setNodePath(this.settings.nodePath);
            this.api.setModel(this.settings.model);
```

改为：

```ts
            this.api = new CodebuddyProvider();
            this.applySettingsToApi();
```

- [ ] **Step 2: 新增方法**

在 `onunload()` 方法之后插入：

```ts
    /** 把当前 settings 灌入 provider（onload 与「重置为默认」复用） */
    applySettingsToApi() {
        this.api.setCodebuddyPath(this.settings.codebuddyPath);
        this.api.setTimeout(this.settings.cliTimeoutMinutes * 60_000);
        this.api.setNodePath(this.settings.nodePath);
        this.api.setModel(this.settings.model);
    }
```

- [ ] **Step 3: 构建验证**

Run:

```bash
cd /Users/jiang/claude/workbuddian && npm run build
grep -c "applySettingsToApi" main.js
```

Expected: `build-exit:0`；grep ≥ 1（定义 + 调用打进 bundle）。

---

## Task 2: tab.ts 分组重排 + 重置按钮

**Files:**
- Modify: `src/features/settings/tab.ts`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`（types）、`plugin.applySettingsToApi()`（Task 1）、`plugin.saveSettings()`

- [ ] **Step 1: 更新 import**

把首行：

```ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import type WorkbuddianPlugin from '../../main';
```

改为：

```ts
import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type WorkbuddianPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../../types';
```

- [ ] **Step 2: 用下面完整实现替换整个 `display()` 方法**

（逐块移动原有 Setting + 加 3 个分组标题 + 底部重置段）

```ts
    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ===== CodeBuddy 连接 =====
        new Setting(containerEl).setName('CodeBuddy 连接').setHeading();

        new Setting(containerEl)
            .setName('CodeBuddy 路径')
            .setDesc('codebuddy 可执行文件路径。如 WorkBuddy 自定义安装，路径通常为：安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy（右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录）')
            .addText(text => text
                .setPlaceholder('WorkBuddy安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy')
                .setValue(this.plugin.settings.codebuddyPath)
                .onChange(async (value) => {
                    this.plugin.settings.codebuddyPath = value;
                    this.plugin.api.setCodebuddyPath(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('手动指定 Node.js 路径')
            .setDesc('留空则自动探测。如果自动探测失败（例如非标准安装路径），可以在这里手动指定 node 可执行文件的完整路径')
            .addText(text => text
                .setPlaceholder('留空 = 自动探测')
                .setValue(this.plugin.settings.nodePath)
                .onChange(async (value) => {
                    this.plugin.settings.nodePath = value;
                    this.plugin.api.setNodePath(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('CLI 超时时长（分钟）')
            .setDesc('CodeBuddy CLI 单次响应最长等待时间，超过会强制中断')
            .addText(text => text
                .setPlaceholder('5')
                .setValue(String(this.plugin.settings.cliTimeoutMinutes))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.cliTimeoutMinutes = num;
                        this.plugin.api.setTimeout(num * 60_000);
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('模型')
            .setDesc('CodeBuddy CLI 使用的模型')
            .addDropdown(dropdown => dropdown
                .addOptions(MODEL_OPTIONS)
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    this.plugin.api.setModel(value);
                    await this.plugin.saveSettings();
                }));

        // ===== 上下文注入 =====
        new Setting(containerEl).setName('上下文注入').setHeading();

        new Setting(containerEl)
            .setName('注入 Vault 上下文')
            .setDesc('开启后，每次发送消息都会自动附上当前 Vault 路径，让 AI 基于 Vault 中的文件回答问题')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.injectVaultContext)
                .onChange(async (value) => {
                    this.plugin.settings.injectVaultContext = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('注入当前笔记链接')
            .setDesc('开启后，每次发送消息都会附上当前正在查看的笔记标题和路径（不包含正文内容）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.injectCurrentNoteLink)
                .onChange(async (value) => {
                    this.plugin.settings.injectCurrentNoteLink = value;
                    await this.plugin.saveSettings();
                }));

        // ===== 外观 =====
        new Setting(containerEl).setName('外观').setHeading();

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
                        await this.plugin.saveSettings();
                    });
            })
            .addExtraButton(btn => btn
                .setIcon('rotate-ccw')
                .setTooltip('恢复默认（跟随主题色）')
                .onClick(async () => {
                    this.plugin.settings.primaryColor = '';
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // ===== 重置 =====
        new Setting(containerEl).setName('重置').setHeading();

        new Setting(containerEl)
            .setName('重置为默认')
            .setDesc('清空所有自定义设置，恢复到插件默认值（包括路径、模型、注入开关、主色调）。')
            .addButton(btn => {
                btn.setButtonText('重置为默认').setWarning();
                let armed = false;
                let timer: number | null = null;
                btn.onClick(async () => {
                    if (!armed) {
                        armed = true;
                        btn.setButtonText('确认重置？');
                        timer = window.setTimeout(() => {
                            armed = false;
                            btn.setButtonText('重置为默认');
                        }, 3000);
                        return;
                    }
                    if (timer !== null) window.clearTimeout(timer);
                    this.plugin.settings = { ...DEFAULT_SETTINGS };
                    this.plugin.applySettingsToApi();
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice('已重置为默认设置');
                });
            });
    }
```

- [ ] **Step 3: 构建 + 全量回归**

Run:

```bash
cd /Users/jiang/claude/workbuddian
npm run build && echo "build-ok"
npx jest > /tmp/wb_22_test.log 2>&1; echo "test-exit:$?"; grep -E "Tests:" /tmp/wb_22_test.log
```

Expected: `build-ok`；`test-exit:0`；`Tests: 113 passed`。

---

## Task 3: 部署到 iCloud vault + 人工验收

**Files:** 无源码改动（部署 + 验证）

- [ ] **Step 1: 部署构建产物到 Obsidian 加载点**

Run（用 `glob *` 通配 vault 名避开中文路径；`in` 校验为可信通道）:

```bash
python3 - <<'PY'
import glob, os, shutil
dev='/Users/jiang/claude/workbuddian'
docs='/Users/jiang/Library/Mobile Documents/iCloud~md~obsidian/Documents'
wb=glob.glob(f'{docs}/*/.obsidian/plugins/workbuddian'); assert len(wb)==1, wb
dst=wb[0]
for f in ['main.js','styles.css','manifest.json']:
    shutil.copy2(os.path.join(dev,f), os.path.join(dst,f))
mj=open(os.path.join(dst,'main.js'),encoding='utf-8').read()
print('部署完成 ->', dst)
print('main.js 含 applySettingsToApi:', 'applySettingsToApi' in mj)
PY
```

Expected: `部署完成`；`main.js 含 applySettingsToApi: True`。

- [ ] **Step 2: Obsidian 人工验收**

`Cmd+R` 重载 Obsidian 后确认：
1. 设置页显示三个分组标题：CodeBuddy 连接 / 上下文注入 / 外观，7 项各归其位。
2. 底部「重置为默认」按钮；点一次变「确认重置？」，3 秒内不点则复位；计时内再点执行。
3. 重置后：路径清空、超时回 5、Node 路径清空、模型回 auto、两个注入开关回默认、主色回退主题。
4. 重置后设置立即生效（发消息用默认 model/path）。

---

## Self-Review

**1. Spec coverage：** ①分组→Task2；②重置→Task2；③抽 `applySettingsToApi`→Task1；测试/验收→Task2 Step3 + Task3。部署（spec 未列但 Global Constraints 铁律）→Task3。

**2. Placeholder scan：** 无 TBD；每步含完整代码/命令/预期。

**3. Type consistency：** `applySettingsToApi(): void` Task1 定义、Task2 调用一致；`DEFAULT_SETTINGS` 从 types 引入；`window.setTimeout` 返回 `number`（DOM lib，与 `timer: number | null` 一致）。

**4. 复用正确性：** 重置调 `applySettingsToApi()` 灌 provider + `saveSettings()`（内部 `setCodebuddyPath` + `applyPrimaryColor('')` 回退主色），覆盖全部 setter，无遗漏。
