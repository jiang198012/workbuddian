export type Lang = 'zh' | 'en';

let currentLang: Lang = 'zh';

export function setLang(lang: Lang): void {
    currentLang = lang;
}

/**
 * 跟随 Obsidian 界面语言：localStorage 'language' 以 zh 开头 → 中文；其它一律英文。
 * 关键：Obsidian 默认英文时该键往往为空，必须回落英文（旧实现空→中文，导致英文用户看到中文）。
 */
export function detectLang(): Lang {
    try {
        const l = (typeof window !== 'undefined' && window.localStorage.getItem('language')) || '';
        return l.startsWith('zh') ? 'zh' : 'en';
    } catch {
        return 'zh';
    }
}

export function initLang(): void {
    setLang(detectLang());
}

/** 按设置应用界面语言：'auto' 跟随 Obsidian，否则用指定语言 */
export function applyLang(setting: 'auto' | Lang): void {
    setLang(setting === 'auto' ? detectLang() : setting);
}

/**
 * 全部用户可见字符串的中英对照（zh/en 必填）。key 用 kebab/dot 命名，逐文件补充。
 * 仅面向用户的 UI 文案进此表；[WB] 日志、发给 CLI 的 prompt、注释不进。
 * 多语言扩展：在条目上加 ja/ko 等可选字段即可，t() 自动回落（en → zh → key）。
 */
