# Issue #10 零配置接入的增量验收

## 补丁状态

`2.6.14` 发布后继续检查“只安装并登录 WorkBuddy”的完整前置条件，发现并修复了两处遗漏：已有 sidecar 时仍依赖系统 Node，以及宿主代理先启动、账号请求通道稍后恢复时立即失败。CLI 符号链接的同类无 Node 分支一并补齐。

本报告对应 `733464d` 之后的增量补丁，按用户要求纳入 `2.6.15` 发布；不是 GitHub `2.6.14` Release 的内容，旧标签和三个附件没有覆盖或重写。此前 demo-vault 使用本地增量构建，manifest 保持 `2.6.14`，这部分 GUI 记录不是已安装正式 `2.6.15` 的验收。

## 无系统 Node 的已有 sidecar

官方 WorkBuddy `5.7.7` 的 `main/sidecar-entry.js` 直接执行 `session.create` 传入的命令。`main/cli-process-env.js` 不把 `node` 替换为桌面端内置运行时，也不补入 vendor Node PATH。插件此前默认提交 `node`，因此无系统 Node 的已安装、已登录环境仍可能在握手前失败。

隔离测试通过默认 `AcpClient` 自动发现安装，再由独立 sidecar 实际启动子进程。初次出现 `command=node; spawn errno=ENOENT`。修复后使用已识别安装的桌面运行时和内置 JS 入口；Mac 常规发现、Windows `.cmd` 模拟、Mac 非默认目录的 CLI 符号链接三个场景均能完成 ACP 初始化和新会话创建。非桌面显式命令与旧版 stdio 保持原路径。

运行时识别先解析 CLI 真实路径，避免产品判断按链接目标成功、运行时判断却按链接父目录失败。新增链接场景独立复现失败后转绿。Windows 模拟在本机运行真实子进程，但命名管道映射到 Unix socket，不能替代 Windows 硬件验收。

## 账号请求通道恢复

官方 `main/server.js` 的 WBIPC broker 可先启动；`wb.request` 只有在宿主后端地址和账号 token 就绪后才可见。此前 `E_REQUEST_PIPE_UNAVAILABLE` 会立即结束首次连接，即使用户已经登录、只是账号恢复稍慢。

生产 Native 通路现在先有界等待请求通道，最长约 30 秒，支持取消。账号通道暂不可见时不重启宿主；模型请求只在通道可用后发送。仍拒绝不可信路径和错误认证证明，不提取登录凭据，也不重放用户 prompt。

外部宿主夹具先隐藏请求通道，再让其恢复：旧实现出现 `E_REQUEST_PIPE_UNAVAILABLE`，修复后首条 ACP 消息成功，模型请求只有一次。取消、到期退出和错误认证证明均有目标测试，没有创建遗留 worker。

## 验证

`2.6.15` 发布检查另行重新执行 `npm test -- --runInBand --roots tests --detectOpenHandles`：当前仓库 **53 套、682 项通过**，失败 0、开放句柄 0，测试进程自然退出（退出码 0）。类型检查与生产构建重新通过。下文 211 项是先前增量开发的定向验证，不与本次全仓库结果混算；没有新增真实账号或 Vault 内容测试。

当前八套相关测试 **211 项通过**，失败 0、开放句柄 0，进程自然退出（退出码 0）。范围为 ACP client/session、provider 回调、sidecar、原生账号代理、Broker 和 Windows JS 入口；没有把定向验证记成全产品验收。`npm run build` 的类型检查与生产构建退出码 0，`git diff --check` 通过。

原账号真实 Native 探针完成初始化、新会话、9 个模型、精确回复和自有 worker 清理，结束原因 `end_turn`。此探针证明当前 Mac 原生账号通路，不等同账单额度差值或所有模型验收。

demo-vault 重载增量构建后，在原界面会话请求读取学习地图，收到 `WB_ZERO_TOOL_READY_1009` 和与文件一致的一级标题；笔记字节哈希前后不变。未将这一条交互当成所有工具权限验收。

这次内容测试发现该 demo 笔记还含带密码样式字段的 iCloud Basic 认证命令，模型回显了敏感内容。已停止进一步内容测试并提醒用户吊销应用专用密码；没有执行命令、修改凭据或删除笔记/历史。账号、密码、完整命令不抄入报告或 Issue；该笔记被 Git 忽略，不属于提交范围。

最终仓库与 demo-vault `main.js` 的 SHA-256 相同：

```text
cc08bd073b80c18b7e96725be8aa9b30404b644619ff3d0a0000db273caac4bb
```

测试证据在 `/tmp/wb-zero-setup.Nmzjre/zero-setup-followup-final.json`、`account-pipe-red.json`、`account-pipe-green.json`；无 Node 和链接红转绿证据在 `/tmp/wb-prereq-audit.x6wWd9`。临时日志不是发布资产。

发布检查证据在 `/tmp/workbuddian-release-2.6.15.ETK2w0/tests.json`、`tests.log` 和 `build.log`。版本文件同步为 `2.6.15`，最低 Obsidian 版本及 API 使用未改变；`main.js` 构建字节与上述增量构建相同，正式 manifest 的 SHA-256 为 `eaa844310f54c58359309c978e7b0d6b9d8c195df03c815a7f27f4e1442246c2`。远端发布状态以 GitHub 对应 Release 和工作流为准。

## Standards

实现规范审查未发现 hard violation 或需处理的代码异味；没有新增 Blocker/High。修复复用已有安装识别和 JS 参数逻辑，未引入新认证、权限或全局配置。用户原有 `CLAUDE.md` 改动不属补丁。

## Spec

产品要求审查发现的符号链接无 Node 分支已补测试并修复，未发现扩大功能范围或新增 Blocker/High。

**完整高可用目标仍不能据此宣布完成。** 原生接口的约 50 秒、640 KiB、完整缓冲限制没有解除；Windows 实机、长请求、大附件及账单差值仍未验收。Broker 对错误 ack 类型/协议的错误分类还会使其按“请求通道不可用”有界重试，已登记 [P2 Issue #12](https://github.com/jiang198012/workbuddian/issues/12)，不阻塞两处核心修复；每次仍重新检查信任和认证，不发送模型请求。

发布前只读审计另确认：缺少 sidecar 时，旧可选连接组件的坏 metadata、版本不兼容、连接或响应失败仍可能阻断独立 Native 通路；预热返回成功但仍无 sidecar 也未回退。本次有限补丁没有修改这些分支。Native 与 sidecar 使用不同会话存储目录，旧会话模型上下文恢复不能仅据 UI 续聊 marker 认定通过；工具权限、图片、MCP 与 Windows 实机仍需独立验收。Issue #10 不关闭。

官方当前外部 WBIPC 只注册 `wb.request/http.fetch` 和订阅检查，没有可直接替换的通用流式请求或 sidecar 初始化方法。协议支持 stream 字段不代表注册了 stream 方法；不以伪装内置客户端、修改厂商包或提取账号密钥绕过该边界。
