# Issue #10：旧可选组件故障后的账号通路恢复

日期：2026-10-09。状态：**`2.6.16` 修复与发版前验收记录**。基线为 `70ed24e96e03740b10a5bd5e8cbca9fcc4516784`（`2.6.15`）；不覆盖旧标签或附件。实际发布状态以 GitHub Release、CI 与资产核验为准。

目标保持不变：用户只安装并登录 WorkBuddy，即可从 Obsidian 使用原账号；不新增账号/API key，不要求先安装连接组件、重启宿主或手动预热，也不能以短聊天代替完整 Agent 能力。

## 复现与修复

原生账号代理正常、没有 sidecar，但以前安装的可选连接组件调用宿主初始化失败时，生产启动入口直接返回“WorkBuddy 初始化失败，请检查宿主登录或稍后重试”，没有尝试独立 Native 通路。

隔离复现通过真实 `startWorkbuddySidecar`、真实组件服务、真实子进程和 ACP 对话，只有外部宿主 SDK 与模型代理使用合成夹具，没有 mock 插件内部模块。失败复现命令：

```sh
npx jest tests/workbuddyZeroSetup.test.ts --runInBand --detectOpenHandles -t 'installed optional connector'
```

修改生产代码前连续两次都是 1 项失败、0 开放句柄。去掉旧组件的对照用例成功完成首条 ACP 对话，排除账号代理与 CLI 启动失败。修复后原用例成功，合成模型请求只有一次。

本次生产改动只在 `workbuddySidecar.ts`：

- 初次检查确认 sidecar 缺失后，仍优先尝试旧组件预热，以保留可用 sidecar 的原通路。
- 旧组件的初始化、metadata 或连接失败不再直接阻断账号通路；预热后重新检查真实 sidecar。
- 仅当再次检查仍为 `ENOENT/ESRCH`，且未提交 worker 时，才尝试独立认证的 Native 代理。
- 取消、初始或预热后发现的坏 sidecar 身份仍拒绝；Native 的不可信端点或错误认证证明仍拒绝。worker 提交后不切换通路或重放 prompt。

## 本轮验证

修复阶段 **9 套相关测试、224 项通过**，失败 0、开放句柄 0，测试进程自然退出（退出码 0）。覆盖 ACP client/session、provider 回调、sidecar/无系统 Node、可选组件、Native、Broker 和启动参数；不是全产品回归或完整 GUI 验收。类型检查与生产构建退出码 0，`git diff --check` 通过。随后发布前的重新验证见文末。

相关回归首次还暴露了原预热并发测试的时序问题：测试仅等第一次 SDK 调用就释放初始化结果，第二个 socket 请求晚到后产生新一轮未释放 Promise，导致用例和清理双超时。该次结果是 1 项失败、78 项通过、1 个开放句柄，没有记为绿色。

只修测试的完整 socket 帧屏障、共享 deferred 和 `finally` 清理，没有修改预热生产源码、延长超时或强制退出。修正后相关 224 项通过；并发用例单独连续三轮通过，均无开放句柄。新增场景还覆盖预热成功但没有 sidecar、坏组件 metadata 后 Native 错误证明、取消、初始和预热后坏 sidecar 身份。

### 真实 Mac 工具与权限

使用全新专用目录 `/tmp/workbuddian-connector-fallback.1WwP2x/clean-vault`，只有明确创建的合成笔记，没有用户账号、凭据、既有笔记或聊天历史。通过生产启动入口、WorkBuddy 原账号代理、内置 CLI 和真实 ACP：

- 初始化成功，返回 9 个模型选项；不等同逐个模型验收。
- Read 读取合成文件，Write 经 `allow_once` 批准后写入另一个合成文件；写入内容包含未在 prompt 给出的原文件探针值，回复与完成标记一致，结束原因 `end_turn`。
- 第二次 Write 被拒绝，返回 `cancelled`，目标文件没有创建。这是有效拒绝，不要求拒绝后继续生成标记。
- 自有 worker 清理成功，验证脚本自然退出 0，stderr 为 0 字节。

第一轮验证脚本的测试权限闸门拒绝了 Write，没有将它认定为账号连接失败或产品权限故障。测试闸门随后仅允许两个明确的合成文件路径，包括 macOS `/tmp` 与真实路径别名；Bash、其他工具与其他路径仍拒绝。第二轮完成上述批准与拒绝验证，没有修改产品权限映射，也不自动重放第一轮 prompt。

此验证是协议级真实工具交互，**不是 Obsidian 审批卡 GUI、已有会话模型上下文恢复、MCP、图片、账单差值或 Windows 实机验收**。未访问含敏感数据的 demo 笔记或对应聊天。

### 证据位置