export const STRINGS: Record<string, { zh: string; en: string; [lang: string]: string }> = {
    'chat.send': { zh: '发送', en: 'Send' },
    'chat.stop': { zh: '停止', en: 'Stop' },
    'chat.newConversation': { zh: '新对话', en: 'New chat' },
    'chat.autoTitlePrompt': { zh: '请为以下内容生成一个不超过 20 字的会话标题，只输出标题本身，不要标点结尾：\n\n', en: 'Generate a chat title (max 20 chars) for the content below. Output only the title, no trailing punctuation:\n\n' },

    'common.unknownError': { zh: '未知错误', en: 'Unknown error' },
    'provider.cliNotFound': { zh: '找不到 codebuddy CLI。请确认已安装 WorkBuddy 桌面版，或在插件设置中指定 codebuddy 路径。', en: 'codebuddy CLI not found. Make sure WorkBuddy desktop is installed, or set the codebuddy path in the plugin settings.' },
    'provider.nodeNotFound': { zh: '找不到 Node.js 来运行 codebuddy（路径：{path}）。请确认已安装 Node.js。', en: 'Node.js not found to run codebuddy (path: {path}). Make sure Node.js is installed.' },
    'provider.acpUnsupported': { zh: '当前 codebuddy CLI 版本过旧，不支持 ACP 持久会话。请升级 WorkBuddy 桌面版。', en: 'Your codebuddy CLI is too old for ACP persistent sessions. Please upgrade WorkBuddy.' },
    'provider.notLoggedIn': { zh: 'codebuddy CLI 疑似未登录。请先在 WorkBuddy 桌面版中登录。', en: 'codebuddy CLI appears logged out. Please log in via WorkBuddy first.' },
    'provider.handshakeFailed': { zh: 'codebuddy CLI 握手失败：{detail}', en: 'codebuddy CLI handshake failed: {detail}' },
    'provider.turnTimeout': { zh: '本轮响应超时，已中断', en: 'Turn timed out and was interrupted' },
    'provider.turnFailed': { zh: '本轮中断：{reason}', en: 'Turn interrupted: {reason}' },
    'provider.processDied': { zh: 'codebuddy 进程意外退出，本轮已中断。重新发送将自动恢复会话。', en: 'codebuddy process exited unexpectedly. Resend to resume the session.' },
    'provider.busy': { zh: '该会话正在响应中，请稍候', en: 'This conversation is still responding' },
    'export.roleUser': { zh: '**用户**', en: '**User**' },
    'export.roleAssistant': { zh: '**AI**', en: '**AI**' },
    'export.metaExportedAt': { zh: '导出时间', en: 'Exported' },
    'export.metaMessages': { zh: '消息数', en: 'messages' },

    'settings.conn': { zh: 'CodeBuddy 连接', en: 'CodeBuddy Connection' },
    'settings.general': { zh: '通用', en: 'General' },
    // Hermes 后端
    'backend.title': { zh: '后端', en: 'Backend' },
    'backend.desc': { zh: '对话后端:本地 CodeBuddy CLI(完整能力)或 Hermes gateway(纯对话,需 gateway 运行中)', en: 'Chat backend: local CodeBuddy CLI (full features) or Hermes gateway (plain chat, gateway must be running)' },
    'backend.codebuddy': { zh: 'CodeBuddy CLI', en: 'CodeBuddy CLI' },
    'backend.hermes': { zh: 'Hermes gateway', en: 'Hermes gateway' },
    'hermes.gatewayUrl': { zh: 'Gateway 地址', en: 'Gateway URL' },
    'hermes.gatewayUrlDesc': { zh: 'Hermes gateway 的 HTTP 地址,默认 http://127.0.0.1:8642', en: 'Hermes gateway HTTP address, default http://127.0.0.1:8642' },
    'hermes.apiKey': { zh: 'API Key', en: 'API Key' },
    'hermes.apiKeyDesc': { zh: 'Hermes gateway 的 API_SERVER_KEY(~/.hermes/.env)', en: 'Hermes gateway API_SERVER_KEY (~/.hermes/.env)' },
    'hermes.test': { zh: '测试连接', en: 'Test connection' },
    'hermes.testOk': { zh: '连接成功', en: 'Connected' },
    'hermes.testFail': { zh: '连接失败:', en: 'Connection failed: ' },
    'hermes.needRestart': { zh: '切换后端需重载插件生效(Cmd+R)', en: 'Backend switch takes effect after reload (Cmd+R)' },
    // CodeBuddy 插件管理（i18n 补齐,原为硬编码中文）
    'plugins.title': { zh: 'CodeBuddy 插件', en: 'CodeBuddy Plugins' },
    'plugins.empty': { zh: '未发现 CodeBuddy 插件市场(需先安装 CodeBuddy CLI 并配置插件市场)。', en: 'No CodeBuddy plugin marketplaces found (install CodeBuddy CLI and configure a marketplace first).' },
    'plugins.filterPlaceholder': { zh: '过滤插件…', en: 'Filter plugins…' },
    'plugins.enable': { zh: '启用', en: 'Enable' },
    'plugins.disable': { zh: '禁用', en: 'Disable' },
    'plugins.update': { zh: '更新', en: 'Update' },
    'plugins.working': { zh: '处理中…', en: 'Working…' },
    'plugins.opFailed': { zh: '插件「{name}」操作失败: {err}', en: 'Operation on plugin "{name}" failed: {err}' },
    'plugins.opDone': { zh: '插件「{name}」已{action}', en: 'Plugin "{name}" {action}' },
    'plugins.noDesc': { zh: '(无描述)', en: '(No description)' },
    'settings.path': { zh: 'CodeBuddy 路径', en: 'CodeBuddy path' },
    'settings.pathDesc': { zh: 'codebuddy 可执行文件路径。如 WorkBuddy 自定义安装，路径通常为：安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy（右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录）', en: 'Path to the codebuddy executable. For a custom WorkBuddy install it is usually: <InstallDir>\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy (right-click the WorkBuddy shortcut → Open file location).' },
    'settings.pathPlaceholder': { zh: 'WorkBuddy安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy', en: '<WorkBuddy install dir>\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy' },
    'settings.pathDetect': { zh: '自动检测', en: 'Auto-detect' },
    'settings.pathDetected': { zh: '已填入检测到的路径：{path}', en: 'Filled in the detected path: {path}' },
    'settings.pathNotFound': { zh: '未找到 WorkBuddy 默认安装，请手动指定路径', en: 'WorkBuddy default install not found; set the path manually.' },
    'settings.node': { zh: '手动指定 Node.js 路径', en: 'Node.js path (manual)' },
    'settings.nodeDesc': { zh: '留空则自动探测。如果自动探测失败（例如非标准安装路径），可以在这里手动指定 node 可执行文件的完整路径', en: 'Leave empty to auto-detect. If detection fails (e.g. non-standard install), set the full path to the node executable here.' },
    'settings.nodePlaceholder': { zh: '留空 = 自动探测', en: 'Empty = auto-detect' },
    'settings.mcpServers': { zh: 'MCP 服务器（JSON）', en: 'MCP servers (JSON)' },
    'settings.mcpServersDesc': { zh: 'stdio 传输的 MCP 服务器数组，如 [{"name":"x","command":"npx","args":["-y","pkg"]}]。留空不注入；对新建/恢复的会话生效。', en: 'Array of stdio MCP servers, e.g. [{"name":"x","command":"npx","args":["-y","pkg"]}]. Empty = none; applies to newly created/restored sessions.' },
    'settings.customAgents': { zh: '子代理（JSON）', en: 'Custom agents (JSON)' },
    'settings.customAgentsDesc': { zh: '子代理定义对象，如 {"reviewer":{"description":"审查代码","prompt":"你是代码审查员"}}，对应 CLI --agents；支持 tools（工具白名单）与 model 键（2026-08-03 探针实测 CLI 接受）。改动后 CLI 进程自动重启生效。', en: 'Custom agent definitions, e.g. {"reviewer":{"description":"Reviews code","prompt":"You review code"}} (CLI --agents); tools (allowlist) and model keys are accepted (probed 2026-08-03). The CLI process restarts automatically on change.' },
    'settings.invalidJson': { zh: '{field}：JSON 无法解析，未生效', en: '{field}: invalid JSON, not applied' },
    'mcp.addServer': { zh: '添加服务器', en: 'Add server' },
    'mcp.importClipboard': { zh: '从剪贴板导入', en: 'Import from clipboard' },
    'mcp.importBad': { zh: '剪贴板里没有可识别的 MCP 配置', en: 'No recognizable MCP config in clipboard' },
    'mcp.modalTitleAdd': { zh: '添加 MCP 服务器', en: 'Add MCP server' },
    'mcp.modalTitleEdit': { zh: '编辑 MCP 服务器', en: 'Edit MCP server' },
    'mcp.fieldName': { zh: '名称', en: 'Name' },
    'mcp.fieldCommand': { zh: '命令', en: 'Command' },
    'mcp.fieldArgs': { zh: '参数（空格分隔）', en: 'Args (space-separated)' },
    'mcp.fieldEnv': { zh: '环境变量（每行 KEY=VALUE）', en: 'Env (KEY=VALUE per line)' },
    'mcp.fieldEnabled': { zh: '启用', en: 'Enabled' },
    'mcp.save': { zh: '保存', en: 'Save' },
    'mcp.nameRequired': { zh: '名称不能为空', en: 'Name is required' },
    'settings.thoughtLevel': { zh: '思考力度', en: 'Thinking effort' },
    'settings.thoughtLevelDesc': { zh: '对应 CLI thought_level（按会话生效）；CLI 侧用 /effort 改动会同步回这里。', en: 'Maps to CLI thought_level (per session). Changes via the /effort command sync back here.' },
    'settings.autoTitle': { zh: '自动生成会话标题', en: 'Auto-generate chat titles' },
    'settings.autoTitleDesc': { zh: '首轮回复后由 AI 命名新会话；你手动改过名的会话不会被覆盖。', en: 'AI names new chats after the first reply; chats you renamed manually are left alone.' },
    'settings.timeout': { zh: 'CLI 超时时长（分钟）', en: 'CLI timeout (minutes)' },
    'settings.timeoutDesc': { zh: 'CodeBuddy CLI 单次响应最长等待时间，超过会强制中断', en: 'Max wait per CodeBuddy CLI response; exceeding it aborts the call.' },
    'settings.model': { zh: '模型', en: 'Model' },
    'settings.modelDesc': { zh: 'CodeBuddy CLI 使用的模型', en: 'Model used by the CodeBuddy CLI' },
    'settings.modelAuto': { zh: 'Auto（默认，由 CodeBuddy 自动选择）', en: 'Auto (default, chosen by CodeBuddy)' },
    'settings.inject': { zh: '上下文注入', en: 'Context injection' },
    'settings.injectVault': { zh: '注入 Vault 上下文', en: 'Inject vault context' },
    'settings.injectVaultDesc': { zh: '开启后，每次发送消息都会自动附上当前 Vault 路径，让 AI 基于 Vault 中的文件回答问题', en: 'When on, every message includes the current vault path so the AI can answer based on vault files.' },
    'settings.injectNote': { zh: '注入当前笔记链接', en: 'Inject current note link' },
    'settings.injectNoteDesc': { zh: '开启后，每次发送消息都会附上当前正在查看的笔记标题和路径（不包含正文内容）', en: 'When on, every message includes the current note title and path (not its content).' },
    'settings.pastedKeep': { zh: '粘贴图保留数量', en: 'Pasted image retention' },
    'settings.pastedKeepDesc': { zh: '插件目录内最多保留多少张粘贴的图片，超出的自动删除。填 0 表示不限制（历史消息里的缩略图不会失效，但图片会一直累积）。默认 20，最大 500。', en: 'How many pasted images to keep in the plugin folder; older ones are deleted automatically. 0 means unlimited (thumbnails in old messages stay valid, but images accumulate). Default 20, max 500.' },
    'settings.appearance': { zh: '外观', en: 'Appearance' },
    'settings.language': { zh: '界面语言', en: 'Interface language' },
    'settings.languageDesc': { zh: '插件界面显示语言。Auto 跟随 Obsidian。聊天面板即时切换；命令面板名称需 Cmd+R 后更新。', en: 'Plugin UI language. Auto follows Obsidian. Chat panels switch instantly; command-palette names update after a reload.' },
    'settings.langAuto': { zh: 'Auto（跟随 Obsidian）', en: 'Auto (follow Obsidian)' },
    'settings.langZh': { zh: '中文', en: '中文' },
    'settings.langEn': { zh: 'English', en: 'English' },
    'settings.langReload': { zh: '界面语言已切换', en: 'Interface language changed' },
    'settings.contextWindow': { zh: '上下文窗口上限（token）', en: 'Context window size (tokens)' },
    'settings.contextWindowDesc': { zh: '计算上下文用量百分比的分母。不同模型窗口不同，可按实际调整（默认 200000）。', en: 'Denominator for the context-usage percentage. Adjust to your model’s window (default 200000).' },
    'settings.permissionMode': { zh: '授权模式', en: 'Permission mode' },
    'settings.permissionModeDesc': { zh: '控制 CodeBuddy 执行操作前的授权级别，等同工具栏盾牌图标：默认（每步询问）/ 完全访问（跳过所有授权）。', en: 'Authorization level before CodeBuddy acts; same as the toolbar shield: Default (asks each step) / Full access (skips all).' },
    'settings.primary': { zh: '聊天主色调', en: 'Chat accent color' },
    'settings.primaryDesc': { zh: '自定义聊天面板的强调色（用户气泡、发送按钮、边框、focus 高亮等）。点「恢复默认」跟随 Obsidian 主题色。', en: 'Customize the chat accent color (user bubble, send button, borders, focus ring). Click "Reset" to follow the Obsidian theme.' },
    'settings.resetTooltip': { zh: '恢复默认（跟随主题色）', en: 'Reset (follow theme color)' },
    'settings.reset': { zh: '重置', en: 'Reset' },
    'settings.resetDefault': { zh: '重置为默认', en: 'Reset to defaults' },
    'settings.resetDesc': { zh: '清空所有自定义设置，恢复到插件默认值（包括路径、模型、注入开关、主色调）。', en: 'Clear all custom settings and restore plugin defaults (paths, model, injection toggles, accent color).' },
    'settings.resetConfirm': { zh: '确认重置？', en: 'Confirm reset?' },
    'settings.resetDone': { zh: '已重置为默认设置', en: 'Settings reset to defaults' },
    'settings.importExport': { zh: '导入 / 导出设置', en: 'Import / Export settings' },
    'settings.export': { zh: '导出设置', en: 'Export settings' },
    'settings.exportDesc': { zh: '把当前设置保存为 JSON 文件，便于备份或迁移（含本机路径，跨机器需自行调整）。', en: 'Save current settings as a JSON file for backup/migration (includes local paths; adjust when moving machines).' },
    'settings.exportBtn': { zh: '导出为文件', en: 'Export to file' },
    'settings.exportDone': { zh: '设置已导出为 workbuddian-settings.json', en: 'Settings exported to workbuddian-settings.json' },
    'settings.import': { zh: '导入设置', en: 'Import settings' },
    'settings.importDesc': { zh: '选择之前导出的 JSON 文件，覆盖当前设置。', en: 'Pick a previously exported JSON file to overwrite current settings.' },
    'settings.importBtn': { zh: '从文件导入', en: 'Import from file' },
    'settings.importDone': { zh: '设置已导入', en: 'Settings imported' },
    'settings.importErr': { zh: '导入失败：JSON 解析错误', en: 'Import failed: invalid JSON' },

    'settings.logs': { zh: '日志', en: 'Logs' },
    'settings.logsDesc': { zh: '查看最近的插件运行日志（[WB]），便于排查问题。仅保存在内存，重载后清空。', en: 'View recent plugin logs ([WB]) for troubleshooting. Kept in memory only; cleared on reload.' },
    'settings.viewLogs': { zh: '查看日志', en: 'View logs' },
    'log.title': { zh: 'Workbuddian 日志', en: 'Workbuddian logs' },
    'log.copy': { zh: '复制全部', en: 'Copy all' },
    'log.clear': { zh: '清空', en: 'Clear' },
    'log.copied': { zh: '日志已复制到剪贴板', en: 'Logs copied to clipboard' },
    'log.cleared': { zh: '日志已清空', en: 'Logs cleared' },
    'log.empty': { zh: '（暂无日志）', en: '(No logs yet)' },

    'input.removeReference': { zh: '移除引用', en: 'Remove reference' },
    'input.ariaLabel': { zh: '聊天输入框', en: 'Chat input' },
    'a11y.newReply': { zh: '新回复：', en: 'New reply: ' },
    'input.customCommand': { zh: '（自定义命令）', en: '(Custom command)' },
    'input.attach': { zh: '附加文件', en: 'Attach files' },
    'input.imageSaveFailed': { zh: '图片保存失败', en: 'Failed to save image' },
    'input.contextUsage': { zh: '上下文用量', en: 'Context usage' },
    'input.usageWarning': { zh: '上下文已用', en: 'Context at' },
    'input.usageCompact': { zh: '压缩 /compact', en: 'Compact' },
    'input.usageNewChat': { zh: '新建对话', en: 'New chat' },
    'instruction.modalTitle': { zh: '常驻指令', en: 'Custom instruction' },
    'instruction.placeholder': { zh: '给 AI 设定常驻的规则 / 人设（对所有对话生效）', en: 'Set a persistent rule/persona for the AI (applies to all chats)' },
    'instruction.save': { zh: '保存', en: 'Save' },
    'instruction.clear': { zh: '清除', en: 'Clear' },
    'instruction.indicatorOn': { zh: '常驻指令（已设置，点击编辑）', en: 'Custom instruction (set — click to edit)' },
    'instruction.indicatorOff': { zh: '常驻指令（点击设置）', en: 'Custom instruction (click to set)' },
    'input.permission': { zh: '授权模式', en: 'Permission mode' },
    'perm.default': { zh: '默认（每步询问）', en: 'Default (ask each step)' },
    'perm.plan': { zh: '计划模式（只读不改）', en: 'Plan (read-only)' },
    'perm.acceptEdits': { zh: '自动接受编辑', en: 'Accept edits' },
    'perm.bypassPermissions': { zh: '完全访问', en: 'Full access' },
    'input.stop': { zh: '停止', en: 'Stop' },
    'input.bubbleNotFound': { zh: '找不到 Assistant 消息气泡', en: 'Assistant message bubble not found' },
    'input.thinking': { zh: '思考中...', en: 'Thinking...' },
    'input.toolCall': { zh: '工具调用', en: 'Tool call' },
    'input.toolCallToggle': { zh: '展开或折叠工具调用详情', en: 'Expand or collapse tool call details' },
    'tool.diffTitle': { zh: '改动', en: 'Changes' },
    'tool.diffToggle': { zh: '展开或折叠改动详情', en: 'Expand or collapse change details' },
    'tool.undo': { zh: '撤销此修改', en: 'Undo this edit' },
    'tool.undone': { zh: '已撤销', en: 'Undone' },
    'tool.undoStale': { zh: '文件已变化，未执行撤销', en: 'File has changed since; undo skipped' },
    'tool.undoAmbiguous': { zh: '改动文本在文件中出现多次，为避免误改已跳过撤销', en: 'The changed text appears more than once in the file; undo was skipped to avoid a wrong edit.' },
    'tool.undoFailed': { zh: '撤销失败', en: 'Undo failed' },
    'tool.output': { zh: '输出', en: 'Output' },
    'tool.agentOutput': { zh: '子代理输出', en: 'Subagent output' },
    'tool.outputToggle': { zh: '展开或折叠命令输出', en: 'Expand or collapse command output' },
    'approval.title': { zh: '工具批准', en: 'Tool approval' },
    'approval.allow': { zh: '允许', en: 'Allow' },
    'approval.alwaysAllow': { zh: '总是允许', en: 'Always allow' },
    'approval.reject': { zh: '拒绝', en: 'Reject' },
    'approval.planReady': { zh: '计划已就绪', en: 'Plan ready' },
    'approval.execute': { zh: '按此执行', en: 'Execute' },
    'approval.alwaysExecute': { zh: '总是执行', en: 'Always execute' },
    'approval.cancel': { zh: '取消', en: 'Cancel' },
    'approval.writeLines': { zh: '写入 {path}（{count} 行）', en: 'Write {path} ({count} lines)' },
    'approval.resolvedAllow': { zh: '已允许', en: 'Allowed' },
    'approval.resolvedAlways': { zh: '已总是允许', en: 'Always allowed' },
    'approval.resolvedReject': { zh: '已拒绝', en: 'Rejected' },
    'input.requestFailed': { zh: '请求失败', en: 'Request failed' },
    'input.noResponse': { zh: '（无响应，请重试）', en: '(No response, please retry)' },
    'input.rejectedTurn': { zh: '该操作已被拒绝。', en: 'The operation was rejected.' },
    'input.thought': { zh: '已思考', en: 'Thought' },
    'input.send': { zh: '发送', en: 'Send' },

    'external.title': { zh: '读取 Vault 外文件', en: 'Read files outside the vault' },
    'external.desc': { zh: '以下附件位于 Vault 之外，发送后 CodeBuddy 会读取其内容；取消则不发送本条消息。', en: 'These attachments are outside the vault; sending lets CodeBuddy read their contents. Cancel aborts this message.' },
    'external.allowOnce': { zh: '允许一次', en: 'Allow once' },

    'view.displayText': { zh: 'Workbuddian 聊天', en: 'Workbuddian Chat' },
    'view.newChat': { zh: '新建对话', en: 'New chat' },
    'view.newChatFromTemplate': { zh: '用模板新建', en: 'New from template' },
    'view.templateApplied': { zh: '已应用模板「{name}」', en: 'Template "{name}" applied' },
    'view.inputPlaceholder': { zh: '输入消息... (Shift+Enter 换行，Enter 发送)', en: 'Type a message... (Shift+Enter for newline, Enter to send)' },
    'view.send': { zh: '发送', en: 'Send' },

    'usage.tooltip': { zh: '上下文 {used} / {total} tokens', en: 'Context {used} / {total} tokens' },

    'render.emptyTitle': { zh: '开始新对话', en: 'Start a new conversation' },
    'render.emptySubtitle': { zh: '点击上方 + 按钮或输入消息开始聊天', en: 'Click the + button above or type a message to start chatting' },
    'render.suggestSummarize': { zh: '总结当前笔记', en: 'Summarize the current note' },
    'render.suggestExplain': { zh: '解释这个想法', en: 'Explain this idea' },
    'render.suggestRewrite': { zh: '改写这段文字', en: 'Rewrite this text' },
    'render.thinking': { zh: '思考中', en: 'Thinking' },
    'render.errorTitle': { zh: '出错了', en: 'Something went wrong' },
    'render.retry': { zh: '重试', en: 'Retry' },
    'render.openSettings': { zh: '打开设置', en: 'Open settings' },
    'render.copy': { zh: '复制', en: 'Copy' },
    'render.copyCode': { zh: '复制代码', en: 'Copy code' },
    'render.copied': { zh: '已复制', en: 'Copied' },
    'render.copyFailed': { zh: '复制失败', en: 'Copy failed' },
    'render.edit': { zh: '编辑并重发', en: 'Edit and resend' },
    'render.regenerate': { zh: '重新生成', en: 'Regenerate' },
    'render.editResendHint': { zh: '已载入原消息，编辑后发送', en: 'Original loaded; edit and send' },
    'render.insertToNote': { zh: '插入到当前笔记', en: 'Insert into current note' },
    'render.noActiveNote': { zh: '没有打开的笔记', en: 'No note open' },
    'render.inserted': { zh: '已插入', en: 'Inserted' },
    'render.insertFailed': { zh: '插入失败：', en: 'Insert failed: ' },
    'render.saveAsNote': { zh: '保存为新笔记', en: 'Save as new note' },
    'render.savedAs': { zh: '已保存为 {name}', en: 'Saved as {name}' },
    'render.saveFailed': { zh: '保存失败：', en: 'Save failed: ' },

    'tabs.close': { zh: '关闭对话', en: 'Close chat' },
    'tabs.searchPlaceholder': { zh: '搜索会话…', en: 'Search chats…' },
    'tabs.rename': { zh: '重命名', en: 'Rename' },
    'tabs.fork': { zh: '分叉当前会话', en: 'Fork this chat' },
    'tabs.forkPrefix': { zh: '分叉', en: 'Fork' },
    'tabs.forked': { zh: '已分叉：{title}', en: 'Forked: {title}' },
    'tabs.forkFailed': { zh: '分叉失败', en: 'Fork failed' },
    'tabs.forkNeedMessage': { zh: '先发送一条消息，才能分叉', en: 'Send a message first to fork' },
    'tabs.forkStreaming': { zh: '正在响应中，稍候再分叉', en: 'Wait for the response to finish before forking' },
    'tabs.delete': { zh: '删除对话', en: 'Delete chat' },
    'tabs.confirmDelete': { zh: '删除对话', en: 'Delete conversation' },
    'tabs.deleteConfirmBtn': { zh: '确认删除', en: 'Confirm' },
    'tabs.pin': { zh: '置顶会话', en: 'Pin conversation' },
    'tabs.unpin': { zh: '取消置顶', en: 'Unpin conversation' },
    'tabs.pinned': { zh: '已置顶', en: 'Pinned' },
    'tabs.exportAsNote': { zh: '导出为笔记', en: 'Export as note' },
    'tabs.nothingToExport': { zh: '没有可导出的内容', en: 'Nothing to export' },
    'tabs.exportedAs': { zh: '已导出为「{name}」', en: 'Exported as "{name}"' },
    'tabs.exportFailed': { zh: '导出失败：{err}', en: 'Export failed: {err}' },
    'tabs.copyToClipboard': { zh: '复制到剪贴板', en: 'Copy to clipboard' },
    'tabs.copiedToClipboard': { zh: '已复制到剪贴板', en: 'Copied to clipboard' },
    'tabs.copyFailed': { zh: '复制失败：{err}', en: 'Copy failed: {err}' },

    'cmd.ribbonTooltip': { zh: 'Workbuddian 聊天', en: 'Workbuddian Chat' },
    'cmd.openChat': { zh: '打开聊天面板', en: 'Open chat panel' },
    'cmd.openChatMainPane': { zh: '在主编辑区打开大面板', en: 'Open large panel in main area' },
    'cmd.inlineEdit': { zh: '用 CodeBuddy 编辑选区', en: 'Edit selection with CodeBuddy' },
    'cmd.inlineEditFloating': { zh: 'Workbuddian编辑', en: 'Workbuddian Edit' },
    'cmd.newChat': { zh: '新建对话', en: 'New conversation' },
    'cmd.editInstruction': { zh: '编辑常驻指令', en: 'Edit persistent instruction' },
    'cmd.openSettings': { zh: '打开 Workbuddian 设置', en: 'Open Workbuddian settings' },
    'cmd.exportChat': { zh: '导出当前会话为笔记', en: 'Export current conversation as note' },
    'cmd.exportAllChats': { zh: '导出所有会话为笔记', en: 'Export all conversations as note' },
    'cmd.openChatFirst': { zh: '请先打开聊天面板', en: 'Please open the chat panel first' },
    'cmd.searchChats': { zh: '搜索会话', en: 'Search conversations' },
    'cmd.loadFailed': { zh: 'Workbuddian 加载失败，请查看 Console', en: 'Workbuddian failed to load, check the Console' },
    'cmd.cannotCreatePanel': { zh: 'Workbuddian：无法创建聊天面板', en: 'Workbuddian: could not create chat panel' },
    'cmd.openPanelFailed': { zh: 'Workbuddian：打开面板失败，请查看 Console', en: 'Workbuddian: failed to open panel, check the Console' },
    'cmd.openMainPaneFailed': { zh: 'Workbuddian：打开主编辑区面板失败，请查看 Console', en: 'Workbuddian: failed to open main-area panel, check the Console' },

    'inline.editTitle': { zh: '用 CodeBuddy 编辑选区', en: 'Edit selection with CodeBuddy' },
    'inline.instructionLabel': { zh: '编辑要求', en: 'Edit instruction' },
    'inline.instructionPlaceholder': { zh: '如：改简洁 / 翻译成英文', en: 'e.g. make concise / translate to English' },
    'inline.editBtn': { zh: '编辑', en: 'Edit' },
    'inline.instructionRequired': { zh: '请输入编辑要求', en: 'Please enter an edit instruction' },
    'inline.previewTitle': { zh: '预览改动', en: 'Preview changes' },
    'inline.accept': { zh: '接受', en: 'Accept' },
    'inline.reject': { zh: '拒绝', en: 'Reject' },
    'inline.selectFirst': { zh: '请先选中一段文本', en: 'Please select some text first' },
    'inline.editing': { zh: 'AI 编辑中…', en: 'AI is editing…' },
    'inline.noResult': { zh: '未获得编辑结果', en: 'No edit result returned' },
    'inline.editFailed': { zh: '编辑失败：', en: 'Edit failed: ' },

    'slash.clear': { zh: '清空并新建对话（本地）', en: 'Clear and start a new chat (local)' },
    'slash.compact': { zh: '压缩上下文', en: 'Compact context' },
    'slash.context': { zh: '查看上下文用量', en: 'Show context usage' },
    'slash.cost': { zh: '查看本次花费', en: 'Show session cost' },
    'slash.effort': { zh: '设置思考力度', en: 'Set thinking effort' },
    'slash.resume': { zh: '恢复历史会话', en: 'Resume a past session' },
    'resume.modalTitle': { zh: '选择要恢复的对话', en: 'Resume a conversation' },
    'resume.empty': { zh: '（还没有历史对话）', en: '(No conversations yet)' },
    'resume.searchPlaceholder': { zh: '搜索会话…', en: 'Search conversations…' },
    'resume.noResults': { zh: '（没有匹配的对话）', en: '(No matching conversations)' },
    'resume.justNow': { zh: '刚刚', en: 'just now' },
    'resume.minutesAgo': { zh: '分钟前', en: 'min ago' },
    'resume.hoursAgo': { zh: '小时前', en: 'h ago' },
    'resume.daysAgo': { zh: '天前', en: 'd ago' },
    'resume.messageCount': { zh: '条', en: 'msgs' },
    'slash.status': { zh: '查看状态', en: 'Show status' },
};

/**
 * 取当前语言的文案,带回落链:
 * 当前语言 → en → zh → key 本身。
 * 为未来多语言扩展(ja/ko 等)预留:即使某条文案没翻译,也不会取到 undefined 崩溃,
 * 而是回落到最接近的可用语言。新语言只需在 STRINGS 条目里加字段,其余零改动。
 */
export function t(key: string): string {
    const entry = STRINGS[key];
    if (!entry) return key;
    return entry[currentLang] ?? entry.en ?? entry.zh ?? key;
}

/** value 是否等于某 key 的中文或英文文案（跨语言识别默认标题等，兼容切换语言前后的旧数据） */
export function matchesAnyLang(value: string, key: string): boolean {
    const entry = STRINGS[key];
    return !!entry && (value === entry.zh || value === entry.en);
}
