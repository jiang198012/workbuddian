# workbuddian 阶段1·步骤 1a（重构+改名+迁移）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** 把现有 AI-Buddy 的 8 个源文件整体搬进 Claudian 式分层目录、改名 Workbuddian，行为零变化、零回归。

**Architecture:** 采用「粗搬先行」——只搬文件位置 + 改 import 路径 + 全局改名，**不拆任何文件内部**。移动阶段（Task 2–4）保持旧标识符名，只改文件位置和 import；改名阶段（Task 5）用 grep 集中改名。每个 Task 单一职责，回归可隔离。

**Tech Stack:** TypeScript、esbuild、ts-jest、Obsidian API。

## Global Constraints

- **行为零变化**：1a 只搬不改，任何行为增强/逻辑调整一律不做。
- **粗搬先行**：本计划**不做**任何文件内部拆分。以下明确推到 1a 之后的「下一波净化」，各自单独 brainstorm/plan：`chat.ts` 拆 view/render/tabs/input、`types.ts` 设置部分拆到 `features/settings`、`api.ts` 路径函数拆到 `utils`、`sendMessage` 上下文拼装抽 `core/context` 纯函数。
- **命名规则**（Task 5 集中执行）：所有 `BuddyBridge*` → `Workbuddian*`；`BuddyBridgeAPI` → `CodebuddyProvider`；CSS/标识符 `buddybridge-*` → `workbuddian-*`（含 `VIEW_TYPE_CHAT = "buddybridge-panel"` → `"workbuddian-panel"` 和 `view.ts` 里的 `querySelector('.buddybridge-...')` 字符串；通用 `markdown-*` 不改）；manifest `id: ai-buddy`→`workbuddian`、`name: AI-Buddy`→`Workbuddian`。
- **完整 Claudian 分层**，未到阶段的层（`core/runtime`、`core/security`、`core/context`、`features/inline-edit`、`i18n`、`utils`、`style`）建空占位目录。
- **保留对 `ben4202121/buddybridge` 的 MIT 致谢**（README/LICENSE/manifest.author）。
- **`styles.css` 留仓库根目录**（Obsidian 约定，与 manifest 同级），不搬进 `src/style/`；`src/style/` 仅占位。
- 每个移动 Task 结束跑 `npm test` + `npm run build` 验证；改名 Task 加 grep 残留检查 + 手动回归。频繁 commit。
- **构建配置基本不用改**：`tsconfig.include` 是 `src/**/*.ts`（覆盖新目录）、无 `paths` 别名（全用相对路径）、esbuild `entryPoints: ["src/main.ts"]`（入口不动）、jest 走默认（无 roots/testMatch）。新目录无需改这三个配置。

---

### Task 1: 建分层目录骨架 + 占位

**Files:**
- Create: `src/core/runtime/.gitkeep`、`src/core/providers/.gitkeep`、`src/core/session/.gitkeep`、`src/core/context/.gitkeep`、`src/core/security/.gitkeep`、`src/providers/codebuddy/.gitkeep`、`src/features/chat/.gitkeep`、`src/features/inline-edit/.gitkeep`、`src/features/settings/.gitkeep`、`src/shared/.gitkeep`、`src/i18n/.gitkeep`、`src/types/.gitkeep`、`src/utils/.gitkeep`、`src/style/.gitkeep`

**Interfaces:** 无（纯建目录）。后续 Task 往这些目录搬文件。

- [ ] **Step 1: 建目录与占位文件**

```bash
cd ~/claude/ai-buddy-fork
for d in core/runtime core/providers core/session core/context core/security \
         providers/codebuddy features/chat features/inline-edit features/settings \
         shared i18n types utils style; do
  mkdir -p "src/$d"
  printf '# 占位：预留给分层架构，内容见 workbuddian roadmap 对应阶段\n' > "src/$d/.gitkeep"
done
```

- [ ] **Step 2: 确认 build 仍过（源码未动）**

Run: `npm run build`
Expected: 无报错，`main.js` 正常生成（此时所有源文件还在旧位置，只是多了空目录）。

