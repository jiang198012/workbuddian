# 文档全面更新与搜索增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让中英文 README、`llms.txt`、`manifest.json`/`package.json` 描述、`docs/images/README.md` 与 2.6.22 的实际功能一致，并让搜索 Hermes 等关键词能找到本插件。

**Architecture:** 先写一个只读的文档核对脚本（放在会话临时目录，不提交），把规格里的事实和禁用说法变成可重复运行的检查；再按「中文 README → 英文 README → 其他描述文件 → 插件目录描述」的顺序改写，每一步跑核对脚本通过后再提交。

**Tech Stack:** Markdown；Node.js（核对脚本，ESM，无第三方依赖）；git；community.obsidian.md 开发者后台（用户登录）。

**Spec:** `docs/superpowers/specs/2026-11-22-docs-refresh-design.md`

## Global Constraints

- 事实以 2.6.22（提交 `d6a2cb7` 之后的 `main`）代码为准；界面名称取自 `src/i18n/index.ts`，中文文档用 `zh`，英文文档用 `en`。
- 中文为主要读者，英文 README 与中文内容对等（章节、功能、设置、FAQ 一一对应）。
- 未验证项照实写：Windows 上的 Hermes、ACP 黑窗口、Windows 上 `gateway.pid` 位置均为未验证。
- 不堆砌关键词；Hermes、Hermes Agent、CodeBuddy、WorkBuddy、AI agent 只出现在自然语句里。
- 目录 / manifest 描述：英文、动词开头、句号结尾、≤ 250 字符、含 “Hermes”。采用 B 版原文：`Chat with a local Hermes Agent or the WorkBuddy/CodeBuddy CLI as an AI agent in your vault: streaming replies, tool-call cards, @-note references, attachments, slash commands, inline edit with diff, export and search.`
- 市场链接统一为 `https://community.obsidian.md/plugins/workbuddian`（旧地址 `https://obsidian.md/plugins?id=workbuddian` 会 302 到这里）。
- 不改：`docs/` 下的报告 / 记录 / 设计文档、CHANGELOG 已有条目、`CLAUDE.md`、`提示词-授予Vault读写权限.md`、GitHub 仓库简介与 topics、功能代码。
- 工作区里有他人未提交的改动（`main.js`、`src/features/chat/input.ts`、`src/i18n/index.ts`、`styles.css`、`src/shared/toolSummary.ts`、`tests/toolSummary.test.ts`、`docs/issue-10-native-async-contract-2026-10-09.md`）：一律不动、不暂存；每次 `git add` 只写本任务的文件路径。也不要把未提交的「工具摘要」功能写进文档。
- 推送、发版、修改插件目录公开描述都需用户另行同意；目录描述的最终文本发布前再给用户确认一次。

## Review Focus

1. **改结构后锚点失效**：`README.en.md`、`llms.txt`、其他文档里指向 README 章节（如 `README.md#快速开始`）的链接，在新结构下必须仍指向存在的标题。核对脚本检查所有相对链接的文件和锚点。
2. **中英文不对等**：一方列了某个命令 / 设置 / 斜杠命令而另一方没有。核对脚本对两份 README 分别检查同一份事实清单。
3. **未重写的段落里残留旧说法**：例如安全章节、FAQ 里的「只选 WorkBuddy 内置 CLI」「gateway 纯对话」「617」。核对脚本对全部目标文件做禁用说法扫描。
4. **GitHub 渲染问题**：徽章参数错误、HTML 与 Markdown 混用导致表格或图片不显示。核对脚本检查 shields 徽章路径段格式；提交后在 GitHub 上看一次渲染。
5. **描述超长或格式不合规**：目录 / manifest / package 描述超过 250 字符、不以动词开头、缺 Hermes。核对脚本检查。

---

### Task 1: 文档核对脚本

**Files:**
- Create: `/private/tmp/claude-501/-Users-jiang-claude-workbuddian/a52467cd-9f81-46ee-ac0a-70a7bbfbc3a2/scratchpad/doccheck.mjs`（不提交）

**Interfaces:**
- Produces: `node <scratchpad>/doccheck.mjs [--only=zh|en|other]`，在仓库根目录运行；逐条打印 `PASS`/`FAIL <规则> <文件:行>`；有任一 FAIL 时退出码 1。

