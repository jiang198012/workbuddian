/** CodeBuddy CLI 可选模型白名单（与 `codebuddy --help` 的 --model 候选一致） */
export const MODEL_OPTIONS: Record<string, string> = {
    hy3: 'hy3',
    'glm-5.2': 'glm-5.2',
    'glm-5.1': 'glm-5.1',
    'glm-5v-turbo': 'glm-5v-turbo',
    'minimax-m3': 'minimax-m3',
    'kimi-k2.7': 'kimi-k2.7',
    'kimi-k2.6': 'kimi-k2.6',
    'deepseek-v4-flash': 'deepseek-v4-flash',
    'deepseek-v4-pro': 'deepseek-v4-pro'
};

/** CLI --permission-mode 的合法值（与 `codebuddy --help` 一致） */
export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';

export const PERMISSION_MODES: PermissionMode[] = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];

/** UI 暴露给用户的权限选项（仅「默认」与「完全访问」；CLI 仍支持全部 4 种） */
export const PERMISSION_MODE_CHOICES: PermissionMode[] = ['default', 'bypassPermissions'];

export function isPermissionMode(value: unknown): value is PermissionMode {
    return typeof value === 'string' && (PERMISSION_MODES as string[]).includes(value);
}