- [ ] **Step 3: 确认测试仍全绿**

Run: `npm test`
Expected: 与当前基线一致（100 passed / 2 pre-existing failed，或以实际基线为准）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold layered directory skeleton for workbuddian refactor"
```

---

### Task 2: 迁移纯逻辑叶子（atReferences / export / manager）

**Files:**
- Move: `src/chat/atReferences.ts` → `src/shared/atReferences.ts`
- Move: `src/chat/export.ts` → `src/shared/export.ts`
- Move: `src/chat/manager.ts` → `src/core/session/manager.ts`
- Modify（改 import）: `src/views/chat.ts`、`src/main.ts`、`tests/atReferences.test.ts`、`tests/export.test.ts`、`tests/manager.test.ts`
- 自身 import 改: `src/core/session/manager.ts`

**Interfaces:**
- Consumes: `src/types.ts` 的 `Conversation`/`ChatMessage`/`generateId`/`getErrorMessage`（本 Task 不动 types.ts，仍在原位）。
- Produces: 迁移后 `ConversationManager` 在 `core/session/manager.ts`、`formatConversationAsMarkdown` 在 `shared/export.ts`、`extractAtQuery`/`parseAtReferences` 在 `shared/atReferences.ts`。标识符名不变。

- [ ] **Step 1: 移动三个文件**

```bash
cd ~/claude/ai-buddy-fork
git mv src/chat/atReferences.ts src/shared/atReferences.ts
git mv src/chat/export.ts src/shared/export.ts
git mv src/chat/manager.ts src/core/session/manager.ts
```

- [ ] **Step 2: 改 `src/core/session/manager.ts` 自身 import**

`manager.ts` 现在深了一级（`src/chat/` → `src/core/session/`），到 `src/types.ts` 从 `../types` 变 `../../types`。两条 import 语句都改：

```ts
// 改前
import type { Conversation, ChatMessage } from '../types';
import { generateId, getErrorMessage } from '../types';
// 改后
import type { Conversation, ChatMessage } from '../../types';
import { generateId, getErrorMessage } from '../../types';
```

（`shared/export.ts` 的 `from '../types'` 和 `shared/atReferences.ts` 无 import——`shared/` 与原 `chat/` 同为 `src/` 一级子目录，到 `types` 都是 `../types`，**不用改**。）

- [ ] **Step 3: 改引用方 import（`views/chat.ts`、`main.ts`）**

`src/views/chat.ts` 三处：
```ts
import { ConversationManager } from '../core/session/manager';   // 原 '../chat/manager'
import { formatConversationAsMarkdown } from '../shared/export';  // 原 '../chat/export'
import { extractAtQuery, parseAtReferences } from '../shared/atReferences'; // 原 '../chat/atReferences'
```

`src/main.ts` 一处：
```ts
import { ConversationManager } from './core/session/manager';    // 原 './chat/manager'
```

- [ ] **Step 4: 改测试 import**

```ts
// tests/atReferences.test.ts
import { extractAtQuery, parseAtReferences } from '../src/shared/atReferences'; // 原 '../src/chat/atReferences'
// tests/export.test.ts
import { formatConversationAsMarkdown } from '../src/shared/export';            // 原 '../src/chat/export'
// tests/manager.test.ts
import { ConversationManager } from '../src/core/session/manager';              // 原 '../src/chat/manager'
```
（三个测试里 `from '../src/types'` 的行不变。）

- [ ] **Step 5: 验证测试 + 构建**

Run: `npm test`
Expected: `atReferences`/`export`/`manager` 三套测试全绿，总数不变。
Run: `npm run build`
Expected: 无报错（证明 `chat.ts`/`main.ts` 的 import 也改对了）。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: move pure-logic leaves to shared/ and core/session/"
```

---

### Task 3: 迁移 types 与 api（整体，不拆内部）

**Files:**
- Move: `src/types.ts` → `src/types/index.ts`
- Move: `src/api.ts` → `src/providers/codebuddy/index.ts`
- Modify（改 import）: `src/providers/codebuddy/index.ts`（自身）、`src/views/chat.ts`、`src/main.ts`、`tests/api.test.ts`
- 自身 import 改: `src/providers/codebuddy/index.ts`

