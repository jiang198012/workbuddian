# 原账号模型目录修复与验证

验证时间：2026-10-09；范围：当前 Mac、WorkBuddy 原个人账号、Workbuddian 发布前修复阶段。

## 结论

旧的 9 项清单来自 WorkBuddy 内置 CLI 的产品配置启动缓存，不是插件菜单临时拼出的兜底目录。新进程仍可读取该缓存：产品初始化先发布缓存，普通外部 ACP 的初始化模型快照随后一直复用首次配置。

只注入新目录时，真实 fresh ACP 仍返回旧 9 项；为本插件创建的 sidecar worker 增加 `CODEBUDDY_DISABLE_PRODUCT_CACHE=1` 后，同一原账号返回 17 个目录条目，`session/set_config_option` 的当前值确认是 `glm-5.3`。没有读取、删除或改写宿主产品缓存，没有伪装桌面客户端身份。

## 修复内容

- 通过宿主现有账号代理读取官方 `/console/enterprises/personal/models` 云端目录，保留上游 CLI 名单顺序和真实模型 ID；沿用原登录与额度。
- sidecar 与 Native 启动都注入该目录，保留安装包辅助 agent 配置；只接纳模型能力白名单，不接纳上游凭据、路由或指令。
- 停用模型只过滤自身；目录失败明确报错，不以旧静态型号冒充实时清单。
- 指定模型设置失败时中止发送，不悄悄按旧模型继续请求。
- 目录发现串行排队并使旧活动指针失效，防止发现会话抢走聊天上下文。
- 菜单使用动态名称及顺序，同名条目保留首个真实 ID。

## 验证证据

诊断输出：`/tmp/workbuddian-catalog-sync.7WLmvh/`，均为白名单摘要，不包含账号凭据或笔记正文。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 新目录注入但未跳过缓存 | 旧 9 项，验收失败 | `fresh-client-result.json` |
| 跳过缓存后 fresh sidecar ACP | 17 项，选中 `glm-5.3`，自有进程清理完成 | `fresh-client-cache-disabled-result.json` |
| 真实 Native 原账号调用 | 仅一条合成消息；出站 ID `glm-5.3`，HTTP 200，`end_turn`，0 次权限请求，清理完成 | `native-real-model-call-result.json` |
| 并发活动指针回归 | 修前 `wrong active session`；修后 `new:discovery → load:chat → prompt:chat`；相关 88 项通过 | `discovery-concurrency-{red,green}.json` |
| 混合停用目录回归 | 修前拒绝整个目录；修后过滤停用项；28 项通过 | `catalog-helper-disabled-{red,green}.json` |
| 定向相关回归 | 7 个测试文件，171 项通过，0 失败，0 遗留句柄 | `final-targeted.json` |
| 类型检查与生产构建 | `npm run build` 退出码 0；`git diff --check` 通过 | `final-build.log` |
| demo-vault 正常插件重载、实际菜单 | 16 项，Hy3 仅一项，无目录错误提示 | Computer Use 的公开菜单 AX 验证 |

真实调用的响应标记没有完整捕获，诊断保守地记作 `REAL_MODEL_CALL_NOT_CONFIRMED`。因此本次只确认实际出站模型 ID、HTTP 状态和正常轮次结束，不宣称测试标记输出验收通过；没有补发第二条消息。

demo-vault 菜单顺序：Auto、Hy4 preview、Hy3、Space-Bunny、Deepseek-V4.1-Flash、GLM-5.3、GLM-5.3-Flash、GLM-5.2、GLM-5.1、GLM-5v-Turbo、Kimi-K3、Kimi-K2.8-Preview、Kimi-K2.7-Code、Kimi-K2.6、MiniMax-M3、Deepseek-V4-Pro。上游另有同名 `hy3-x`，界面保留先出现的 `hy3`，故原始 17 项去重后为 16 项。

## 测试安装与边界

`2.6.18` 发布前重新运行全量回归：54 套、730 项通过，0 失败、0 开放句柄，测试进程自然退出 0；类型检查与生产构建通过。现有无系统 Node 启动夹具补齐新增账号目录接口后，真实 sidecar/worker 三项回归通过；没有为测试放宽生产目录校验。证据：`/tmp/workbuddian-release-2.6.18.f9Arh1/tests-green.json`、`build-green.log`。

测试安装仅替换 `/Users/jiang/claude/workbuddian/demo-vault/.obsidian/plugins/workbuddian/main.js`，已通过现有插件开关正常重载，启用状态恢复为开启；没有编辑笔记或旧聊天内容，也没有调整登录、模型等用户配置。原三份插件资产备份在 `/tmp/workbuddian-demo-model-backup.5tdhgn/`。验收时脚本 SHA-256 为 `4fd71ea2b63fa9855607bd85e0e543c795c97ef3e7b52eee6e1c721ea6aa7982`，当时仓库构建与测试安装一致。

- 目录来自当前原账号的官方云端 CLI 清单；桌面默认本地/实验配置菜单尚未逐项 GUI 比对，不能宣称所有桌面模式完全一致。
- 当前固定个人账号目录路径；企业账号目录选择和 Windows 实机兼容性未验收。
- 每次新 worker 启动获取目录；没有宣称长期 worker 内目录实时推送更新。
- 上述验收发生在 `2.6.17` 的本地修复构建；`2.6.18` 收录本修复，实际发布状态以远端 Release 和引用为准。原有 `CLAUDE.md` 改动和旧诊断文档不纳入本次提交。
