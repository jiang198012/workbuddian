# 手测详单：ACP provider v2 + 乙方案增量渲染（2026-08-03）

> 被测版本：ACP v2（12 commit）+ 乙方案（5 commit），已装入 `demo-vault`。
> 测试环境：Obsidian + demo-vault + WorkBuddy 桌面版（已登录，CLI 支持 `--acp`）。
> 执行方式：逐项按步骤操作，对照"预期/PASS 判定"记录结果（模板见文末）。

---

## 0. 前置检查

1. **CLI 侧预检**（不装插件也可跑）：
   ```bash
   cd /Users/jiang/claude/workbuddian && node scripts/acp-smoke.mjs
   ```
   预期 `9 passed, 0 failed`。任何 FAIL 先解决 CLI 侧问题（版本/登录），再进 UI 测试。
2. **插件已重载**：设置 → 第三方插件 → Workbuddian 关闭再开启（或重启 Obsidian）。
3. **打开两个面板**（后续多项测试需要）：
   - 侧边栏：点 ribbon 小猪图标（tooltip「Workbuddian 聊天」），或命令面板「打开聊天面板」；
   - 主编辑区：命令面板「在主编辑区打开大面板」。
4. **日志入口**：设置 → Workbuddian →「查看日志」。ACP 相关日志带 `[WB] acp` 前缀，失败排查先看这里。
5. **权限模式**：输入框工具栏的盾牌图标，三档——默认（每步询问）/ 计划模式（只读不改）/ 完全访问。测试初始置为「默认」。

---

## A. ACP v2 六项（spec §7.2 验收）

### A1. 多轮对话上下文保持、第二轮明显更快
- 步骤：任一面板新建会话，发「只回复两个字：收到」；回复后再发「我们刚才说了什么？」
- 预期：第二轮能正确引用第一轮内容（上下文真保持）；主观上第二轮明显更快（首论含系统提示处理。参考值：smoke 实测 7.0s → 4.2s）。
- PASS 判定：上下文正确引用 + 二轮可感知加速。

### A2. 批准卡三按钮各自生效
- 步骤（默认模式）：
  1. 发「创建文件 approval-test.md，内容为 hello acp」→ 应弹出批准卡（标题「工具批准： Write」，正文显示写入路径与行数）。
  2. 点 **[允许]** → 卡片变「已允许」，文件落盘（文件树可见）。
  3. 发「创建 approval-test-2.md，内容 second」→ 再次弹卡，点 **[总是允许]** → 变「已总是允许」。
  4. 发「创建 approval-test-3.md，内容 third」→ **不再弹卡**，直接落盘。
  5. 发「用命令删除 approval-test-3.md」→ 弹 Bash 批准卡（正文为命令全文），点 **[拒绝]** → 变「已拒绝」，文件仍在，AI 回复中说明被拒绝。
- PASS 判定：三次按钮行为各自正确；卡片应答后留存可回看；拒绝后文件未被删。

### A3. plan 模式出真批准、批准后同轮执行落盘
- 步骤：
  1. 盾牌切到「计划模式（只读不改）」。
  2. 发「给 approval-test.md 追加一行『第二行』。先出计划。」
  3. 计划正文应作为正常回复流式输出，随后弹出**「计划已就绪」批准卡**，按钮为 [按此执行] [总是执行] [取消]。
  4. 点 **[按此执行]**。
- 预期：批准后 **CLI 在同一轮里自动继续执行**（不应新增一条用户消息——v1 的 workaround 是重发一轮，v2 是同轮继续）；`approval-test.md` 真实追加成功；执行过程的工具行/diff 照常出现。
- PASS 判定：同轮落盘 + 无新 user 气泡。点 [取消] 的变体可顺带测：不执行、不变「已拒绝」。
- 测完把盾牌切回「默认」。

### A4. cancel 定向（双面板互不影响）
- 步骤：两个面板各切到**不同会话**；A 面板发「从 1 数到 300，每个数字一行」，B 面板发同样内容；两边都在流式时，**只在 A 面板点停止按钮（方块图标）**。
- 预期：A 面板立即停止；**B 面板继续数完**（v1 的 bug 是 A 停止会误杀 B）。
- PASS 判定：B 完整输出到 300。

### A5. 进程被杀后重发自动恢复
- 步骤：任一面板发一个长任务（如「写一篇 300 字短文」），流式中途在终端执行 `pkill -f "codebuddy --acp"`。
- 预期：当前轮报错卡「codebuddy 进程意外退出，本轮已中断。重新发送将自动恢复会话。」；**随后在同一会话再发任意消息** → 正常回复，且仍保有此前上下文（可问「我刚才让你做什么？」验证 `session/load` 恢复）。
- PASS 判定：报错卡文案正确 + 重发后上下文仍在。