**Interfaces:**
- Consumes: 无新增。
- Produces: 所有原 `types.ts` 导出现于 `src/types/index.ts`（`import '../types'` 因 Node 目录 index 解析**仍然有效**）；原 `BuddyBridgeAPI` 及 `parseStreamLine` 等现于 `src/providers/codebuddy/index.ts`。标识符名本 Task 不变。

- [ ] **Step 1: 移动两个文件**

```bash
cd ~/claude/ai-buddy-fork
git mv src/types.ts src/types/index.ts
git mv src/api.ts src/providers/codebuddy/index.ts
```

- [ ] **Step 2: types 的 import 全部无需改（验证性说明）**

`types.ts` → `types/index.ts` 后，所有 `from '../types'` / `from './types'` / 测试的 `from '../src/types'` 都被 Node 解析为该目录的 `index.ts`，**字符串不变**。无需改动 `shared/export.ts`、`core/session/manager.ts`、`views/chat.ts`、`main.ts`、`tests/types.test.ts`、`tests/export.test.ts`、`tests/manager.test.ts` 里指向 types 的 import。

- [ ] **Step 3: 改 `providers/codebuddy/index.ts` 自身 import**

原 `api.ts` 在 `src/`，import types 是 `'./types'`；现在在 `src/providers/codebuddy/`，到 `src/types/` 是 `'../../types'`：

```ts
import { getErrorMessage, getString, isObject } from '../../types';  // 原 './types'
```
（注：`getErrorMessage` 是 explore 查出的当前死导入，1a 不动它——清理留净化波。）

- [ ] **Step 4: 改引用方 import（`views/chat.ts`、`main.ts`）**

`src/views/chat.ts`：
```ts
import { BuddyBridgeAPI } from '../providers/codebuddy';  // 原 '../api'
```
`src/main.ts`：
```ts
import { BuddyBridgeAPI } from './providers/codebuddy';   // 原 './api'
```

- [ ] **Step 5: 改测试 import**

```ts
// tests/api.test.ts —— 第二条 import（那串 BuddyBridgeAPI, parseStreamLine, ... 的长 import）
import { BuddyBridgeAPI, parseStreamLine, parseMessageBlock, blockToChunk, parseStreamEvent, isWindowsWrapper, isBareFallback, needsWindowsShell, resolveCodebuddyPath, findNodeExecutable, type StreamChunk } from '../src/providers/codebuddy'; // 原 '../src/api'
```

- [ ] **Step 6: 验证测试 + 构建**

