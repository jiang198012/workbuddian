# Issue #10：WorkBuddy 5.7.6 冷启动修复与可用性验收

## 状态

本机 macOS 冷启动修复及 demo-vault 界面验收通过。WorkBuddy 正常重启后，未重载 Obsidian 插件的原会话也恢复成功。仍使用原 WorkBuddy 登录账号；没有要求重新登录或切换独立 API 账号。

本报告记录 `2.6.13` 修复的发布前本机验收（GUI 验收时尚未升版，显示 `2.6.12`）。实际发布状态以对应标签、CI 与 Release 为准。Windows 实机、长期运行和计费额度变化尚未验证，Issue #10 保持开放，不能据此承诺跨平台或 100% 可用。

## 根因及反馈回路

- 本机 WorkBuddy 5.7.6 已运行、已登录时，最初没有 `sidecar.pid`。生产 `startWorkbuddySidecar` 路径仍报 `WorkBuddy sidecar v6 is not running`。
- 在 demo-vault 的 WorkBuddy 任务中发送合成消息后，宿主生成 sidecar；同一个生产连接路径立即成功。完整 ACP 探针收到 `WB10_DEMO_1007`，`toolCalls: 0`，自有 worker 已清理。
- demo-vault 的 Obsidian 界面随后分别收到 `WB10_UI_1007` 和 `WB10_UI_DEEPSEEK_1007`，并核对持久化结果。以上只证明服务启动后的原账号通路可用。
- 5.7.6 安装包 `main/server.js` 明确移除了启动预热；`main/code-cache.js` 的 SidecarManager 仅在会话需要运行时时启动 sidecar。
- 插件在会话创建之前就要求 PID/socket 已存在，因此冷启动无法到达宿主账号委托链。不是未登录，也不是必须降级到 5.6.2。
- 现有 sidecar 成功测试在调用前就创建 PID/socket，缺少真实冷启动验收。

## 已排除的伪修复

- 改报错文字：改善诊断，不启动服务。
- 单独启动 vendor sidecar：缺少宿主交付的凭据保护 bootstrap，并会触碰共享运行时状态；未执行。
- 深链打开任务或预填输入：没有自动提交或 runtime intent，不能证明会预热。
- 直接调用桌面 `sidecar:list`：该通道使用宿主 Electron MessagePort/stdio，不是外部 Obsidian 可连接的 RPC。
- 修改厂商安装包、伪造 builtin 扩展或授权元数据：未执行。

## 最小修复

- 使用正常加载的本地 platform 服务扩展，固定调用 `wb.invoke('listSidecarSessions')`。本机宿主将该调用路由到既有 SidecarManager 的 `listSessions()`，由它执行 `ensureStarted`，保留宿主原有账号委托和凭据保护。
- 扩展不接收 prompt、Vault 路径、任意 RPC 或权限参数，不转发返回的会话信息；最终 `grantedPermissions` 为空。`resident: true` 使用宿主既有驻留机制，避免正常闲置回收。
- 插件仅在缺少运行时文件或原 PID 已退出时请求预热；随后重新验证真实 v6 PID/socket、所属用户和存活状态。SDK 返回成功但 sidecar 未就绪时拒绝创建 worker。
- 扩展源随现有 `main.js` 分发；Obsidian 新命令“安装 WorkBuddy 本地连接扩展”展示目标路径并要求明确确认。普通聊天和插件加载不自动安装，不重启宿主，不中断用户任务。首次安装后需用户正常重启 WorkBuddy 一次。
- 连接只允许固定初始化请求，采用本地 socket/pipe 和每实例随机 nonce；macOS 目录/文件/socket 权限与所属用户均校验。拒绝 symlink、异主路径、外来同名扩展及畸形请求。

诊断过程中曾试验 `conversations.create` / context 初始化路径：它拉起的是新 conversation-engine，并非本插件需要的 v6 SidecarManager，因此没有将该路径当作修复。唯一自建的试验会话已通过 SDK 软删除（可恢复），相关试验权限已移除；最终源代码不调用 conversations API。

## 可用性防护

- 初始化单飞，固定调用 90 秒期限、客户端 95 秒期限，避免静默初始化无限等待；支持取消，其他会话的共享初始化不被误取消。
- 同会话冷启动重复发送返回 busy，避免覆盖取消回调；取消中的旧启动保持清理屏障，立即重试不能重叠创建 worker。
- 清理失败仅在原自有 PID 确认退出后解除屏障；存活或权限不明时仍拒绝重叠创建，不跟随或终止新宿主实例。
- 断线清理后允许下一条用户消息重连；不自动重发已经发出的 prompt，避免重复执行或扣费。
- null、错误认证、非 ASCII nonce、任意 RPC、超长帧均被拒绝，不让输入异常击穿连接服务。

