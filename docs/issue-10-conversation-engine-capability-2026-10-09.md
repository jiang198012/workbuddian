# Issue #10：新版 conversation-engine 接入能力证据

日期：2026-10-09。状态：**只读研究，未实现、未运行验证，不是完整零配置目标达成证明**。

## 结论与产品目标

目标仍是：用户只安装并登录 WorkBuddy，即可从 Obsidian 沿用原账号能力；无需安装本地连接扩展、先在宿主发消息、另建账号或 API key，并覆盖正常 Vault 工具任务与高可用需求。

本轮实时读取官方 WorkBuddy `5.7.7` 安装包，确认新版 conversation-engine 能由宿主创建本地 ACP worker，具有任务、流式消息、权限请求、取消和子 agent 投影。这些能力不是旧 v6 `SidecarManager`。

**已确认的正常 SDK 接入路径是宿主登记并启动的扩展或宿主窗口。当前官方 `5.7.7` 的已审调用链没有提供独立第三方外部进程仅凭公共 SDK 构造器取得受承认身份、限定 Vault 的自有会话权限及完整消息流的入口。** 初轮暂停后，本次继续补完 `LocalDaemonTransport` 与 own-conversation/event ACL 两项缺口：前者是宿主内部 Electron MessagePort；后者只有方法/事件名 grant 与流量过滤，没有自建会话 ID 绑定的 owner ACL。因此这两个候选接缝不能满足完整零配置目标。

增量复核仍以 `2026-10-09` 为报告日期，实时版本仍为 `5.7.7`，ASAR 指纹未变。以下结论限定于已审正常 SDK 和相关传输注册链，不声称穷尽安装包的所有组件或未来厂商接口。

本研究不改变本次发布范围，也没有把目标缩为短文本对话。当前 Native fallback 的时限、容量和缓冲限制仍由既有报告记录，本轮不重复把它当新增进展。

## 研究边界与复核方式

- 仅读取 `/Applications/WorkBuddy.app/Contents/Resources/app.asar` 与其 unpacked 公共 SDK 源文件。
- 先完整阅读已有安全 ASAR 检查脚本，再以 `fs` 读取 ASAR 索引和成员字节；没有 `require`、执行或修改厂商 bundle。
- 没有读 `~/.workbuddy` 的账号、endpoint、日志或会话，没有读 demo-vault 笔记或已有测试聊天，没有发 RPC 或模型请求，没有联网或咨询厂商。
- 本文件是本轮唯一写入。没有修改生产代码、测试、`main.js`、版本或 `CLAUDE.md`，没有提交。
- 以下定位为 UTF-8 解码后的 JavaScript 字符 offset，unpacked SDK 也提供字符 offset。ASAR 成员可以用已审阅的 `inspect-asar-subagent.cjs <member> range <offset> <length>` 复核。

## 确认的引擎和传输链

| 环节 | 当前源码事实 | 来源定位 |
| --- | --- | --- |
| 创建会话 | `create()` 验证稳定 `conversationId`，插入会话后取得会话实例；SDK façade 创建后采用 `adopt()`，返回会话信息和配置 | `main/conversations.js` offset `544474`、`689576`、`690011` |
| 本地连接选择 | `createConnection()` 根据宿主 hooks 选择 `$i` 的 HTTP ACP runtime，或 `ci` 的 stdio worker | `main/handlers.js` offset `211200` 附近 |
| stdio worker | 宿主直接 spawn 官方命令，以 `stdin/stdout` 建立 ACP channel；初始化后处理通知、worker 请求和退出 | `main/handlers.js` offset `82494`、`84900` |
| HTTP worker | `$i` 获取宿主 runtime，开启 streamable HTTP channel，执行 ACP initialize/admission；请求前做 workspace preflight | `main/handlers.js` offset `122568` 起 |
| runtime 获取 | `WV()` 可使用 prewarm pool；`qV()` 通过宿主 `runtimeManager.createSession()` 启动官方 `--serve --session-id` worker，内部返回 `acpEndpoint`、`authToken` 和 release | `main/server.js` offset `1613445` 起 |
| 消息与权限 | SDK 会话对象提供 `sendPrompt`、`on(RequestUpdate)`；支持单条和 batch typed patches，pending permission 与子 agent 事件 | `main/conversations.js` offset `196000`、`699009`、`701000` |
| 清理与恢复 | HTTP 连接有 generation、取消、runtime release、断线恢复；stdio 连接在异常退出或 pipe 关闭时清理 worker | `main/handlers.js` offset `84900`、`120000` 起 |