- [ ] **Step 1: 写脚本，规则如下**

  - **禁用说法**（`README.md`、`README.en.md`、`llms.txt`、`docs/images/README.md` 全文，大小写不敏感）：`617`、`仅选择 WorkBuddy 内置`、`不会选择独立 npm`、`never switches to a standalone`、`gateway 纯对话`、`提示词-授予Vault读写权限`、`精简入口`、`condensed entry`、`≥ 5.0.5`、`obsidian.md/plugins?id=`、`Obsidian-plugin-market`、`环境初始化`。
  - **必须出现的事实**：从 `src/i18n/index.ts` 读取以下键的 `zh`（查 `README.md`）和 `en`（查 `README.en.md`）文案，逐个要求出现：12 个命令 `cmd.openChat` `cmd.openChatMainPane` `cmd.newChat` `cmd.searchChats` `cmd.exportChat` `cmd.exportAllChats` `cmd.editInstruction` `cmd.openSettings` `cmd.codebuddyLogin` `cmd.inlineEdit` `cmd.inlineEditFloating` `warmup.install`；设置项 `settings.language` `backend.title` `hermes.mode` `hermes.cliPath` `hermes.gatewayUrl` `hermes.apiKey` `settings.path` `settings.login` `settings.node` `settings.timeout` `settings.thoughtLevel` `settings.injectVault` `settings.injectNote` `settings.autoTitle` `settings.pastedKeep` `settings.inputAutoResize` `settings.primary` `settings.contextWindow` `settings.viewLogs` `plugins.title`。
  - **必须出现的字面量**（两份 README 都查）：`/clear` `/compact` `/context` `/cost` `/effort` `/resume` `/status`、`HERMES_HOME`、`%LOCALAPPDATA%\hermes`、`~/.hermes`、`@tencent-ai/codebuddy-code`、`Hermes Agent`、`community.obsidian.md/plugins/workbuddian`、`CHANGELOG.md`。
  - **权限模式**：两份 README 分别含 `perm.default`、`perm.plan`、`perm.bypassPermissions` 的 `zh` / `en` 文案（中文「默认（每步询问）」「计划模式（只读不改）」「完全访问」；英文 `Default (ask each step)`、`Plan (read-only)`、`Full access`）。
  - **链接**：四个文件里所有相对链接 `](path)` / `](path#anchor)` 的目标文件必须存在；带锚点的按 GitHub 规则（小写、去标点、空格转 `-`，中文保留）生成标题 slug，锚点必须存在。
  - **描述**：`manifest.json` 与 `package.json` 的 `description` 等于 Global Constraints 里的 B 版原文；长度 ≤ 250；以大写动词开头；以 `.` 结尾；含 `Hermes`。
  - **首屏**：`README.md` 与 `README.en.md` 的前 40 行内同时出现 `Hermes`、`CodeBuddy`、`WorkBuddy`，以及「仅桌面端」/`Desktop only`。

- [ ] **Step 2: 在当前未改的文档上运行，确认能抓到问题**

  Run: `node <scratchpad>/doccheck.mjs`
  Expected: 退出码 1，至少出现 `617`、`仅选择 WorkBuddy 内置`、`精简入口`、`Obsidian-plugin-market`、描述不等于 B 版、若干命令 / 设置缺失的 FAIL。

### Task 2: 重写中文 README

**Files:**
- Modify: `README.md`（整体重写）
- Modify（仅在必要时）: `CHANGELOG.md`（只追加 README 独有、CHANGELOG 缺失的事实；已核对 Issue #10 的 50 秒 / 640 KiB、本地连接扩展、`missing-key` 等均已在 CHANGELOG）

**Interfaces:**
- Consumes: Task 1 的 `doccheck.mjs --only=zh`
- Produces: 新的中文章节标题（英文 README 按同一顺序对应；`llms.txt` 只链接这些标题）。章节顺序与名称固定为：`功能亮点`、`安装`、`快速开始`（下设 `选择后端`、`官方 CodeBuddy CLI`、`WorkBuddy 桌面端`、`Hermes Agent`、`发送第一条消息`）、`使用方法`、`设置`、`自动发现`、`安全与权限`、`故障排查`、`最新版本`、`开发`、`相关项目`、`支持`、`License`。

- [ ] **Step 1: 按规格 7.1 和第 6 节重写**

  要点（细节见规格 6.1–6.3）：首段写清是什么、两种后端、仅桌面端；徽章与链接改用 community.obsidian.md 地址；快速开始三条路（官方 CLI 需 Node.js + 「登录 CodeBuddy」；WorkBuddy 桌面端保持登录运行、留空自动检测、不支持一键登录、原生通路限制注明「WorkBuddy 5.7.7 上测得」；Hermes Agent 留空自动发现、ACP 完整版与 HTTP 轻量模式）；使用方法补齐 6.2 的功能；设置表按 6.3；自动发现写 CLI 顺序（官方 CLI 优先 → WorkBuddy 内置 CLI）、Hermes CLI 与配置目录顺序、Node；安全与权限去掉版本史，照实写「安装 WorkBuddy 本地连接扩展」命令（写入 `<WorkBuddy 配置目录>/extensions/workbuddian-warmup`，确认后才安装，通常不需要）；FAQ 按规格第 11 项；最新版本只写 2.6.22 一两行 + `CHANGELOG.md` 链接；开发里测试数写 807；保留顶部 HTML 注释元数据并加入 Hermes Agent。截图与 GIF 保持原文件，明显过时的在报告里记后续项。