### A6. 旧版 CLI 报错卡文案正确（用桩模拟）
- 步骤：
  1. 终端造一个不认识 `--acp` 的假 CLI：
     ```bash
     cat > /tmp/fake-old-codebuddy <<'EOF'
     #!/usr/bin/env node
     console.error('error: unrecognized option: --acp');
     process.exit(1);
     EOF
     chmod +x /tmp/fake-old-codebuddy
     ```
  2. 设置 → Workbuddian →「CodeBuddy 路径」填入 `/tmp/fake-old-codebuddy`。
  3. 面板发送任意消息。
- 预期：错误卡「当前 codebuddy CLI 版本过旧，不支持 ACP 持久会话。请升级 WorkBuddy 桌面版。」；**再发一次不轰炸**（同样直接报错卡）。
- 恢复：路径清空（或点「自动检测」），再发一条确认恢复正常。
- PASS 判定：文案与上述一致 + 恢复后可用。

### A7.（附加）会话恢复链路
- 步骤：发一条消息后，打开 `demo-vault/.obsidian/plugins/workbuddian/data.json`，确认该会话对象里有 `acpSessionId` 字段；重载插件（关闭再开启）；回到同一会话继续发「接着说」类消息。
- 预期：重载后对话仍保有上下文（说明 `session/load(acpSessionId)` 命中）。
- PASS 判定：data.json 有 `acpSessionId` + 重载后上下文保持。

### A8. 会话分叉（fork）
- 步骤：任一会话至少发过一条消息后，右键其标签 →「分叉当前会话」。
- 预期：新会话标题「分叉 - <原标题>」，含原会话全部历史消息；自动切换到新会话；Notice「已分叉」。
- 续测 1：在新会话发「我们前面聊了什么？」→ 回答体现原会话内容（CLI 侧 load 命中）。
- 续测 2：切回原会话继续发消息，记录其行为（CLI 对原 session 分叉后的后续处理未在单测覆盖，如实记录——预期是保持分叉前上下文继续）。
- 边界：未发过消息的会话点分叉 → Notice「先发送一条消息，才能分叉」；流式中点分叉 → Notice「正在响应中，稍候再分叉」。
- PASS 判定：分叉成功 + 新会话上下文保持 + 两条边界 Notice 正确。

---

## B. 乙方案五项（工具行增量渲染）

> 建议 B1–B3 在「完全访问」模式下测（不被批准卡打断观察），测完切回「默认」。

### B1. 工具行文本随快照填充
- 步骤：发「把一段 200 字关于夏天的短文写入 note-test.md」。
- 预期：工具行**先出现**「Write」（无参数）→ 快照到达后变为「Write `<路径>`」→ 完成后该 row 下方出现 diff 块。全程不新增重复行（同一工具调用只有一行）。
- PASS 判定：行文本按序演化 + 单工具单行。

### B2. Edit 完成出 diff 预览
- 步骤：发「把 note-test.md 的第一行改成『秋天来了』」。
- 预期：Edit 工具行完成后，行下方出现 diff 块（默认折叠），点「改动 note-test.md」展开可见红删绿增行。
- PASS 判定：diff 内容与文件实际改动一致。

### B3. 撤销按钮生效
- 步骤：B2 的 diff 块标题栏右侧应有「撤销此修改」按钮，点击。
- 预期：按钮变「已撤销」置灰 + Notice 提示；`note-test.md` 内容回滚到改动前。
- PASS 判定：文件实际回滚。（vault 外文件的 Edit 不出撤销按钮——如遇到属预期。）

### B4. 双面板工具行不串
- 步骤：两面板各发一个会产生多次工具调用的任务（如「创建三个文件 a/b/c.md」）。
- 预期：各自的工具行/diff 只出现在各自面板，互不错位。
- PASS 判定：无串行。

### B5. 批准卡流程不回归
- 步骤：切回「默认」模式，发「创建 regression-check.md 内容 ok」。
- 预期：批准卡正常弹出；批准后文件落盘；该 Write 行在完成后正常出 diff 块。
- PASS 判定：批准 → 落盘 → diff 三者链路完整。

### B6. MCP 服务器注入（设置项）
- 前置：把下面这个最小 MCP server 存为 `/tmp/fake-mcp-server.mjs`：
  ```js
  let buf = '';
  process.stdin.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let msg; try { msg = JSON.parse(line); } catch { continue; }
          const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
          if (msg.method === 'initialize') reply(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '0.0.1' } });
          else if (msg.method === 'tools/list') reply(msg.id, { tools: [{ name: 'echo', description: 'Echo back input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
          else if (msg.method === 'tools/call') reply(msg.id, { content: [{ type: 'text', text: 'ECHO:' + (msg.params?.arguments?.text ?? '') }] });
          else if (msg.id !== undefined) reply(msg.id, {});
      }
  });
  ```