以上说明新版引擎具有真实任务运行能力。`RequestUpdate` 是宿主整理后的消息投影，不能据此宣称外部 SDK 已提供任意原始 ACP request/notification 的透明通道。worker 的 endpoint/token 是宿主内部 runtime 数据，本轮没有读取任何实际值，也不把读取它们作为接入方案。

## SDK 调用方身份和授权

### 正常扩展身份由宿主登记

`main/daemon-bootstrap.js` offset `124199` 的扩展发现链读取扩展目录里的 `extension.json` 与配套 `distribution.json`，随后登记、激活并 fork 扩展。offset `118606` 的 fork 环节注入 `WB_EXTENSION_ID=e.id`；offset `119664` 的宿主上下文固定为 `subject={moduleId:e.id,type:'extension',kind:builtin/platform,scopes:[]}`。

同成员 offset `107229` 的 `ua()` 对公共 `wb:` 调用先执行 `authorizer.assertAuthorized`，再以宿主固定 subject 调用方法。offset `107876` 对内部扩展请求把 `extensionId` 覆写为固定 `moduleId`。自行在外部进程里设置同名环境变量或构造 `subject` 不等同宿主登记和授权。

offset `147451` 的 `registerSubject` 从 `distribution.grantedPermissions` 建立权限；platform 分支额外加入 `bus.emit`、`bus.on`。`main/log-acl-guard.js` offset `1453779` 对缺少 base grant 或 method grant返回 `MISSING_BASE_GRANT` / `MISSING_GRANT`；offset `1454738` 规定通配 `'*'` 仅 builtin 可用，精确 `conversations.create` 映射到 `wb:conversations:create`。不能伪装 builtin 取得通配授权。

### 公共 SDK 构造器不等同身份注册

unpacked `main/preload/fork-preload.cjs` offset `125812` 的 `resolveInvokeContext()` 与 offset `126237` 的 `createGuestWb()` 构造调用上下文，没有注册身份或授予权限；offset `140228` 的 `runExtension()` 使用宿主提供的 IPC transport，offset `140527` 调用 `createGuestWb(invokeFn,{subscribe})`。

因此“能取得 SDK 对象”“SDK 中存在 conversations.create”与“普通外部 Obsidian 进程能通过正常宿主授权调用”是不同证据。当前没有发现后者的自助注册接缝。

### 创建归属和流量绑定不是自有会话 ACL

`main/log-acl-guard.js` offset `1453779` 的 authorizer 按 subject 和方法/事件名检查 grant，授权 action 没有 `conversationId`；offset `1455982` 将同一权限列表映射为 `invokes:r,events:r`。`conversations.create` 对应 `wb:conversations:create`，事件使用单数 namespace，例如 `conversation.requestUpdate` 对应 `wb:conversation:requestUpdate`。创建权限不会自动授予事件、发送提示、审批回复或 runtime 操作权限。

`main/conversations.js` offset `689576` 的 façade 暴露 `create/get` 及转发方法，没有接收 caller/subject 来判断自建会话。offset `690011` 创建后执行 `adopt()`，没有登记 extension creator 或新增 grant。offset `659684` 的 `declareOwner(e,t){this.router.observe(e,t)}` 是 local/cloud provider 路由归属，不是用户授予的 owner ACL。已审方法授权链没有将权限限定到该扩展自己创建的会话 IDs。

`ensureRuntime` / `releaseRuntimeHold` 在 wire method descriptor 中并进入转发键；offset `690603` 的 `_getLiveConversation` 是内部 façade 方法，通用公共方法枚举排除 `_` 开头名称。这不构成普通外部进程领取 worker endpoint/token 的公开委托接口。

`main/daemon-bootstrap.js` offset `158353` 注册扩展 streaming 接收 handler；它验证非空 `extensionId`、`conversationId` 后调用 `Ma()`。offset `115142` 把扩展绑定到该会话并设置 publisher 当前 ID，offset `115360` 的 `Pa()` 检查绑定是否相等；host-signed 身份来自前述 offset `107876` 的覆写。这里没有会话 creator 或用户授予 owner ACL 的检查。`main/conversations.js` offset `391320` 的 `shouldPublishHighFrequency()` 按当前会话和 stream gate 过滤更新，是流量过滤，不能证明读取资格。

