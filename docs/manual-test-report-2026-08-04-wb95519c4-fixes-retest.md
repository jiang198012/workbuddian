# 95519c4 修复回归手测报告（重启后重测）

> 执行时间：2026-08-04 03:22-04:01 EDT  
> 测试清单：`docs/manual-test-2026-08-04-wb95519c4-fixes.md`  
> 被测提交：`95519c49e704bb2325ad15500964d4eb186939d9` + 当前未提交修复补丁  
> 测试环境：Obsidian 1.12.7 / `demo-vault` / Workbuddian  
> 结论：**5 PASS / 9 FAIL / 0 阻塞**

## 1. 本轮有效性与边界

上一份 `manual-test-report-2026-08-04-wb95519c4-fixes.md` 没有证明 Obsidian/插件已重启，不能作为新版验收结论。本报告为独立重测结果，并取代上一份报告的验收结论。

- 重启前 Obsidian PID：`45154`；通过 GUI 正常退出。
- 重启后 Obsidian PID：`50612`，启动时间 `Tue Aug 4 03:22:13 2026`。
- 仓库与已安装插件构建一致：
  - `main.js`：`670bdc31b54c570b572c6186c3f16e24865d559a0a00131cd18f8fc667bb1a6e`
  - `manifest.json`：`3fd910c2f0ada3b46d8cd8ee6d9197f880aedb5f869c26dd3155c94b289d1702`
  - `styles.css`：`63ff7ba2b722e51e81d0197a817a06d28499882cf17029b40ec07f5ba65a96d3`
- F1-F7 首轮使用 `hy3`。用户在 F8 前切换为 `deepseek`；F8-F14 使用 `deepseek`。
- 为排除大模型服务波动，F1、F6、F7 又使用 `deepseek` 做了定向复核。
- CLI smoke 首轮：`12 passed, 1 failed`；仅 plan 随机探针收到 Bash 而非 DeferExecuteTool。第二轮因等待过长按用户要求中止，不作为判定依据。

## 2. 逐项结果

| 编号 | 结果 | 实测证据 |
|---|---|---|
| F1 自动标题连续对话 | **FAIL** | deepseek 复核：首轮正常回复并生成标题“回复\"收到\"的测试”；随后第二、三、四轮连续出现“（无响应，请重试）”。关闭自动标题时连续两轮正常。 |
| F2 vault 外附件授权 | **FAIL** | 发送前授权窗、完整路径、取消后正文和 chip 恢复均正确；但“允许一次”和“总是允许”均只关闭弹窗，没有继续发送，`allowedExternalPaths` 仍为 `[]`。 |
| F3 Write 完成态 | **FAIL** | `note-test.md` 已创建，批准卡保留完整路径；完成态没有默认折叠的全绿 diff。完全访问模式仍弹 Write 批准卡。 |
| F4 Edit diff 与撤销 | **FAIL** | 红删绿增 diff 可见，文件首行实际变为 `# 秋天来了`；没有“撤销此修改”按钮，无法执行和验证回滚。 |
| F5 默认批准链 | **FAIL** | 明确重述后批准卡和文件落盘成功，`regression-check.md` 内容为 `ok`；完成态仍没有 diff。清单原句被模型误解，使用等价明确指令完成插件链路验证。 |
| F6 GUI 分叉 | **FAIL** | 分叉成功并复制全部历史；deepseek 下分叉会话能回答暗号 `ALPHA`，切回原会话后相同提问立即“无响应，请重试”。 |
| F7 双面板 | **PASS** | deepseek 复核：A 运行 1-300 计数并被定向停止；B 随后完整输出雨诗，两个面板历史不同且内容未串。hy3 首轮的 B 无响应归为服务波动，不覆盖 deepseek 的有效通过结果。 |
| F8 inline edit | **PASS** | remove/add 行为浅色行底，实际变化词有更深底色；接受后内容替换且弹窗计数为 0；拒绝变体弹窗同样完全消失，拒绝文本未落盘。 |
| F9 thought_level | **FAIL** | 设置 high 后消息正常；`/effort low` 返回确认，设置页立即显示 low。但日志没有 `session/set_config_option`，后续子代理配置触发 CLI 重启后设置又显示 high，low 未持久保持。 |
| F10 图片粘贴 | **PASS** | Finder 复制 PNG 与区域截图均生成 chip 并成功发送；AI 分别识别 Obsidian 图标和“AI 学习地图”界面，无 Read 工具调用。Finder 文件被转存到 `pasted/`，未触发 F2 外部授权窗，见 issue。 |
| F11 Reject 本地化 | **PASS** | 卡片变“已拒绝”，终态仅为“该操作已被拒绝。”，无英文内部意图；`reject-test.md` 未创建。 |
| F12 Agent 去重 | **FAIL** | reviewer 子代理被调用，但最终审查内容整段重复两次，WB-010 仍可复现。 |
| F13 MCP JSON 刷新 | **PASS** | 合法 JSON 失焦后立即显示 `wb-retest-mcp /usr/bin/true`；输入非法 `[{` 后提示“JSON 无法解析，未生效”，旧列表保持。 |
| F14 日志三件套 | **FAIL** | 日志只有启动、`initialize`、`session/load` 和一条“无归属会话，已丢弃 ... config_op”；缺少本轮 `session/prompt`、`session/set_config_option`、fork 开始/成功记录。 |