- [ ] **Step 2: 运行核对**

  Run: `node <scratchpad>/doccheck.mjs --only=zh`
  Expected: 退出码 0，全部 PASS。

- [ ] **Step 3: 提交**

  ```bash
  git add README.md
  git commit -m "docs: rewrite the Chinese README around current features and both backends"
  ```
  （若改了 CHANGELOG，一并 `git add CHANGELOG.md`。）

### Task 3: 重写英文 README

**Files:**
- Modify: `README.en.md`（整体重写，与中文同构）

**Interfaces:**
- Consumes: Task 2 的章节顺序；`doccheck.mjs --only=en`
- Produces: 英文章节标题：`Features`、`Installation`、`Quick start`（`Choose a backend`、`Official CodeBuddy CLI`、`WorkBuddy desktop app`、`Hermes Agent`、`Send your first message`）、`Usage`、`Settings`、`Auto-discovery`、`Security and permissions`、`Troubleshooting`、`Latest release`、`Development`、`Related projects`、`Support`、`License`。

- [ ] **Step 1: 按 Task 2 的中文内容逐节翻译改写**，界面名称用 `en` 文案；删除「canonical README is in Chinese / condensed entry point」的说法与指向 `README.md#快速开始` 的链接。

- [ ] **Step 2: 运行核对**

  Run: `node <scratchpad>/doccheck.mjs --only=en`
  Expected: 退出码 0。

- [ ] **Step 3: 提交**

  ```bash
  git add README.en.md
  git commit -m "docs: rewrite the English README to match the Chinese one"
  ```

### Task 4: 其他描述文件

**Files:**
- Modify: `llms.txt`、`docs/images/README.md`
- Modify: `manifest.json:5`（`description`）、`package.json:4`（`description`）

**Interfaces:**
- Consumes: Task 2/3 的章节标题（`llms.txt` 的链接只指向它们）；`doccheck.mjs --only=other`

- [ ] **Step 1: 改写 `llms.txt`**：标题行与首段写明 Hermes Agent 与 CodeBuddy / WorkBuddy 双后端；英文 README 不再称「精简入口」；删除环境初始化提示词和「≥ 5.0.5」；链接改到新章节。
- [ ] **Step 2: 改写 `docs/images/README.md`**：按新 README 首屏的图片布局说明。
- [ ] **Step 3: `manifest.json` 与 `package.json` 的 `description` 改为 B 版原文**（`package-lock.json` 不需要改）。
- [ ] **Step 4: 运行全部核对与构建**

  Run: `node <scratchpad>/doccheck.mjs && npm run build`
  Expected: 核对退出码 0；构建成功（只确认 manifest/package 仍是合法 JSON、构建不受影响）。构建会重写 `main.js`：**不要暂存 `main.js`**（其中含他人未提交的改动）。

- [ ] **Step 5: 提交**

  ```bash
  git add llms.txt docs/images/README.md manifest.json package.json
  git commit -m "docs: mention Hermes in llms.txt, manifest and package descriptions"
  ```

### Task 5: 插件目录描述（需用户在场）

**Files:** 无（community.obsidian.md 开发者后台）

- [ ] **Step 1: 把最终描述文本（B 版原文）发给用户确认。** 用户确认前不发布。
- [ ] **Step 2: 在内置浏览器打开 `https://community.obsidian.md/account/plugins/workbuddian`**（地址以后台实际为准）。出现登录页时请用户自行登录，不代登录。
- [ ] **Step 3: 替换描述为 B 版原文，查看可选标签，有与 Hermes / AI agent 相关的就勾选，点 Publish。**
- [ ] **Step 4: 核对**：后台显示的描述与原文一致；`gh api repos/obsidianmd/obsidian-releases/contents/community-plugins.json -H "Accept: application/vnd.github.raw"` 中 `workbuddian` 条目的 description 更新（可能有延迟，记录核对时间）；在 community.obsidian.md 搜索 `hermes`，结果中出现 Workbuddian。延迟未生效时如实记录，不宣称已完成。

### Task 6: 收尾核对

- [ ] **Step 1: 全量核对**

  Run: `node <scratchpad>/doccheck.mjs && npm test`
  Expected: 核对退出码 0；`npm test` 全部通过（文档改动不应影响测试；若因他人未提交的代码失败，如实报告，不修改他人代码）。

- [ ] **Step 2: 列出本计划的提交与未完成项**（推送、目录描述生效情况、过时截图），交用户决定是否推送。
