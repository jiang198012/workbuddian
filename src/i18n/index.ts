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
 * 全部用户可见字符串的中英对照。key 用 kebab/dot 命名，逐文件补充。
 * 仅面向用户的 UI 文案进此表；[BB] 日志、发给 CLI 的 prompt、注释不进。
 */
export const STRINGS: Record<string, { zh: string; en: string }> = {
    'chat.send': { zh: '发送', en: 'Send' },
    'chat.stop': { zh: '停止', en: 'Stop' },
    'chat.newConversation': { zh: '新对话', en: 'New chat' },

    'common.unknownError': { zh: '未知错误', en: 'Unknown error' },
    'provider.cliNotFound': { zh: '找不到 codebuddy CLI。请确认已安装 WorkBuddy 桌面版，或在插件设置中指定 codebuddy 路径。', en: 'codebuddy CLI not found. Make sure WorkBuddy desktop is installed, or set the codebuddy path in the plugin settings.' },
    'provider.nodeNotFound': { zh: '找不到 Node.js 来运行 codebuddy（路径：{path}）。请确认已安装 Node.js。', en: 'Node.js not found to run codebuddy (path: {path}). Make sure Node.js is installed.' },
    'export.roleUser': { zh: '**用户**', en: '**User**' },
    'export.roleAssistant': { zh: '**AI**', en: '**AI**' },

    'settings.conn': { zh: 'CodeBuddy 连接', en: 'CodeBuddy Connection' },
    'settings.path': { zh: 'CodeBuddy 路径', en: 'CodeBuddy path' },
    'settings.pathDesc': { zh: 'codebuddy 可执行文件路径。如 WorkBuddy 自定义安装，路径通常为：安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy（右键 WorkBuddy 快捷方式 → 打开文件位置 可找到安装目录）', en: 'Path to the codebuddy executable. For a custom WorkBuddy install it is usually: <InstallDir>\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy (right-click the WorkBuddy shortcut → Open file location).' },
    'settings.pathPlaceholder': { zh: 'WorkBuddy安装目录\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy', en: '<WorkBuddy install dir>\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy' },
    'settings.pathDetect': { zh: '自动检测', en: 'Auto-detect' },
    'settings.pathDetected': { zh: '已填入检测到的路径：{path}', en: 'Filled in the detected path: {path}' },
    'settings.pathNotFound': { zh: '未找到 WorkBuddy 默认安装，请手动指定路径', en: 'WorkBuddy default install not found; set the path manually.' },
    'settings.node': { zh: '手动指定 Node.js 路径', en: 'Node.js path (manual)' },
    'settings.nodeDesc': { zh: '留空则自动探测。如果自动探测失败（例如非标准安装路径），可以在这里手动指定 node 可执行文件的完整路径', en: 'Leave empty to auto-detect. If detection fails (e.g. non-standard install), set the full path to the node executable here.' },
    'settings.nodePlaceholder': { zh: '留空 = 自动探测', en: 'Empty = auto-detect' },
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
    'settings.logsDesc': { zh: '查看最近的插件运行日志（[BB]），便于排查问题。仅保存在内存，重载后清空。', en: 'View recent plugin logs ([BB]) for troubleshooting. Kept in memory only; cleared on reload.' },
    'settings.viewLogs': { zh: '查看日志', en: 'View logs' },
    'log.title': { zh: 'Workbuddian 日志', en: 'Workbuddian logs' },
    'log.copy': { zh: '复制全部', en: 'Copy all' },
    'log.clear': { zh: '清空', en: 'Clear' },
    'log.copied': { zh: '日志已复制到剪贴板', en: 'Logs copied to clipboard' },
    'log.cleared': { zh: '日志已清空', en: 'Logs cleared' },
    'log.empty': { zh: '（暂无日志）', en: '(No logs yet)' },

    'input.removeReference': { zh: '移除引用', en: 'Remove reference' },
    'input.customCommand': { zh: '（自定义命令）', en: '(Custom command)' },
    'input.attach': { zh: '附加文件', en: 'Attach files' },
    'input.imageSaveFailed': { zh: '图片保存失败', en: 'Failed to save image' },
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
    'input.requestFailed': { zh: '请求失败', en: 'Request failed' },
    'input.noResponse': { zh: '（无响应，请重试）', en: '(No response, please retry)' },
    'input.thought': { zh: '已思考', en: 'Thought' },
    'input.send': { zh: '发送', en: 'Send' },

    'view.displayText': { zh: 'Workbuddian 聊天', en: 'Workbuddian Chat' },
    'view.newChat': { zh: '新建对话', en: 'New chat' },
    'view.inputPlaceholder': { zh: '输入消息... (Shift+Enter 换行，Enter 发送)', en: 'Type a message... (Shift+Enter for newline, Enter to send)' },
    'view.send': { zh: '发送', en: 'Send' },

    'usage.tooltip': { zh: '上下文 {used} / {total} tokens', en: 'Context {used} / {total} tokens' },

    'render.emptyTitle': { zh: '开始新对话', en: 'Start a new conversation' },
    'render.emptySubtitle': { zh: '点击上方 + 按钮或输入消息开始聊天', en: 'Click the + button above or type a message to start chatting' },
    'render.thinking': { zh: '思考中', en: 'Thinking' },
    'render.errorTitle': { zh: '出错了', en: 'Something went wrong' },
    'render.retry': { zh: '重试', en: 'Retry' },
    'render.openSettings': { zh: '打开设置', en: 'Open settings' },

    'tabs.close': { zh: '关闭对话', en: 'Close chat' },
    'tabs.rename': { zh: '重命名', en: 'Rename' },
    'tabs.delete': { zh: '删除对话', en: 'Delete chat' },
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
    'inline.editing': { zh: 'CodeBuddy 编辑中…', en: 'CodeBuddy is editing…' },
    'inline.noResult': { zh: '未获得编辑结果', en: 'No edit result returned' },
    'inline.editFailed': { zh: '编辑失败：', en: 'Edit failed: ' },

    'slash.clear': { zh: '清空并新建对话（本地）', en: 'Clear and start a new chat (local)' },
    'slash.compact': { zh: '压缩上下文', en: 'Compact context' },
    'slash.context': { zh: '查看上下文用量', en: 'Show context usage' },
    'slash.cost': { zh: '查看本次花费', en: 'Show session cost' },
    'slash.model': { zh: '切换模型', en: 'Switch model' },
    'slash.permissions': { zh: '查看/管理权限', en: 'View/manage permissions' },
    'slash.resume': { zh: '恢复历史会话', en: 'Resume a past session' },
    'slash.export': { zh: '导出对话', en: 'Export conversation' },
    'slash.status': { zh: '查看状态', en: 'Show status' },
};

export function t(key: string): string {
    const entry = STRINGS[key];
    return entry ? entry[currentLang] : key;
}

/** value 是否等于某 key 的中文或英文文案（跨语言识别默认标题等，兼容切换语言前后的旧数据） */
export function matchesAnyLang(value: string, key: string): boolean {
    const entry = STRINGS[key];
    return !!entry && (value === entry.zh || value === entry.en);
}