### 两条事件通路的实际授权

| 通路 | 源码确认 |
| --- | --- |
| 扩展窗口 | `main/index.js` offset `151019` 在订阅时检查 `subscribe-event` grant；offset `180680` 在转发前再次检查。检查按事件名，不按会话 ownership。 |
| 宿主 fork 扩展 | `main/daemon-bootstrap.js` offset `120174` 从 `r.onAny()` 收总线事件，送入 publisher；offset `109321` 的 `pushEvent()` 直接 broadcast，没有同样的事件 authorizer。 |

fork 路径的 `permission`、状态、配置等低频事件在 `main/conversations.js` offset `382854` 立即 push，没有应用当前会话高频 gate。子代理 `requestUpdate` 应用高频过滤；子代理 `requestsChanged` 经 offset `382093` 与 `389000` 后的 `enqueueChildAgentEvent()` 进入 batch 时没有同样过滤，并带 snapshot 输出为 `wb:conversation:childAgentEventBatch`。所以 stream bind 不能当作 permission / child-agent 全流的 owner ACL。此为静态路径确认，没有发送 RPC 做运行时验证。

`main/index.js` offset `124994` 的 `RendererClientToolRouter` 另以 `(conversationId,providerId)` 和实际 `e.sender.id` 绑定工具回调，offset `127087` 的 `complete()` 只接受相同 renderer 完成。`main/conversations.js` offset `690882` 的 `zT()` 用 `bindingId` 拼 provider ID。这保护工具回调接收方，不增加会话 ownership，也没有授予外部进程注册入口。

不能笼统称 typed stream 必须先授全局 `conversations.read`：源码实际拆分为方法与具体事件 grant，fork 路径又具有上述不同授权行为。但也不能反向宣称“无需 read 即已安全取得仅自有会话的完整流”；本轮确认的注册、授权和跨会话转发事实不支持后一个承诺。

## 内部 RPC 不能直接当作正常外部入口

`main/daemon-bootstrap.js` offset `2034` 的 `re()` 只有在存在非 host `context.subject` 时调用 authorizer；缺 context 的内部调用分支不做该检查。这是需要保留的实际例外，不能只凭扩展身份链声称所有 raw RPC 都受同一 ACL。

已确认的主 daemon 传输：

- `main/server.js` offset `62739` 的 `Jr` 是内存 dispatcher，`getHttpServer()` 无返回；同成员 offset `66500` 附近的 `Qr()` 在已提供的 input/output 上接收 stdio RPC 并发送事件。
- `main/index.js` offset `594650` 附近的 `DaemonAppServerProcessManager` 由宿主 spawn `--stdio` daemon，父进程持有私有 `stdin/stdout` 和 catalog pipes；不是可供其他进程加入的共享 socket。
- 同成员 offset `627982` 附近支持 `in-main` / `stdio-fork` 两种模式；`main/bootstrap-daemon-in-main-process.js` 直接返回宿主内的 daemon connection。
- 同成员 offset `50709` 的 `LocalProbeServer` 只支持 `/workbuddy/probe` 的 GET/OPTIONS，返回应用版本与平台；offset `575191` 附近的 Eval proxy 仅在 `evalModeEnabled` 时启动。不能把 probe 或开发注入接口当作正常任务 SDK。

### LocalDaemonTransport 增量复核已完成

`main/index.js` offset `227777` 的 `createLocalDaemonTransport()` 创建 deferred transport 并绑定宿主 daemon connection；offset `228318` 的 `connectPort()` 只接收 Electron MessagePort、分配会话 ID并处理 port 消息。它没有 `listen()`、TCP/HTTP/Unix socket 端口或外部进程注册。

同成员 offset `255481` 的 `registerDesktopHostIpc()` 在 `ipcMain` 注册 `workbuddy:local-daemon-transport:port`，从事件 `e.ports[0]` 接收端口并交给 `connectPort()`；offset `261506` 的 helper 直接注册 `ipcMain.on()`。该层没有新增 sender grant 检查，因此不能把它包装为已经按第三方权限隔离的开放服务。

`preload/index.js` offset `186397` 由 WorkBuddy preload 创建 `MessageChannel`，用本宿主 `ipcRenderer.postMessage()` 传递 `port2`；offset `186697` 的窗口消息转发先要求 `e.source===window`，再经同一 `ipcRenderer` 转交端口。按这条源码路由，调用前提是已经处于 WorkBuddy 的 renderer/preload IPC 环境；外部 Obsidian 进程构造普通 MessageChannel 或加载同名代码不会取得当前 WorkBuddy 的 IPC 通道。

