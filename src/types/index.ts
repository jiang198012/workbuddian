// ==================== 聊天类型 ====================
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    isError?: boolean;
}

export interface Conversation {
    id: string;
    title: string;
    sessionId: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
}

// ==================== 设置类型 ====================
export interface WorkbuddianSettings {
    codebuddyPath: string;
    cliTimeoutMinutes: number;
    nodePath: string;
    injectVaultContext: boolean;
    injectCurrentNoteLink: boolean;
    model: string;
    primaryColor: string;
    version: number;
}

const CURRENT_SETTINGS_VERSION = 5;

export const DEFAULT_SETTINGS: WorkbuddianSettings = {
    codebuddyPath: '',
    cliTimeoutMinutes: 5,
    nodePath: '',
    injectVaultContext: true,
    injectCurrentNoteLink: false,
    model: 'auto',
    primaryColor: '',
    version: CURRENT_SETTINGS_VERSION
};

// ==================== 通用类型安全辅助函数 ====================

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getString(data: Record<string, unknown>, key: string): string | undefined {
    const value = data[key];
    return typeof value === 'string' ? value : undefined;
}

export function getNumber(data: Record<string, unknown>, key: string): number | undefined {
    const value = data[key];
    return typeof value === 'number' ? value : undefined;
}

export function getBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
    const value = data[key];
    return typeof value === 'boolean' ? value : undefined;
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return '未知错误';
}

/**
 * 迁移设置到最新版本。
 * 参考 Claudian 的 normalize+migrate 模式。
 */
export function migrateSettings(stored: unknown): WorkbuddianSettings {
    if (!isObject(stored)) {
        return { ...DEFAULT_SETTINGS };
    }

    const cliTimeoutMinutes = getNumber(stored, 'cliTimeoutMinutes');
    const injectVaultContext = getBoolean(stored, 'injectVaultContext');
    const injectCurrentNoteLink = getBoolean(stored, 'injectCurrentNoteLink');

    return {
        codebuddyPath: getString(stored, 'codebuddyPath') ?? DEFAULT_SETTINGS.codebuddyPath,
        cliTimeoutMinutes: typeof cliTimeoutMinutes === 'number' && cliTimeoutMinutes > 0
            ? cliTimeoutMinutes
            : DEFAULT_SETTINGS.cliTimeoutMinutes,
        nodePath: getString(stored, 'nodePath') ?? DEFAULT_SETTINGS.nodePath,
        injectVaultContext: typeof injectVaultContext === 'boolean'
            ? injectVaultContext
            : DEFAULT_SETTINGS.injectVaultContext,
        injectCurrentNoteLink: typeof injectCurrentNoteLink === 'boolean'
            ? injectCurrentNoteLink
            : DEFAULT_SETTINGS.injectCurrentNoteLink,
        model: getString(stored, 'model') ?? DEFAULT_SETTINGS.model,
        primaryColor: getString(stored, 'primaryColor') ?? DEFAULT_SETTINGS.primaryColor,
        version: CURRENT_SETTINGS_VERSION
    };
}

// ==================== 工具函数 ====================

export function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ==================== 持久化数据类型 ====================
export interface PersistedData {
    conversations?: Conversation[];
    settings?: Partial<WorkbuddianSettings>;
}

export function normalizePersistedData(raw: unknown): PersistedData {
    const result: PersistedData = {};
    if (!isObject(raw)) {
        return result;
    }

    if (Array.isArray(raw.conversations)) {
        result.conversations = raw.conversations as Conversation[];
    }
    if (isObject(raw.settings)) {
        result.settings = migrateSettings(raw.settings);
    }

    return result;
}
