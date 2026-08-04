# 手测详单（增量）：第二步新功能（2026-08-03）

> 本清单只覆盖 `manual-test-2026-08-03-acp-v2.md` 交付**之后**落地的新功能（任务 A/B/C），
> 与在执行的旧清单不重复。被测构建：main 分支 `b18a45e`（已装入 demo-vault 的话先重载插件）。
> 环境：Obsidian + demo-vault + WorkBuddy 已登录。日志入口：设置 → Workbuddian →「查看日志」。

---

## S2-1. 会话分叉（fork）

- 步骤：任一会话至少发过一条消息后，**右键其标签** →「分叉当前会话」。
- 预期：
  1. 新会话标题「分叉 - <原标题>」，含原会话全部历史消息；
  2. 自动切换到新会话，Notice「已分叉」；
  3. 在新会话发「我们前面聊了什么？」→ 回答体现原会话内容（CLI 侧 session/load 命中）。
- 续测：切回**原会话**继续发消息，记录行为（预期：保持分叉前上下文正常续聊；如实记录实际表现）。
- 边界两条：
  - 未发过消息的会话点分叉 → Notice「先发送一条消息，才能分叉」；
  - 流式响应中点分叉 → Notice「正在响应中，稍候再分叉」。
- PASS 判定：分叉成功 + 新会话上下文保持 + 两条边界 Notice 正确。

## S2-2. MCP 服务器注入

- 前置：把下面最小 MCP server 存为 `/tmp/fake-mcp-server.mjs`：
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
- 步骤：设置 → Workbuddian →「MCP 服务器（JSON）」填 `[{"name":"fake","command":"node","args":["/tmp/fake-mcp-server.mjs"]}]` → **新建会话** → 默认权限模式发「调用 echo 工具，text 传 hello-mcp」。
- 预期：弹批准卡，工具名为 **`mcp__fake__echo`**（注意：**不是**「计划已就绪」卡——这是 DeferExecuteTool 委托包装的回归点）；允许后回答包含 `ECHO:hello-mcp`。
- PASS 判定：批准卡工具名正确 + echo 结果正确。

## S2-3. 子代理注入

- 步骤：设置 →「子代理（JSON）」填 `{"reviewer":{"description":"审查代码","prompt":"你是简洁的代码审查员，只回一行。"}}` → 会话里发「用 reviewer 子代理审查 const a=1 这行代码」。
- 预期：出现 `Agent` 工具行；回答带来子代理的审查结果。
- 说明：改动该设置会让 CLI 进程自动重启生效；在飞轮次会按进程死亡链报错收尾，重发即恢复（预期行为）。
- PASS 判定：Agent 工具被实际调用。

## S2-4. 非法 JSON 兜底

- 步骤：MCP 设置填 `{bad` → 失焦保存。
- 预期：Notice「MCP 服务器（JSON）：JSON 无法解析，未生效」；会话功能不受影响。
- PASS 判定：Notice 正确 + 会话正常。

## S2-5. 词级行内 diff 高亮

- 步骤：让 AI 对某文件做一处小改动（如「把 note-test.md 里的『秋天』改成『冬天』」）。
- 预期：diff 块中 remove/add 成对行的**变更片段**有加深底色高亮（不是整行一个色）。
- PASS 判定：高亮只覆盖实际变更的词/字。

## S2-6. Bash 终端输出块

- 步骤：发「执行 echo hello-terminal」。
- 预期：Bash 工具行完成后，行下方出现「输出」折叠块，展开可见 Command/Stdout/Stderr/Exit Code 全文。
- PASS 判定：输出完整、可折叠。

## S2-7. thought_level 设置与回流

- 步骤：设置页「思考力度」切到 `high` → 发一条消息 →「查看日志」应见 set_config_option 带 `thought_level`/`high`；再发 `/effort low`（斜杠透传给 CLI）→ 设置页值应回流变为 `low`。
- PASS 判定：下发与回流都生效。

## S2-8. 原生图片块（粘贴图不再走 Read）

- 步骤：粘贴一张截图到输入框 → 发「这张图里是什么？」。
- 预期：AI 直接回答图片内容；**全程没有 Read 工具调用**（旧行为是路径注入 + Read 读文件）。
- PASS 判定：无 Read 行 + 描述正确。

## S2-9. 文生图（CLI 能力展示，插件无新代码）

- 步骤：默认模式下发「生成一张猫的图片保存到 vault 根目录」。
- 预期：出现 ToolSearch / 生图工具的批准卡（工具名是具体工具，**不是**「计划已就绪」）；允许后 vault 根目录出现 png 文件。
- PASS 判定：图片落盘 + 批准卡工具名正确。

---

## 结果记录模板

| 编号 | 结果(PASS/FAIL/阻塞) | 备注（截图/日志摘录） |
|---|---|---|
| S2-1 | | |
| S2-2 | | |
| S2-3 | | |
| S2-4 | | |
| S2-5 | | |
| S2-6 | | |
| S2-7 | | |
| S2-8 | | |
| S2-9 | | |

**失败排查顺序**：设置 →「查看日志」（找 `[WB] acp` 前缀行）→ Obsidian 开发者工具 Console → 重跑 `node scripts/acp-smoke.mjs`（应 11/11）区分 CLI 侧/插件侧问题。