## 3. Issue 清单

### P0

1. **WB-RT-001：自动标题完成后会话路由失效**
   - deepseek 与 hy3 均复现；首轮及标题生成正常，后续消息全部无响应。
   - 关闭自动标题后同类短消息正常，相关性明确。

2. **WB-RT-002：vault 外附件授权按钮没有完成后续动作**
   - “允许一次”没有继续发送。
   - “总是允许”没有继续发送，也没有写入 `allowedExternalPaths`。
   - 取消路径正确，说明问题集中在允许分支。

### P1

3. **WB-RT-003：Write 完成态 diff 仍缺失**
   - 完全访问和默认批准两条 Write 链均复现。
   - 原始批准卡有完整路径，但完成态没有折叠 diff。

4. **WB-RT-004：Edit 完成态缺少撤销按钮**
   - diff 已显示，实际文件也已修改，但 UI 没有“撤销此修改”，因此无法满足实际回滚验收。

5. **WB-RT-005：fork 后原会话无法继续响应**
   - 分叉新会话上下文正确；原会话保留历史但新 prompt 立即无响应。
   - deepseek 定向复核仍稳定复现，不能仅归因于服务不稳定。

6. **WB-RT-006：thought_level 出站日志缺失且 `/effort` 同步不持久**
   - UI 能从 high 乐观变为 low，但看不到 `session/set_config_option` 旁证。
   - CLI 重启后恢复 high，说明 low 没有持久写回设置。

7. **WB-RT-007：Agent 最终文本仍重复**
   - reviewer 结论以近乎相同结构连续输出两遍，WB-010 未修复。

8. **WB-RT-008：出站/fork 可观测日志没有产生**
   - 执行了普通 prompt、配置变更、fork、工具调用，日志仍停留在启动阶段。
   - 同时存在“无归属会话，已丢弃 ... config_op”，是当前路由问题的重要线索。

### P2 / 改进建议

9. **WB-RT-009：Finder 复制的外部图片绕过外部路径授权语义**
   - 剪贴板中的 Finder 文件被立即复制到插件 `pasted/`，因此发送时不再识别为 vault 外路径。
   - 若产品预期所有 vault 外来源均需显式授权，应在复制落盘前保留来源路径并执行 F2 授权；若这是设计行为，应更新 F10 清单，避免与 F2 联动预期冲突。

10. **完全访问模式仍弹 Write/Edit 批准卡**
    - 不影响本轮 diff 缺陷判定，但与“完全访问”用户心智不一致；建议明确权限模式合同并补一条独立验收用例。

## 4. 验收结论

本补丁**不建议按“11 项修复已全部通过”验收**。当前 14 项中 5 项通过、9 项失败；其中自动标题后续无响应、外部附件允许分支失效、fork 后原会话失效为优先修复项。双面板、inline edit 关闭路径、图片粘贴、Reject 本地化、MCP JSON 即时刷新已通过本轮 GUI 验收。

## 5. 测试数据恢复

- GUI 正常退出 Obsidian 后，将测试结束现场归档到 `/tmp/workbuddian-wb95519c4-retest-8YHnTr/demo-vault.after`。
- 从 `/tmp/workbuddian-wb95519c4-retest-8YHnTr/demo-vault.before` 恢复 `demo-vault`。
- 恢复核验：备份与恢复后均为 39 个文件，`diff -qr` 输出 0 行。
- 已删除本轮在 Downloads 创建的两个外部文本附件和一张 PNG 测试图片。