- 步骤：设置 →「MCP 服务器（JSON）」填 `[{"name":"fake","command":"node","args":["/tmp/fake-mcp-server.mjs"]}]` → 新建会话 → 默认模式发「调用 echo 工具，text 传 hello-mcp」。
- 预期：弹批准卡且工具名为 **`mcp__fake__echo`**（**不是**「计划已就绪」——顺带回归 DeferExecuteTool 误判修复）；允许后回答包含 `ECHO:hello-mcp`。
- PASS 判定：批准卡工具名正确 + echo 结果正确。

### B7. 子代理（设置项）
- 步骤：设置 →「子代理（JSON）」填 `{"reviewer":{"description":"审查代码","prompt":"你是简洁的代码审查员，只回一行。"}}` → 会话里发「用 reviewer 子代理审查 const a=1 这行代码」。
- 预期：出现 `Agent` 工具行；回答带来子代理的审查结果。
- PASS 判定：Agent 工具被实际调用。
- 说明：改动该设置会让 CLI 进程自动重启（在飞轮次会按进程死亡链报错收尾，重发即恢复——预期行为）。

### B8. 非法 JSON 兜底
- 步骤：MCP 设置填 `{bad` → 失焦保存。
- 预期：Notice「MCP 服务器（JSON）：JSON 无法解析，未生效」；会话功能不受影响。
- PASS 判定：Notice 正确 + 会话正常。

---

## C. 既有功能回归

### C1. vault 外附件改走批准卡（行为变化，重点）
- 步骤：默认模式下，拖入一个 vault 外文件（如 `~/Downloads/` 下任一文件）作为附件发送。
- 预期：CLI 读该文件时弹 **Read 批准卡**；[允许] 后正常读取回答；选 [总是允许] 则本会话后续外部读取不再弹卡。
- 说明：v1 是静默预授权（`--add-dir` hack），v2 已删除该 hack，外部读取一律走批准卡——这是**有意的行为变化**。
- PASS 判定：弹卡 + 允许后读取成功。

### C2. @ 引用：输入 `@` 选一篇笔记发送 → 回答体现笔记内容。
### C3. 斜杠命令：`/clear` 新建会话；`/resume` 出历史会话选择器。
### C4. inline-edit：编辑器选中一段文字 → 命令「用 CodeBuddy 编辑选区」→ 输入指令 → diff 弹窗 → 接受后选区被替换。
### C5. 会话管理：新建 / 重命名 / 删除 / 切换 / 右键导出 Markdown，均正常。
### C6. 语言切换：设置页界面语言切 English → 批准卡按钮变为 Allow / Always allow / Reject，错误卡英文。测完切回。

### C7. 词级行内高亮
- 步骤：让 AI 对某文件做一处小改动（如「把 note-test.md 里的『秋天』改成『冬天』」）。
- 预期：diff 块中 remove/add 成对行的**变更片段**有加深底色高亮（不是整行一个色）。
- PASS 判定：高亮只覆盖实际变更的词/字。

### C8. Bash 终端输出块
- 步骤：发「执行 echo hello-terminal」。
- 预期：Bash 工具行完成后，行下方出现「输出」折叠块，展开可见 Command/Stdout/Stderr/Exit Code 全文。
- PASS 判定：输出完整、可折叠。

### C9. thought_level 设置
- 步骤：设置页「思考力度」切到 high → 发一条消息 →「查看日志」应见 `session/set_config_option` 带 `thought_level/high`；再发 `/effort low`（斜杠透传）→ 设置页值回流变为 low。
- PASS 判定：下发与回流都生效。

### C10. 原生图片块
- 步骤：粘贴一张截图到输入框 → 发「这张图里是什么？」。
- 预期：AI 直接回答图片内容；**全程没有 Read 工具调用**（v1 是路径注入 + Read 工具读文件）。
- PASS 判定：无 Read 行 + 描述正确。

### C11. 文生图（CLI 能力展示，插件无需新代码）
- 步骤：默认模式下发「生成一张猫的图片保存到 vault 根目录」。
- 预期：出现 ToolSearch/DeferExecuteTool 批准卡（工具名是具体生图工具，**不是**「计划已就绪」）；允许后 vault 根目录出现 png 文件。
- PASS 判定：图片落盘 + 批准卡工具名正确。

---

## D. 结果记录模板

| 编号 | 结果(PASS/FAIL/阻塞) | 备注（截图/日志摘录） |
|---|---|---|
| A1 | | |
| A2 | | |
| … | | |

**失败排查顺序**：设置 →「查看日志」（找 `[WB] acp` 前缀行）→ Obsidian 开发者工具 Console → 重跑 `node scripts/acp-smoke.mjs` 区分 CLI 侧/插件侧问题。阻塞项连同日志摘录一并记录。
