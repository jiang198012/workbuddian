# Issue #10：WorkBuddy 原登录态接入验证

验证时间：2026-09-29；关联 [Issue #10](https://github.com/jiang198012/workbuddian/issues/10)。

## 结论

**本机 macOS 的“Obsidian → WorkBuddy 原账号”核心调用已恢复：真实对话、Vault 读写、插件重载后续聊均通过。修复纳入 2.6.11，Windows 实机待验证，Issue #10 保持开放。**

插件通过正在运行的 WorkBuddy 自有 sidecar 创建独立 Vault worker，并复用 HTTP/SSE ACP 通路。需原 WorkBuddy 桌面端保持运行且已登录；没有改用新账号、独立 API key 或云端任务。连续回复夹带旧消息的问题已修复，并完成真实协议对照验证。

## 实际验收

环境：macOS、WorkBuddy 5.6.2、Obsidian 1.13.7；使用仓库内本地 `demo-vault`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 插件通过原 WorkBuddy 账号对话 | PASS（Obsidian 真实界面） | 在 demo-vault 收到 `WB10_OBSIDIAN_OK` |
| worker 实际工作目录 | PASS（本机检查） | `lsof` 已核对真实 cwd 为 demo-vault，不以提示词或 RPC 入参代替实际目录证据 |
| Vault 文件读取 | PASS（真实界面） | Read 读取合成文件 `Issue10-local-acceptance.md`，答出提示词中未提供的 `WB10_VAULT_7E42` |
| 文字批准后的 Vault 写入 | PASS（真实界面及文件字节） | 文字批准后 Write 创建 `Issue10-output-acceptance.md`；shell 核对内容精确为 `WB10_VAULT_7E42\n`，16 bytes |
| 协议审批卡及拒绝操作 | 待验 | GUI 未独立验收；文字批准后的写入不等于协议审批卡或拒绝路径通过 |
| 重载后历史恢复 | PASS（Obsidian 真实界面） | 关闭插件后确认旧自有 worker PID 已消失；启用最终构建后，在原会话询问先前暗号（提示词不含暗号），准确回复 `WB10_MEMORY_9C31`，无旧回复前缀 |
| 连续回复不夹带旧消息 | PASS（真实协议及定向回归） | 正常持久化 worker 第二轮原始流含旧 21 字符＋新 22 字符，修复后仅交付新 22 字符；旧块 messageId 相同且没有 history 标记，两轮均 end_turn；探针自有 worker 已清理 |
| Windows 实机 | 待验 | 本轮真实界面证据仅覆盖 macOS |
| 账单与余额差额 | 未核对 | 未切换账号或额度来源，但未以账单、余额差额验证实际扣费 |

## 自动验证记录

- 修复期间完成定向回归；发布统计以以下当前仓库全量验证为准，不计入本机旧工作树副本。
- 覆盖 ACP client/session、provider 回调、API、CLI 路径发现、HTTP/SSE、sidecar；包含宿主重启清理、跨轮旧消息过滤及首次加载历史不串入另一在飞会话的回归。
- `npm run build`（包含 TypeScript）和 `git diff --check` 通过。
- 仓库 `main.js` 与 demo 安装副本 SHA-256 相同：`59ef5ae6673aa0626643fa40c054999e07152c57d07d1caf4596fb51660d0cb2`；通过第三方插件开关实际重载，而非仅复制文件。
- 定向测试记录、构建日志及重放问题真实协议对照保留在本机临时目录，不随仓库发布；以上为升版前验收快照，发布验证另见下文。

## 2.6.11 发布验证

- 当前仓库全量测试：`npm test -- --runInBand --testPathIgnorePatterns="/node_modules/|/\.claude/" --detectOpenHandles --json`。Jest JSON 核对为 48 套、589 项全部通过，0 失败、0 待执行；结果仅包含仓库 `tests/`，排除本机 `.claude/worktrees` 下不参与发布的旧副本。
- 测试进程自然退出，退出码 0，未使用 `--forceExit`。诊断发现既有 Hermes 取消测试保留了一个 300000ms 计时器，等待其到期后退出；相关实现和测试未在本次修改。
- `npm run build`（包含 TypeScript）通过；`package.json`、`package-lock.json`、`manifest.json` 与 `versions.json` 版本统一为 `2.6.11`。
- 发布构建 `main.js` SHA-256：`59ef5ae6673aa0626643fa40c054999e07152c57d07d1caf4596fb51660d0cb2`，与实际重载验收的 demo 构建一致。
- `manifest.json` SHA-256：`4a16364b2e80ec1a67cbf185a4049911a42a9648dced0efc7abfc2d04ed79a30`；`styles.css` SHA-256：`1ab3b4f4507ea9f017c2093b03aa3f193c6b1af2e403a1bcbb374628e11d83f4`。

## 接入与安全边界

- 已放弃借用既有桌面任务 writer 的路径；只管理本插件创建的独立 worker 和连接，不接管其他任务。
- 使用 WorkBuddy 原账号宿主通路；未另建账号、配置独立 API key、注册应用或联系官方，未切换云端任务。
- 未降低加密保护，未读取、复制或解密账号登录凭据。pid 元数据仅用于核对实例身份，不使用其中的 token。
- sidecar 属于内部 IPC，本报告不宣称它是官方公开、稳定承诺的接口；仍依赖原桌面端运行和登录状态。
- 不带 bootstrap 的旧 WorkBuddy 保留 stdio；新机制宿主不可用时明确报错，不静默改用独立 CLI。
- 宿主重启清理异常时，仅在自有 worker PID 明确已消失后解除清理屏障；存活或无法确认时保持失败，避免双 writer。新增定向测试覆盖死、活及无权限状态。
- 2.6.11 提供此修复供用户复测，不自动关闭 Issue；用户 `CLAUDE.md` 的本地修改不纳入发布提交。

## 保留的合成验收文件

两份文件均为 `SYNTHETIC_ONLY`，保留供后续复核，未作清理：

- 读取样本：`Issue10-local-acceptance.md`。
- 写入结果：`Issue10-output-acceptance.md`，16 bytes，十六进制为 `57 42 31 30 5f 56 41 55 4c 54 5f 37 45 34 32 0a`。

合成文件仅保留在本机未跟踪的 demo-vault，不包含在发布包中。此报告只确认上述本机恢复范围，不宣称全功能或跨平台验收完成。协议审批卡/拒绝 GUI 与 Windows 实机仍待独立验证；Issue 保持开放。
