# Workbuddian ACP v2 + 乙方案详细手测报告

- 执行日期：2026-08-03（EDT）
- 测试计划：`docs/manual-test-2026-08-03-acp-v2.md`
- 测试方式：Obsidian `demo-vault` 真实 GUI + Computer Use；不做 TDD，不修改产品源码
- 结果：**8 PASS / 10 FAIL / 1 阻塞**（共 19 项）
- 结论：**不建议按当前已安装测试包验收。** 计划模式、外部文件授权、工具结果渲染、取消/进程退出、fork 等关键链路仍有阻断问题。

## 1. 环境与证据边界

| 项目 | 实测值 |
|---|---|
| Obsidian | 1.12.7 |
| Vault | `/Users/jiang/claude/workbuddian/demo-vault` |
| Workbuddian | 1.5.0，`minAppVersion=1.7.2` |
| CodeBuddy CLI | `/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy` |
| 已安装 `main.js` SHA-256 | `0bdc661530ea423fc23570a3acd97ecd0860b541ced2e968f548551ac52b0e4d` |
| 已安装 `manifest.json` SHA-256 | `3fd910c2f0ada3b46d8cd8ee6d9197f880aedb5f869c26dd3155c94b289d1702` |
| 已安装 `styles.css` SHA-256 | `c75e834d3351f9dcb2013dcfb961a70c3559dfa261f4dc5fa7a415e730326683` |
| 测试前备份 | `/tmp/workbuddian-acp-v2-test-ElCRQA/demo-vault.before` |
| CLI smoke 日志 | `/tmp/workbuddian-acp-v2-test-ElCRQA/acp-smoke.log`、`acp-smoke-rerun.log` |

本轮开始时，仓库候选包与 `demo-vault` 已安装包哈希一致。测试及报告期间仓库被并行推进；最后复核时为 `ee4e291`，仓库 `main.js/styles.css` 已分别变为 `3cb460...` / `290224...`，但 Vault 仍加载上述旧哈希。其中 `ee4e291` 正好涉及 inline edit DiffModal，但发生在 C4 测试完成后且未安装到 Vault。因此本报告只评价**实际安装并操作过的测试包**，不评价这些后续提交。

测试前已用 `diff -qr` 验证备份与 Vault 一致。用户明确说明 Vault 全部为测试数据。本轮没有新增测试代码、没有修改产品源码，也没有提交 Git。

## 2. CLI 前置检查

`node scripts/acp-smoke.mjs` 连续运行两次，均为 **8 passed, 1 failed**：

- 第一次：首轮 7.9s，第二轮 4.6s。
- 第二次：首轮 7.0s，第二轮 4.8s。
- 两次唯一失败均为：`plan 模式收到 DeferExecuteTool 计划批准请求`。
- 脚本在存在 1 个 FAIL 时仍返回退出码 0，存在 CI 假绿风险。

## 3. 逐项结果