固定初始化调用超时后，宿主底层调用可能仍在完成；下一次重试仍是相同无 prompt 入口，宿主 `ensureStarted` 本身单飞。未增加自动宿主重启、账号切换、凭据提取或猜测性 worker 清理。

## 本机验收结果

按 diagnosing-bugs 的真实反馈回路确定冷启动根因，按测试先行流程复现取消、畸形帧及重复发送缺陷后修复；独立源码审查最终无剩余 Important。

| 验收 | 结果与证据 |
| --- | --- |
| 原账号生产 ACP 冷启动 | 调用前没有 sidecar；976ms 建连，收到精确 `WB10_COLD_1007`，`end_turn`、工具调用 0，自有 worker 清理完成。日志 `live-cold.log`。 |
| 最终构建 GUI 冷启动 | 正常重启空闲 WorkBuddy，不在宿主发消息；启用前 sidecar 不存在、连接扩展存活；demo-vault 启用后产生存活的 v6 sidecar。Obsidian 精确回复 `WB10_UI_COLD_1007`。 |
| 原会话宿主重启恢复 | 保持 Obsidian 和插件运行，正常退出并重启空闲 WorkBuddy；确认 sidecar 再次不存在。原会话下一条消息精确回复 `WB10_UI_RECOVER_1007`，无需重载插件或重新登录。 |
| 持久化与不重发 | 两个 GUI 标记各有 1 条 user、1 条精确 assistant 消息，关联工具调用 0；读取实际 `data.json` 交叉确认。 |
| 安装入口与取消 | 命令可检索，确认弹窗显示范围和 `/Users/jiang/.workbuddy`；点击取消后 3 个组件文件的修改时间完全不变。 |
| 定向回归 | 10 suites / 230 tests 全部通过，失败 0；JSON `related-verified.json`。覆盖 connector、sidecar、host、ACP client/session/provider、callbacks、Hermes 共享路径与 i18n。 |
| 2.6.13 发布前全仓库回归 | `npm test -- --runInBand --roots tests --detectOpenHandles`：49 suites / 614 tests 通过，失败 0，无残留句柄，进程自然退出（退出码 0）。只测试当前仓库，不含 `.claude/worktrees` 旧副本。 |
| 构建 | `npm run build` 退出 0，包含 TypeScript 检查与生产打包；日志 `build-verified.log`。 |
| 补丁检查 | `git diff --check` 退出 0；保留用户已有 `CLAUDE.md` 改动。 |

本次本地证据目录：`/tmp/workbuddian-ha.B4G5Qt`（临时文件，不作为长期保存或发布资产）。GUI 持久化证据为 `ui-acceptance.json`，冷启动/恢复前状态分别为 `ui-cold-before.json` / `ui-recover-before.json`。

2.6.13 发布前全仓库回归与构建证据：`/tmp/workbuddian-release-2.6.13.4JUwBQ/tests-final.json` / `tests-final.log` / `build.log`。首次完整测试定位到旧 Hermes 取消用例停在 `yield done`，没有完成生成器导致 finally 未执行；仅增加生成器完成断言，生产消费者本身完整消费流，未改 Hermes 业务代码。最终重跑自然退出，无需 `--forceExit`。

新增弹窗使用的 `Modal.titleEl/contentEl`、`Setting.addButton` 及按钮 API 已对照 Obsidian 官方 [1.7.2 版本提交声明](https://github.com/obsidianmd/obsidian-api/blob/6933c6227617897e031f30c734f61167cedafb7d/obsidian.d.ts#L2806)核验，保持 `minAppVersion: 1.7.2`。

最终仓库与 demo-vault `main.js` 的 SHA-256 一致：

```text
433417f3f93f73a0a99c0569b9e0663d8e0b56f08e0b7af9efac65e97f8ed588
```

安装的连接服务 `index.cjs` SHA-256：

```text
b32e52cb65113e0a67a257e9cb757e397b931672f01dc60719061e0f89986ec2
```

## 范围与回退

- 本机实测组合：WorkBuddy `5.7.6`、Obsidian `1.13.7`、demo-vault。固定宿主 SDK 入口是当前安装包实现，并非厂商公开稳定接口承诺；未来升级仍需兼容性验证。
- Windows 仅有代码/测试路径，尚无硬件验收；未执行长期压力/驻留测试，未核对余额或扣费差值。本次定向回归不是全产品、跨平台发布验收。
- 本地连接扩展安装在 `/Users/jiang/.workbuddy/extensions/workbuddian-warmup`，没有修改 WorkBuddy 安装包，也没有修改个人 Obsidian 仓库。
- demo 插件旧构建备份为 `/tmp/workbuddian-ha.B4G5Qt/demo-main-before.js`。回退可先停用 demo 插件再还原备份；如不再使用连接组件，仅卸载本插件自己的扩展目录，保存任务后正常重启 WorkBuddy，不删除任何厂商或其他插件资源。