Run: `npm test`
Expected: `types`/`api` 两套测试全绿，总数不变。
Run: `npm run build`
Expected: 无报错。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: move types to types/ and api to providers/codebuddy/"
```

---

### Task 4: 迁移 UI（chat → features/chat/view.ts、settings → features/settings/tab.ts）

**Files:**
- Move: `src/views/chat.ts` → `src/features/chat/view.ts`
- Move: `src/settings/tab.ts` → `src/features/settings/tab.ts`
- Modify（改 import）: `src/features/chat/view.ts`（自身）、`src/features/settings/tab.ts`（自身）、`src/main.ts`
- `main.ts` 保持在 `src/main.ts`（141 行，瘦身属拆分，推到净化波），仅改指向 chat/settings 的 import。

**Interfaces:**
- Consumes: `core/session/manager`、`providers/codebuddy`、`types`、`shared/export`、`shared/atReferences`（均已在前序 Task 就位）。
- Produces: `WorkbuddianChatView`（本 Task 仍名 `BuddyBridgeChatView`）+ `VIEW_TYPE_CHAT` 现于 `features/chat/view.ts`；设置面板类现于 `features/settings/tab.ts`。无自动化测试，靠手动验证。

- [ ] **Step 1: 移动两个 UI 文件**

```bash
cd ~/claude/ai-buddy-fork
git mv src/views/chat.ts src/features/chat/view.ts
git mv src/settings/tab.ts src/features/settings/tab.ts
```

- [ ] **Step 2: 改 `features/chat/view.ts` 自身 import（深了一级，全部 `../` → `../../`）**

`chat.ts` 从 `src/views/`（一级）搬到 `src/features/chat/`（两级），所有相对 import 多一级：
```ts
import { ConversationManager } from '../../core/session/manager';  // 原 '../core/session/manager'
import { BuddyBridgeAPI } from '../../providers/codebuddy';        // 原 '../providers/codebuddy'
import { getErrorMessage, type Conversation, ChatMessage, type BuddyBridgeSettings } from '../../types'; // 原 '../types'
import { formatConversationAsMarkdown } from '../../shared/export';        // 原 '../shared/export'
import { extractAtQuery, parseAtReferences } from '../../shared/atReferences'; // 原 '../shared/atReferences'
```

- [ ] **Step 3: 改 `features/settings/tab.ts` 自身 import**

```ts
import type BuddyBridgePlugin from '../../main';  // 原 '../main'
```

- [ ] **Step 4: 改 `main.ts` 指向 chat/settings 的 import**

```ts
import { BuddyBridgeChatView, VIEW_TYPE_CHAT } from './features/chat/view';  // 原 './views/chat'
import { BuddyBridgeSettingTab } from './features/settings/tab';             // 原 './settings/tab'
```
（`main.ts` 其余 import——`./providers/codebuddy`、`./core/session/manager`、`./types`——在 Task 2/3 已改，不动。）

- [ ] **Step 5: 构建**

Run: `npm run build`
Expected: 无报错，`main.js` 生成。

- [ ] **Step 6: 装入真实 vault（当前仍是 ai-buddy 目录）并手动验证 UI**

```bash
VAULT="<vault>"
cp main.js "$VAULT/.obsidian/plugins/ai-buddy/main.js"
```
重载 Obsidian，手动确认：聊天面板能开、发消息、多标签/搜索/改名、设置面板 6 项都在且能改。**此时功能应与重构前完全一致**（尚未改名，仍叫 AI-Buddy）。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: move chat view to features/chat and settings to features/settings"
```

---

### Task 5: 全局改名 Workbuddian + manifest + vault 目录 + 完整回归

**Files:**
- Modify: 全库 `src/**/*.ts` 里的 `BuddyBridge*` 标识符、`buddybridge-` 字符串；`styles.css`；`manifest.json`；`package.json`；`README.md`
- 实机操作: vault 插件目录 `ai-buddy` → `workbuddian` + 迁移 `data.json`

**Interfaces:**
- Produces: 全部对外/对内名统一为 workbuddian；插件以新 id `workbuddian` 装入 vault。

**⚠️ 本 Task 含实机 vault 操作（改目录、迁移用户数据），SDD 执行到 Step 5 前必须暂停、向用户报告并取得确认，与之前装 vault 同规格。**

- [ ] **Step 1: 改标识符名（grep 驱动，逐个确认）**

先看全部出现点：
```bash
cd ~/claude/ai-buddy-fork
grep -rn "BuddyBridge" src
```
替换规则（在 `src/**/*.ts` 内）：
- `BuddyBridgeAPI` → `CodebuddyProvider`
- `BuddyBridgePlugin` → `WorkbuddianPlugin`
- `BuddyBridgeChatView` → `WorkbuddianChatView`
- `BuddyBridgeSettingTab` → `WorkbuddianSettingTab`
- `BuddyBridgeSettings` → `WorkbuddianSettings`
- 裸 `BuddyBridge`（Notice/getDisplayText 等用户可见文案，如"BuddyBridge 聊天"）→ `Workbuddian`

用 in-place 替换（先长名后短名，避免 `BuddyBridge` 先替导致 `BuddyBridgeAPI` 断裂——**顺序：先替所有带后缀的，最后替裸词**）：
```bash
for f in $(grep -rl "BuddyBridge" src); do
  python3 - "$f" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
for a,b in [("BuddyBridgeAPI","CodebuddyProvider"),
            ("BuddyBridgePlugin","WorkbuddianPlugin"),
            ("BuddyBridgeChatView","WorkbuddianChatView"),
            ("BuddyBridgeSettingTab","WorkbuddianSettingTab"),
            ("BuddyBridgeSettings","WorkbuddianSettings"),
            ("BuddyBridge","Workbuddian")]:
    s=s.replace(a,b)
open(p,'w',encoding='utf-8').write(s)
PY
done
```