| 编号 | 结果 | 真实 GUI 证据与备注 |
|---|---|---|
| A1 | PASS | 两轮上下文正确：第二轮准确复述“只回复两个字：收到”。smoke 两次均显示第二轮明显更快。 |
| A2 | FAIL | Allow、Always allow、Reject 的文件副作用均正确；但 Reject 后最终回复只是英文内部意图 `The user wants me to delete...`，没有说明操作被拒绝。 |
| A3 | FAIL | 出现“计划已就绪”卡；点“按此执行”后又生成第二张可操作的重复计划卡，界面持续 Stop，`approval-test.md` 未追加第二行。与 smoke 的同项失败一致。 |
| A4 | FAIL | 主面板最终被截断，另一面板未被连带终止，说明定向隔离部分成立；但“停止”不是立即生效，需多次操作，主输出已到约 1940；侧栏 Stop 经鼠标、AX、键盘激活均不生效。严格标准不通过。 |
| A5 | PASS | `pkill -f 'codebuddy.*--acp'` 后出现准确中文错误卡；同会话重发后正常恢复，并准确复述中断前的 A4-B-LONG 指令。 |
| A6 | PASS | Node 版旧 CLI 桩连续两次得到“当前 codebuddy CLI 版本过旧...”专用卡；点自动检测恢复真实路径后正常回复“路径已恢复”。 |
| A7 | PASS | `data.json` 中会话有 `acpSessionId=5b6e8415-9d16-4ecf-9550-59e28b5b3aec`；退出并重开 Obsidian 后，准确回答上一条要求是“只回复路径已恢复”。 |
| A8 | FAIL | 对含消息、含 `acpSessionId` 的会话右键，只有“重命名 / 删除对话 / 导出为笔记 / 复制到剪贴板”，没有“分叉当前会话”；两个边界 Notice 也无法进入。 |
| B1 | FAIL | 面板显示“完全访问”仍弹 Write 批准卡。展开工具详情只有 `Read`、`Write` 名称，Write 行没有路径，完成后没有独立 diff 块。 |
| B2 | FAIL | Edit 确实把第一行改为“秋天来了”，批准卡内有红删绿增；完成后没有默认折叠的“改动 note-test.md”结果块。 |
| B3 | FAIL | B2 完成态没有“撤销此修改”按钮，无法通过 UI 回滚；文件保持“秋天来了”。 |
| B4 | PASS | 两面板分别创建 `b4-main-{a,b,c}.md` 和 `b4-side-{a,b,c}.md`，文件内容正确，卡片未串到另一面板。侧栏虽为“完全访问”仍要求 Bash/Write 批准，另记为权限模式问题。 |
| B5 | FAIL | 默认模式依次出现 Bash、Write 批准请求，但流程随后变为“本轮响应超时，已中断”；`regression-check.md` 不存在，也没有完成态 diff。 |
| C1 | FAIL | Vault 外附件 `/Users/jiang/Downloads/workbuddian-acp-v2-external.txt` 未出现 Read 批准卡，模型直接返回首行 `EXTERNAL-ACP-V2-MARKER`。 |
| C2 | PASS | `@[[AI 评估与安全]]` 引用成功，回答准确概括笔记中的评估方法与安全风险。 |
| C3 | PASS | `/clear` 新建空会话；`/resume` 打开“选择要恢复的对话”弹窗，列出标题、消息数和时间。 |
| C4 | 阻塞 | 选中文本后，命令面板能检索到“Workbuddian: 用 CodeBuddy 编辑选区”；但 Obsidian/Computer Use 返回的命令结果无可点击 frame，且弹层在截图中不可见，无法可靠进入指令/diff/接受步骤。不能据此判产品失败。 |
| C5 | PASS | 新建、坐标切换、重命名为 `C5-renamed`、导出为笔记均成功；删除后 `data.json` 中该标题计数为 0。删除后正文短暂留在侧栏，见改进项。 |
| C6 | FAIL | 切换英文配置并重启后，工具栏和批准卡显示 `Allow / Always allow / Reject`，该部分通过；但英文长任务中杀掉 ACP 后，进程已不存在，界面超过 10 秒仍为 `Thinking... / Stop`，未出现英文错误卡。 |

## 4. Issue 清单

### WB-ACP-V2-001 [P0] Plan 批准重复并挂起，不能同轮执行

**复现**：计划模式发送追加文件任务，点“按此执行”。

**实际**：第一张卡变“已允许”，随后出现第二张完整可操作计划卡；请求不结束，文件不落盘。CLI smoke 两次同样未收到预期 `DeferExecuteTool` 批准请求。

**期望**：批准只消费一次，同一轮继续执行并产出工具结果/diff。

### WB-ACP-V2-002 [P0] Vault 外附件绕过 Read 批准

**复现**：默认模式附加 Downloads 下文本文件并要求读取首行。

**实际**：没有 Read 卡，直接返回外部文件内容。

**期望**：所有 Vault 外读取都走 `session/request_permission`，允许后再读。

### WB-ACP-V2-003 [P1] “完全访问”模式仍请求批准

**复现**：两面板均明确显示“完全访问”，执行 Write/Edit/Bash。

**实际**：新会话仍弹 Write、Edit、Bash 批准卡；只有此前点过 Always allow 的工具类型免询问。