因此 LocalDaemonTransport 是内部 renderer→主进程→daemon 通路，不是本任务要求的正常外部 client 接入点。它确实可向内存/stdio daemon 转交 raw envelope，而缺 context 分支仍是内部信任例外；通过注入宿主页面、伪装 renderer/host 身份或自行执行厂商 daemon 来到达该分支，都不属于本目标的正常授权方案。本轮没有尝试这些动作。

## 最小后续验证接缝与必要外部变化

当前证据不支持直接把 Workbuddian 改为这个新版 engine 后端来承诺完整零配置目标。前次两个候选缺口已核清，阻断位于正常外部身份注册/可加入传输边界；另一个产品缺口是受用户授权、只覆盖自建会话的完整任务流 ACL。

已登记扩展的最小接缝可使用会话 SDK 的创建、prompt、取消、pending reply 与 typed events，各操作/事件需按实际通路取得独立 grant；至少 `conversations.create` 与 `conversation.requestUpdate` 是不同权限。这个接缝仍要求宿主安装/登记扩展，不满足本目标，且不能用 fork 路径的低频广播省略授权设计。没有新增外部适配器或调用这条接缝。

需要厂商提供/确认面向外部程序的正常身份登记、可加入的受控传输，以及自有会话 ID 绑定的方法与事件授权，再验证限定 Vault/cwd 的创建能力、prompt/取消/权限/消息流、断线恢复和 worker release。验证必须使用新建且不含秘密的专用临时 Vault与全新任务，覆盖真实读写工具及权限交互；短 marker 回复不足以验收。不能将缺上下文分支、伪 builtin、宿主代码注入或账号 token 读取作为验证方案。

若正常接入必须经过安装并激活扩展，则它不满足当前“无额外安装”目标；无需重启也不能消除这项偏差。若细粒度自有会话权限不存在，则需要厂商增加外部 client 注册、own-conversation 方法与事件授权，或用户另行明确接受更广权限。不能以本轮 SDK 内部能力代替上述外部变化。

仍缺外部 client 的正式身份/传输契约与自有会话授权，没有外部进程运行时验证；高可用 SLA、Windows 实机、长任务、大附件与额度差值仍未确认。上述静态研究不改变现有 Native fallback 的时限、容量和缓冲限制，不是完整目标完成状态。

## 源码指纹

安装包 `/Applications/WorkBuddy.app/Contents/Resources/app.asar` SHA-256：

`fff364af0a11f3630b57ae145910066ba2eb5b001a03b7c445057651815a491e`

| 成员 | SHA-256 |
| --- | --- |
| `package.json`（实时版本 `5.7.7`） | `3d16d04197c8be6504d4d92f3c3690b3284cffac4bac734a51fb2f32350aee7c` |
| `main/conversations.js` | `10c31573f43c6d48cd2334dd00a83e6932f30bee55134ae54d42a10778488e98` |
| `main/handlers.js` | `5ec9d69edb1fdb6086858dd27bfaf187b0f26e88f3850d560729656db1cca7ef` |
| `main/server.js` | `ea34950748468888c7b7a7467364f562abb5e91ded104455c5761bbf5e6ddab7` |
| `main/daemon-bootstrap.js` | `7679c9765ecc9a9df02c5f5b7dd60025d0f78ef2ece59e7bec4b7a6d0262ff74` |
| `main/log-acl-guard.js` | `e80a6f5ca2ed33232ff1ce0d0bcfccdfc4e856de22e4753782df0b1bae5781d8` |
| `main/index.js` | `67f5bbaf27c8c0f92162de9eb238dedafd764d54896fa1a7457bac2b7980dc5f` |
| `preload/index.js` | `373424283464d2cbe04493debbb3ad230dca631319d28d4e4b6e654a8330796c` |
| `main/daemon-app-server-entry.js` | `233ce248d652694a57fc7724b27f5a6c673dfda66ca9e3772a780a4d50bd269e` |
| `main/bootstrap-daemon-in-main-process.js` | `5520aea157b6ab801cb38e106884b6826fdf82a77a95f583f4f27223a3a8caaf` |
| unpacked `main/preload/fork-preload.cjs` | `5d983bf402e97d4bcb09507393c1727b96b7428ffdf6576c7a185706200b4b94` |
