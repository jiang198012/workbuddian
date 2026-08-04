/** CodeBuddy CLI 可选模型白名单（握手前的兜底列表；握手成功后以 CLI `models.availableModels` 实时列表为准） */
export const MODEL_OPTIONS: Record<string, string> = {
    hy3: 'hy3',
    'glm-5.2': 'glm-5.2',
    'glm-5.1': 'glm-5.1',
    'glm-5v-turbo': 'glm-5v-turbo',
    'minimax-m3': 'minimax-m3',
    'kimi-k3-1': 'kimi-k3-1',
    'kimi-k2.7': 'kimi-k2.7',
    'kimi-k2.6': 'kimi-k2.6',
    'deepseek-v4-flash': 'deepseek-v4-flash',
    'deepseek-v4-pro': 'deepseek-v4-pro'
};

/** 动态拉取失败时的硬编码兜底模型列表 */
export const FALLBACK_MODEL_OPTIONS: Record<string, string> = MODEL_OPTIONS;

/** CLI --permission-mode 的合法值（与 `codebuddy --help` 一致） */
export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';

export const PERMISSION_MODES: PermissionMode[] = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];

/** UI 暴露给用户的权限选项（默认 / 计划模式 / 完全访问；CLI 仍支持全部 4 种） */
export const PERMISSION_MODE_CHOICES: PermissionMode[] = ['default', 'plan', 'bypassPermissions'];

/** CLI thought_level 七档（settings.thoughtLevel 的合法值） */
export const THOUGHT_LEVEL_CHOICES = ['enabled', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export function isThoughtLevel(value: unknown): value is string {
    return typeof value === 'string' && (THOUGHT_LEVEL_CHOICES as readonly string[]).includes(value);
}

export function isPermissionMode(value: unknown): value is PermissionMode {
    return typeof value === 'string' && (PERMISSION_MODES as string[]).includes(value);
}