**期望**：完全访问由会话创建到每次工具请求均一致生效，不应退化为默认模式或依赖 Always allow 缓存。

### WB-ACP-V2-004 [P1] 乙方案增量工具行、完成 diff、撤销链路缺失

**实际**：工具详情仅见 `Read` / `Write` 名称；Write 路径不回填；完成后没有独立 diff；Edit 只有批准卡内 diff；没有撤销按钮。

**影响**：B1、B2、B3、B5 的核心验收目标均失败。

### WB-ACP-V2-005 [P1] Stop 与 ACP 退出收敛不稳定

**实际**：主面板停止延迟且需多次操作；侧栏 Stop 不生效。A5 杀进程能正确报错恢复，但 C6 同类操作留下永久 `Thinking... / Stop`，无进程、无错误卡。

**期望**：每个面板按 session/request 精确取消；进程退出后所有活跃请求在固定时限内统一转为终态。

### WB-ACP-V2-006 [P1] 等待批准期间错误进入响应超时

**复现**：B5 默认模式创建文件，依次处理 Bash/Write 批准。

**实际**：批准尚未完成即“本轮响应超时，已中断”，目标文件未创建。

**期望**：等待人工批准期间暂停响应超时计时，批准后恢复。

### WB-ACP-V2-007 [P1] 会话分叉入口未交付到已安装包

**实际**：右键菜单没有“分叉当前会话”。

**期望**：已发消息会话显示分叉入口，空会话/流式会话给出计划中的边界 Notice。

### WB-ACP-V2-008 [P1] Smoke 有 FAIL 仍返回退出码 0

**实际**：两次均打印 `8 passed, 1 failed`，进程退出码仍为 0。

**影响**：CI 或发布脚本可能把失败构建判为成功。

### WB-ACP-V2-009 [P2] Reject 后回复泄露英文内部意图且未解释拒绝

**实际**：卡片已拒绝、文件未删，但回复为英文 `The user wants me...`，没有说明权限被用户拒绝。

### WB-ACP-V2-010 [P2] 删除会话后正文短暂保留

**实际**：`data.json` 已删除会话，标签也消失，但侧栏仍显示该会话旧正文，直到后续切换/刷新。

### WB-ACP-V2-011 [P2] 非预期 CLI 启动错误直接展示 Node 堆栈

**实际**：用 shell 版错误桩时，错误卡和 Notice 展示 `/cjs/loader`、`Module._load` 等完整运行时堆栈。

**期望**：保留日志中的完整诊断，用户卡片只展示可操作摘要。

## 5. 改进建议

1. 将权限模式作为 ACP session 的显式状态，在 `session/new/load`、重连和每次权限请求前校验；为 default/plan/full 各加一条真实副作用集成测试。
2. 将外部附件统一转换为“待授权资源”，不要在发送前把外部路径加入隐式可读范围；批准结果应绑定规范化绝对路径。
3. 工具事件以 `toolCallId` 做单一 reducer：初始工具名、参数快照、完成状态、diff、undo 元数据都更新同一实体；不要让批准卡代替工具结果卡。
4. 人工批准等待应使用独立状态，不计入 CLI 响应超时；批准卡必须有 settled/expired 原子状态，避免重复卡与晚到事件。
5. ACP 进程管理器维护活跃请求表；`exit/error` 时一次性结束全部对应请求，UI 在 1 秒内从 streaming 转 error，且 Stop 始终只取消目标 request。
6. 把 fork 菜单、空会话边界、流式边界加入安装包级 E2E，避免源码已有但构建产物遗漏。
7. smoke 汇总后执行 `process.exitCode = failed > 0 ? 1 : 0`，并在 CI 中断言退出码和报告文本两者。
8. 删除当前会话后立即选择相邻会话或创建空会话，并清空旧 message view，避免标签与正文状态分离。

## 6. 清理说明

已退出 Obsidian，并把测试后 Vault 完整保留到 `/tmp/workbuddian-acp-v2-test-ElCRQA/demo-vault.after`。随后从 `demo-vault.before` 恢复测试前基线；`diff -qr` 无输出，恢复目录与备份一致。临时旧 CLI 桩和 Downloads 外部附件均已删除。
