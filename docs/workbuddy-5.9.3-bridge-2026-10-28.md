# WorkBuddy 5.9.3 本地桥接失效排查（2026-10-28）

## 现象

Obsidian 插件选择 `workbuddy` 后端后，发送消息最终报
「WorkBuddy 本地账号代理未就绪，请确认已正常启动并登录」；
Hermes 后端则报 `Failed to fetch`。两个后端同时不可用。

## 环境（本轮实测）

- WorkBuddy 5.9.3（build `64d249b`），CLI `2.165.0`，已登录。
- `app.asar.unpacked/cli/dist/` 只有 `codebuddy-lite-wb.mjs` 与 `lazy-lite-wb/`；
  `bin/codebuddy` 在 `--acp` 下仍会 `require('../dist/codebuddy-headless')`，
  该产物已不存在，普通 Node 直起 `codebuddy --acp` 会 `MODULE_NOT_FOUND`。
  宿主自己的 worker 走 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1`，因此正常。
- Hermes Agent 0.22.5，gateway 端口 8642。

## WorkBuddy 断点

1. 插件原有的连接依赖宿主 WBIPC 的 `wb.request/http.fetch` 账号代理。
   5.9.3 的握手 `session_hello_ack.pipes` 只有：
   `["wb.entitlement", "wb.wecom-a2a"]`；
   `broker/GetPipe {pipe:"wb.request"}` 返回 `E_PIPE_UNKNOWN`。
   插件因此无法再借助宿主转发模型请求。
2. 插件原设计的兜底是宿主 sidecar（`~/.workbuddy` 运行目录下的
   `sidecar.pid` + `sidecar-<uuid>.sock`，协议版本 6）。5.9.3 的
   `protocol.js` 仍使用同一路径与版本，插件侧兼容；但 sidecar 只在宿主
   真正开始一个会话时才由 `SidecarManager.ensureSidecar()` 拉起。
3. 过去用于强制触发 `listSidecarSessions` 的 `workbuddian-warmup`
   连接扩展是直接写入 `~/.workbuddy/extensions/` 的散装扩展；
   5.9.3 的扩展包管理器要求签名包/目录元数据，当前扩展未再被加载。

结论：WorkBuddy 5.9.3 移除了第三方插件可用的账号代理通道，且不再加载
旧的散装 warmup 扩展；仅安装并登录 WorkBuddy 不足以让插件自动接通模型。

## 可用绕过

先在 WorkBuddy 中打开任意对话（或点击新建对话），让宿主启动
`sidecar.pid`；随后回到 Obsidian 重发消息，插件会走 sidecar 通路
（`session.create` → `/api/v1/acp`）。在宿主已启动 sidecar 的前提下，
该通路与 5.9.3 的协议兼容。

## 本轮插件改动

- `workbuddyNative.ts`：worker 改用 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1`
  （5.9.3 只发 lite 包）；`wb.request` 缺失时等待 3 秒短窗口后快速失败，
  给出可操作的提示，不再空等 30 秒。
- `hermes` 后端：gateway 未监听时自动后台拉起 `hermes gateway run`；
  API key 改为优先读 `.env`（gateway 实际进程环境），并在加载时校正
  旧 `config.yaml` key；`sendMessage` 等待 init 完成，消除首条消息误走
  HTTP 的竞态。
- 已在 demo-vault 用插件 provider 端到端验证 Hermes（ACP/HTTP 均返回
  「收到」），并验证 gateway 停止后能被自动拉起。

## 推荐的一劳永逸方案：官方 CodeBuddy CLI（2026-10-28 验证）

官方 npm 包 `@tencent-ai/codebuddy-code`（本轮实测 2.177.1）自带完整
TUI、headless 与 stdio ACP，是公开、可版本化的产品接口：

```bash
npm i -g @tencent-ai/codebuddy-code
```

插件内已提供“傻瓜式”一键登录：设置 → CodeBuddy 登录 → 点“登录 CodeBuddy”。
插件会自动启动官方 CLI 的临时 Web UI 登录页并用系统浏览器打开；用户选
Chinese Site / iOA / 企业域名 完成登录即可，全程不需要终端 `/login`。未登录时
在聊天里发消息，也会自动弹出这个登录窗口。

CLI 路径留空即可（自动发现优先官方 CLI），或显式填 `$(which codebuddy)`。
之后插件用 `codebuddy --acp` 走 stdio，不再经过 WorkBuddy 桌面端的
WBIPC / sidecar / 扩展。终端 `codebuddy` → `/login` 仅作为备用手段。

本轮验证：官方 CLI 的 `--acp` `initialize` 成功；未登录时 `session/new`
返回 `Authentication required`。官方 CLI 的 Web UI 已确认包含 Sign In 页面
（Chinese Site / International Site / Enterprise Domain / iOA），插件的一键
登录服务也已实测能完成“启动 → 网关 token → ACP 探测”链路。注意 CLI 账号的
订阅/额度以该账号在 CodeBuddy 侧的权益为准。

## 如果必须沿用桌面端账号：彻底修复所需

需要 WorkBuddy 提供受支持的第三方集成面，例如：
- 恢复 `wb.request/http.fetch` 账号代理；或
- 允许受信任本地扩展触发 sidecar（签名包/官方扩展白名单）；或
- 提供公开的 ACP/HTTP 会话入口（含账号注入）。

在得到上述任一能力前，插件只能采用 sidecar 绕过，并明确提示用户。