- [ ] **Step 2: 改 CSS/标识符前缀 `buddybridge-` → `workbuddian-`**

范围：`styles.css`（111 处 class）+ `src/features/chat/view.ts` 里的 class 字符串（`addClass`/`createEl`/`querySelector('.buddybridge-...')`）+ `VIEW_TYPE_CHAT = "buddybridge-panel"`。**不改** `markdown-*`。
```bash
grep -rln "buddybridge-" src styles.css
for f in styles.css $(grep -rl "buddybridge-" src); do
  python3 - "$f" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
open(p,'w',encoding='utf-8').write(s.replace("buddybridge-","workbuddian-"))
PY
done
```

- [ ] **Step 3: 改 manifest.json / package.json**

`manifest.json`：`id` → `"workbuddian"`、`name` → `"Workbuddian"`、`description` 重写为 workbuddian 的功能描述、`author` 改为作者本人、`authorUrl` 指向 workbuddian 仓库（保留对 buddybridge 的致谢放 README/LICENSE）。
`package.json`：`name` → `"workbuddian"`。

- [ ] **Step 4: 构建 + 零残留验证**

Run: `npm run build`
Expected: 无报错。
```bash
grep -rn "BuddyBridge" src && echo "❌ 有残留" || echo "✅ 无 BuddyBridge 残留"
grep -rn "buddybridge-" src styles.css && echo "❌ 有残留" || echo "✅ 无 buddybridge- 残留"
```
Expected: 两行都打印 ✅。
Run: `npm test`
Expected: 全绿（改名不涉及被测纯逻辑的行为）。

- [ ] **Step 5: 【实机·需先确认】vault 目录改名 + 数据迁移**

**执行前暂停向用户确认。** 然后：
```bash
VAULT="<vault>"
PLUG="$VAULT/.obsidian/plugins"
mkdir -p "$PLUG/workbuddian"
# 迁移用户数据（会话历史/设置），保留而非重置
[ -f "$PLUG/ai-buddy/data.json" ] && cp "$PLUG/ai-buddy/data.json" "$PLUG/workbuddian/data.json"
cp main.js manifest.json styles.css "$PLUG/workbuddian/"
# 旧目录留存备份，先禁用旧插件；确认新插件正常后再删旧目录
```
在 Obsidian 设置里启用 "Workbuddian"，确认历史对话/设置都在（data.json 迁移成功）。

- [ ] **Step 6: 完整手动回归清单（逐项过，零回归）**

对照 spec 的 16 项回归清单逐一验证（面板打开/主编辑区大面板/多轮流式/思考块工具卡/Markdown/多标签/持久化/改名/导出/搜索/@引用/停止生成/设置 6 项/上下文注入/Mac 路径发现/模型参数）。任何一项与改名前行为不一致 = 回归，需修。

- [ ] **Step 7: 更新 README/LICENSE 致谢 + Commit**

README 顶部与 LICENSE 保留 `ben4202121/buddybridge`（MIT）的来源与版权声明。
```bash
git add -A && git commit -m "refactor: rename BuddyBridge/AI-Buddy to Workbuddian across code, styles, manifest"
```

---

## 说明：本计划对 spec 的调整

spec 的目录图把「文件内部拆分」（chat 拆 4 块、types 拆设置、api 拆 utils、context 抽纯函数）算在 1a 内。经与真实代码核对并经你确认，这些高风险拆分**推到紧随 1a 的下一波"净化"**单独做（理由：拆 681 行紧耦合 ItemView 保持零行为变化风险大、types 拆分有循环依赖）。1a 因此是纯粹的「搬进分层 + 改名 + 零回归」，产出一个目录结构对齐 claudian、但文件内部暂未细拆的可运行插件。分层目录已全部建好占位，下一波往里填。
