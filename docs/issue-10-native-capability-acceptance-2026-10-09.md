# Issue #10 原生通路 MCP 与图片补充验收

日期：2026-10-09。基线：已发布的 `2.6.16`，提交 `1ec17ad6c1eca7e9b380fe3510773e92e3a0428e`。`2.6.17` 只同步版本与验收说明，生产实现不变。

真实合成 MCP 的单次批准、结果回传及工具调用后自有进程清理通过，Obsidian 批准卡链路也通过。正式构建的图片 GUI 首次出现 `refusal`；后续对照成功，但没有稳定复现或定位原因，不将该失败改记为通过，也不关闭 Issue #10。

## MCP 协议与进程清理

使用生产 `startWorkbuddySidecar`、HostConnection、内置 CLI 和原 WorkBuddy 账号。合成 stdio MCP 只回传固定输入与独立随机证明，不访问文件或网络；只批准精确工具与参数的一次调用，其他权限请求拒绝。

- 模型请求 1 次，批准、工具调用、工具完成各 1 次；独立结果及最终回复匹配。
- prompt 前、工具完成后、prompt 完成后均准确识别 1 个自有 CLI 和 1 个合成 MCP。归属按调用前进程表、透明 spawn 记录、PID/启动时间/命令同一性、父子链及精确 cwd 判定，不把 runner 的其他后代算作 worker。
- 生产 dispose 后及最终检查时，两类自有进程均为 0；观察到 CLI 自然关闭，未手工清理，原 WorkBuddy 保留。脚本实际退出 0，退出后独立检查仍为 0。

证据：`/tmp/workbuddian-mcp-posttool.UGGzCp/final-report.json`、`post-exit-check.json`、`posttool-acceptance.ts` 和 `launch.cjs`。该结果只覆盖此合成 MCP，不代表所有 MCP 兼容或长期运行通过。

上一轮两次宽泛 runner 后代计数的 `CLEANUP_FAILED` 报告保持原样。本轮新证据证明这一新调用的精确生命周期，不追溯改写旧失败。

## MCP 批准卡界面

Computer Use 在仅含合成笔记与本项目插件的独立 `gui-vault` 中，通过设置表单添加上述 MCP，列表与 JSON 同步。使用正式 `2.6.16` 构建，默认模式、Auto 模型，发送一次精确工具请求；在显示对应工具及参数的卡片上点击一次“允许”，未选择“总是允许”。

界面显示允许状态、正确的独立证明及最终回复，恢复发送状态；自建 Vault 持久化数据中的助手回复也匹配。随后移除该 MCP 设置以恢复图片初次测试条件。没有更改原用户 Vault 的配置或内容。

## 图片失败与对照

附件是左右分别为红色、蓝色的 `64×32` 合成 PNG，113 字节。GUI 使用原生附件选择器，缩略图可见；全新会话采用 Auto、默认模式、启用思考，要求只判断颜色、不调用工具。

1. 正式 `2.6.16` 构建第一次显示“本轮中断：refusal”，错误会话保留。缺少本次失败的原始响应证据，不能推断是登录、额度、图片编码或模型不支持。
2. 生产 AcpClient/AcpSession 协议对照分别使用相同 Auto 配置、动态返回的 `glm-5v-turbo`。两次均准确判断颜色，`end_turn`，无工具或权限请求，无认证、额度、模型/图片不支持、超时等分类证据。结果为 `GUI_REFUSAL_NOT_REPRODUCED`，不是 GUI 全验收通过。
3. 自建 Vault 临时诊断构建只记录合成请求的块数量、字节数、匹配标记、结束原因与错误分类，不记录正文、图片载荷、凭据或原用户数据。相同问题与附件再次成功：1 个匹配原文件的 image block、113 字节、无路径回退，`end_turn`，无 RPC/认证错误。

证据：`/tmp/workbuddian-image-diff.6ZxuaZ/result.json` 和 `diff-probe.ts`；`/tmp/workbuddian-native-final-acceptance.qMNo79/image-ui-trace.ndjson` 和 `trace-build.cjs`。诊断仅写临时构建，没有修改仓库生产源码。

测试窗口已关闭，独立 Vault 的三个插件文件已恢复为正式 `2.6.16` 资产并逐字节核对，确认不含诊断标记。正式 `main.js` SHA256 为 `e5ccd54181723d683ee8d6f826ba6eadec247db8dcdfbab859ebdb17d6512332`。后续成功不能证明首次拒绝的原因已解决；`2.6.17` 不包含针对该拒绝的代码修复。

## 仍需验收的范围

当前 WorkBuddy 5.7.7 的正常 WBIPC 启动注册面仅发现 `call` 方法，没有可直接替代完整流式/长任务的合法外部接口，见[有界能力审查](issue-10-wbipc-streaming-capability-2026-10-09.md)。原生约 50 秒 / 640 KiB / 完整缓冲限制仍在，不以伪身份、宿主注入、提取密钥或额外权限绕过。

图片首次 GUI 拒绝、Windows 实机、长任务、大附件、跨 sidecar/Native 的旧历史迁移、长期运行和账单额度差值尚未验收或解决。Issue #10 保持开放，不能将本次有限补验称为完整高可用验收。

## 2.6.17 发布前验证

当前仓库重新运行 `npm test -- --runInBand --roots tests --detectOpenHandles --json`：53 套、688 项通过，0 失败、0 开放句柄，测试进程自然退出 0。`npm run build` 类型检查与生产构建退出 0；源码、测试、正式 `main.js` 和 `styles.css` 均与 2.6.16 无差异。证据位于 `/tmp/workbuddian-release-2617.sRdVIS/tests.json`、`tests.log` 和 `build.log`。最低 Obsidian 版本保持 `1.7.2`，没有新增 Obsidian API 使用。