- 开发证据：`/tmp/workbuddian-connector-fallback.1WwP2x/connector-red.json`、`connector-red-repeat.json`、`connector-control.json`、`connector-green.json`。
- 最终相关回归：同目录 `final-targeted.json` / `.log`；并发稳定性 `warmup-stability-1.json` 至 `warmup-stability-3.json`。
- 真实交互：同目录 `clean-agent-live-fixed.json`；脚本和笔记仅含合成数据，不是发布资产。
- 构建：同目录 `build.log`；本地 `main.js` SHA-256 为 `e5ccd54181723d683ee8d6f826ba6eadec247db8dcdfbab859ebdb17d6512332`。

## Standards

两轮只读规范审查未发现硬性违规或 Blocker/High。新增测试的重复激活片段已收敛为本测试文件局部 helper；没有重构生产模块。用户原有 `CLAUDE.md` 的 30 行改动保持不动。

## Spec

有限差异实现了“旧可选组件故障不成为可信 Native 通路的前置条件”，没有扩大权限或在 worker 提交后切换通路。完整目标仍未达到：原生接口约 50 秒、640 KiB 和完整缓冲的宿主限制未解除；旧组件等待本身仍可达约 95 秒；Windows、长任务、大附件、图片/MCP 完整 GUI、跨通路旧会话历史迁移等证据仍不足。新增 GUI 审批和自有 Native 会话恢复证据见文末，不扩大为全功能验收。

新版 conversation-engine 的两个候选缺口已完成只读复核，见[能力证据](issue-10-conversation-engine-capability-2026-10-09.md)。`LocalDaemonTransport` 是宿主内部 Electron MessagePort；正常 SDK 接入仍需要宿主登记扩展，方法/事件 grant 也没有自建会话 ID 绑定的 owner ACL。不能把伪身份、宿主注入、内部缺上下文分支或提取账号密钥作为解决方案。

因此本轮有明确代码和运行时进展，但不宣布“只安装并登录即可完整高可用”已经证明，不关闭 Issue #10。用户随后明确要求升版发布，本补丁作为 `2.6.16` 有限修复交付，不改变完整目标的验收边界。

## 发布前补充验收

- 当前仓库重新运行 `npm test -- --runInBand --roots tests --detectOpenHandles --json`：53 套、688 项通过，0 失败、0 开放句柄，自然退出 0。日志与结构化结果位于 `/tmp/workbuddian-release-2616.rLJGcX/tests.log` 和 `tests.json`。排除 `.claude/worktrees` 中不参与发布的旧副本。`npm run build` 类型检查与生产构建退出 0，日志为同目录 `build.log`；发布用 `main.js` SHA-256 仍为 `e5ccd54181723d683ee8d6f826ba6eadec247db8dcdfbab859ebdb17d6512332`。
- 产品真实 `AcpSession` 层使用全新合成会话：随机值只在首次 prompt 给出，同 worker 后续轮次及清理后重建 worker 都准确回忆；重用自有持久 session ID，清理成功。初始原始 ACP 探针混入旧回复回放，不以它冒充产品层失败或通过；产品层负责过滤。证据：`/tmp/workbuddian-context-recovery.xN8bFC/session-context-live.json`。仅证明新 Native 自有会话恢复，不是 sidecar → Native 的既有历史迁移。
- Computer Use 在只含合成笔记与本项目插件的独立 Vault 完成真实 Read → Write 点击“允许” → 第二次 Write 点击“拒绝” → 下一条纯对话。批准文件字节正确、拒绝文件不存在，界面显示拒绝状态和下一条完成标记；结束后关闭该测试窗口，没有更改原 Vault 内容或设置。
- 两个独立会话分别输入左右颜色互换的合成 `64×32` PNG，真实模型两次准确识别；PNG 块、CRC 与 2,048 个像素验证，0 工具/权限请求，脚本退出 0，生产 dispose 成功且独立探测确认自有 endpoint 关闭。证据：`/tmp/workbuddian-image-acceptance.Vpu5kO/result.json`。只覆盖小 PNG 原生 image block，不是 GUI 附件、大图片或全格式验收。
- 合成 stdio MCP 两次真实请求均完成一次单次批准、工具执行、独立结果回传及正确最终回复，没有文件或网络副作用。但原验收脚本将 runner 的全部后代算作 worker 所有，清理计数各残留 2，两个原报告均保留 `CLEANUP_FAILED` / 退出 1，不把功能链通过冒充全验收通过。
- 随后不发送模型请求，透明记录生产 spawn 的 CLI child，按首次进程表、PID/启动时间/命令同一性、父子链和精确 cwd 核验。只确认本次创建 CLI 与 MCP 两个进程；生产 dispose 后都消失，未手工终止，原 WorkBuddy 保留，脚本退出 0。证据：`/tmp/workbuddian-mcp-acceptance.hQbLKW/cleanup-zero-model-report.json`。原两次脚本未保存 PID/启动时间，无法追溯当时两个计数的精确归属；因此未认定产品 worker 泄漏，也未宣称 MCP 生命周期全验收完成，此项继续在 Issue #10 跟踪。
- 发版只读审查未发现本次有限差异的 Critical/Important；`ESRCH` 回退和预热报错但已生成可用 sidecar 的直接测试覆盖可继续补充，不为此扩大生产修改。
