# Issue #10：正常 WBIPC 注册面流式能力有界审查

审查日期：2026-10-09。结论：在本机官方安装包这一正常 WBIPC broker 的启动注册与调度边界内，未找到可供诚实 `workbuddian` 外部客户端加入的流式 fetch/model 方法，也未找到创建自有 cwd worker 并仅授权自有消息流的已注册 pipe。现有 `http.fetch` 不能据此认定为完整 Agent / 长请求的等价通路。此结论是静态代码证据，不是对全部厂商代码或后端 API 的穷尽结论，也没有运行 RPC 验证。[S@3040103、3040428、3041844、3045137、3047544、3053529]

## 实时来源与定位规则

本轮用只读 `fs.openSync/readSync` 解析 `/Applications/WorkBuddy.app/Contents/Resources/app.asar`；未 `require`、导入或执行厂商代码。下列偏移均为解包后成员的 **0-based UTF-8 字节偏移**，不是 asar 容器偏移。`S@offset` 指向下面 S 成员及其完整 SHA256；`P@offset` 同理。

| 来源 | 实时值 / SHA256 |
| --- | --- |
| 安装包版本 | `@genie/workbuddy-desktop` `5.7.7`；P@98 |
| `app.asar` | `fff364af0a11f3630b57ae145910066ba2eb5b001a03b7c445057651815a491e` |
| P：`package.json`（10,471 B） | `3d16d04197c8be6504d4d92f3c3690b3284cffac4bac734a51fb2f32350aee7c` |
| S：`main/server.js`（3,074,721 B） | `ea34950748468888c7b7a7467364f562abb5e91ded104455c5761bbf5e6ddab7` |

asar SHA 用 `shasum -a 256` 取得；成员 SHA 和字节偏移由本轮只读 Node `fs` / `crypto` 计算。主要证据集中于 S 的 entitlement 定义（3013876、3014679）、broker 协议/registry/request 实现（3033000 附近至 3048500）及其启动注册（3053529）。先按 header 成员名与少量 main 候选关键词定位，再局部读取这些范围；未重做 conversation-engine SDK / LocalDaemonTransport 研究。

## 能力、注册、grant 与完整流的区别

| 问题 | 这一正常 broker 的代码证据 |
| --- | --- |
| 实际启动注册什么？ | `hBe` 建立 `nBe` registry，先注册 `pBe`；调用方的 `extraPipes` 仅返回 `[tze(...)]`。`pBe` 是 `wb.request/http.fetch`，`tze` 是 `wb.entitlement/subscription.check`，两者实际 `kind: call`。[S@3047544、3053529、3042725、3045137、3013876、3014679] |
| 是否存在 stream 语法？ | `handleChannelCall` 接受 `mode: call` 或 `stream`，并要求与已注册方法的 `kind` 一致。因此把已注册 fetch 调成 `stream` 会走 `E_METHOD_KIND_MISMATCH`；存在语法不能证明存在流式注册方法。[S@3040428、3045137] |
| 是否完整输出增量流？ | 当前调度在 `await u.invoke(...)` 后仅调用一次 `replyResult`；`ctx` 仅提供 `client`、`connectionEpoch`、`signal`。`http.fetch` 将响应 reader 全部读入数组再 `Buffer.concat`，最后一次返回 `body_b64`。这里未见 chunk/event 输出接线。[S@3040428、3036725、3044586、3045137] |
| 大响应 / 长请求的边界？ | request 常量为响应内联上限 `655360` B、超时 `50000` ms；读 body 超限会取消 reader。JSON-line 协议另有 `1048576` B frame 上限。源码的大下载提示是先取签名 URL 自行下载、透传 3xx `location`；这不构成模型响应流，也不解除该 fetch 的缓冲/超时约束。[S@3042725、3044586、3045137、3013088] |
| 客户端可获哪些方法？ | `GetPipe` 通过 registry `resolve` 获取已注册 pipe 的方法列表并存入该连接 channel；未知或不可见 pipe 返回 `E_PIPE_UNKNOWN`，channel 调用再次检查获准列表。`visible/visibleMethods` 是服务端注册对象的可选过滤条件，没有客户端 `register/grant` RPC。[S@3040103、3040428、3041844、3013797] |
| 身份和账号前置是什么？ | hello/prove 用票据 HMAC 完成连接认证；hello 的 `client.kind/id/version` 仅被记录。request 的可见性取决于当前宿主是否能解析 backend；backend 地址及认证头由宿主当前登录态提供。此处没有把诚实外部 `workbuddian` 身份提升为 builtin/renderer 的授权入口。[S@3037008、3037949、3045137、3047255] |
| 有无自有 worker / ownership 消息流？ | 本实例启动注册的两项方法都不是 worker 创建或消息订阅。唯一额外 entitlement 方法接受 `conversationId` 与 `skill/expert` 资源做订阅检查；它不创建 worker、不返回 session 消息流，也未在这里实现按 client/cwd 授予消息流所有权的 gate。[S@3053529、3013876、3014679、3036725、3041844] |
| sibling events 是否可替代？ | broker 具有连接/channel 撤销通知 `pipe_revoked`，并在账号变化时撤销连接；这属于生命周期通知，未接成模型或 worker 消息订阅。[S@3036569、3047544、3053529] |

## 可执行性判断与边界

`CODE_CONFIRMED`：正常 registry 的可见/方法检查、当前两项 call 注册、fetch 缓冲/响应上限/超时、生命周期撤销。`RUNTIME_NOT_TESTED`：当前连接实际列出的 pipes、登录态可见性、具体上游模型路由、完整 Agent 行为。没有把静态方法名称、协议中的 `stream` 字样或内部宿主能力当作外部客户端 grant。

因此，继续完善现有 request-plane 时，应保留“仅可验证现有 call 通路”的能力声明；这次审查没有提供可直接替换为完整流式/长请求能力的正常 registry 接口。若后续官方增加独立 streaming/worker pipe，仍需分别验证注册、外部客户端 grant、增量输出、取消与仅自有会话的 ownership 边界。[S@3040428、3041844、3047544、3053529]

本轮未读取 `~/.workbuddy` 的账号、endpoint、日志或 sessions；未读 demo 笔记或浏览 UI；未联网、发送 RPC/模型请求、咨询官方、注入、伪造身份或提取凭据；只新增本报告。没有把本边界内未发现的通路推断为厂商所有代码中都不存在。
