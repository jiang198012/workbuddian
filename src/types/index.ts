import { type PermissionMode, isPermissionMode } from '../shared/cliOptions';
import { t } from '../i18n';

// ==================== 聊天类型 ====================

/** 单条聊天消息（用户或 AI）；attachments 为附件绝对路径（旧数据可能是纯文件名） */
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    isError?: boolean;
    attachments?: string[];
}

/** 单轮 CLI 上报的 token 用量（取整轮 prompt 总量的 input_tokens 作已用上下文） */
export interface UsageInfo {
    inputTokens: number;
}

export interface Conversation {
    id: string;
    title: string;
    sessionId: string;
    /** ACP 持久会话 id（CLI 分配，以此为准）；sessionId 保留为 v1 兼容字段 */
    acpSessionId?: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
    lastUsage?: UsageInfo;
}

// ==================== 窄化读取辅助 ====================

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 按守卫函数从对象上取一个字段；类型不符一律 undefined（迁移与导入共用的安全读取） */
function pick<T>(data: Record<string, unknown>, key: string, guard: (v: unknown) => v is T): T | undefined {
    const value = data[key];
    return guard(value) ? value : undefined;
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

export function getString(data: Record<string, unknown>, key: string): string | undefined {
    return pick(data, key, isString);
}

export function getNumber(data: Record<string, unknown>, key: string): number | undefined {
    return pick(data, key, isNum);
}

export function getBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
    return pick(data, key, isBool);
}

export function getErrorMessage(error: unknown): string {
    switch (typeof error) {
        case 'string':
            return error;
        case 'object':
            if (error instanceof Error) return error.message;
            break;
    }
    return t('common.unknownError');
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
    contextWindowSize: number;
    permissionMode: PermissionMode;
    language: 'auto' | 'zh' | 'en';
    customInstruction: string;
    pastedImageKeep: number;
    /** MCP 服务器数组 JSON（stdio：[{name,command,args?,env?}]），空串=不注入 */
    mcpServersJson: string;
    /** 子代理定义 JSON（{名:{description,prompt}}，对应 CLI --agents），空串=不传 */
    customAgentsJson: string;
    /** 思考力度（CLI thought_level 七档：enabled/minimal/low/medium/high/xhigh/max） */
    thoughtLevel: string;
    /** 首轮回复后由 AI 自动生成会话标题（用户手动改名后不覆盖） */
    autoTitle: boolean;
    /** 已授权"总是允许读取"的 vault 外附件绝对路径（逐项精确匹配） */
    allowedExternalPaths: string[];
    version: number;
}

const CURRENT_SETTINGS_VERSION = 12;
export const DEFAULT_CONTEXT_WINDOW_SIZE = 200000;
const DEFAULT_PASTED_IMAGE_KEEP = 20;
/** 粘贴图保留数量上限；0 表示不限制 */
export const MAX_PASTED_IMAGE_KEEP = 500;

export const DEFAULT_SETTINGS: WorkbuddianSettings = {
    codebuddyPath: '',
    cliTimeoutMinutes: 5,
    nodePath: '',
    injectVaultContext: true,
    injectCurrentNoteLink: false,
    model: 'auto',
    primaryColor: '',
    contextWindowSize: DEFAULT_CONTEXT_WINDOW_SIZE,
    permissionMode: 'default',
    language: 'auto',
    customInstruction: '',
    pastedImageKeep: DEFAULT_PASTED_IMAGE_KEEP,
    mcpServersJson: '',
    customAgentsJson: '',
    thoughtLevel: 'enabled',
    autoTitle: true,
    allowedExternalPaths: [],
    version: CURRENT_SETTINGS_VERSION
};

// ==================== 设置迁移（描述表驱动） ====================

type FieldRule = {
    key: keyof WorkbuddianSettings;
    /** 从旧数据取出的原始值 → 合法返回值；不合法返回 undefined 走默认 */
    read: (stored: Record<string, unknown>) => unknown;
};

/** 每行一个字段：怎么读、什么算合法；表里没有的键（如 version）在迁移末尾统一盖上 */
const FIELD_RULES: FieldRule[] = [
    { key: 'codebuddyPath', read: (s) => getString(s, 'codebuddyPath') },
    { key: 'cliTimeoutMinutes', read: (s) => { const v = getNumber(s, 'cliTimeoutMinutes'); return v !== undefined && v > 0 ? v : undefined; } },
    { key: 'nodePath', read: (s) => getString(s, 'nodePath') },
    { key: 'injectVaultContext', read: (s) => getBoolean(s, 'injectVaultContext') },
    { key: 'injectCurrentNoteLink', read: (s) => getBoolean(s, 'injectCurrentNoteLink') },
    { key: 'model', read: (s) => getString(s, 'model') },
    { key: 'primaryColor', read: (s) => getString(s, 'primaryColor') },
    { key: 'contextWindowSize', read: (s) => { const v = getNumber(s, 'contextWindowSize'); return v !== undefined && v > 0 ? v : undefined; } },
    { key: 'permissionMode', read: (s) => isPermissionMode(s.permissionMode) ? s.permissionMode : undefined },
    { key: 'language', read: (s) => { const v = getString(s, 'language'); return v === 'zh' || v === 'en' || v === 'auto' ? v : undefined; } },
    { key: 'customInstruction', read: (s) => getString(s, 'customInstruction') },
    {
        key: 'pastedImageKeep',
        read: (s) => {
            const v = getNumber(s, 'pastedImageKeep');
            return v !== undefined && Number.isInteger(v) && v >= 0 && v <= MAX_PASTED_IMAGE_KEEP ? v : undefined;
        },
    },
    { key: 'mcpServersJson', read: (s) => getString(s, 'mcpServersJson') },
    { key: 'customAgentsJson', read: (s) => getString(s, 'customAgentsJson') },
    { key: 'thoughtLevel', read: (s) => getString(s, 'thoughtLevel') },
    { key: 'autoTitle', read: (s) => getBoolean(s, 'autoTitle') },
    {
        key: 'allowedExternalPaths',
        read: (s) => Array.isArray(s.allowedExternalPaths)
            ? s.allowedExternalPaths.filter((p): p is string => typeof p === 'string')
            : undefined,
    },
];

/** 任意形态的旧数据 → 当前版本设置：非对象直接给默认；逐字段按规则表读取，缺省回落默认值 */
export function migrateSettings(stored: unknown): WorkbuddianSettings {
    const base = { ...DEFAULT_SETTINGS, allowedExternalPaths: [...DEFAULT_SETTINGS.allowedExternalPaths] };
    if (!isObject(stored)) return base;
    const out = base as Record<string, unknown>;
    for (const rule of FIELD_RULES) {
        const value = rule.read(stored);
        if (value !== undefined) out[rule.key] = value;
    }
    out.version = CURRENT_SETTINGS_VERSION;
    return out as unknown as WorkbuddianSettings;
}

// ==================== 工具函数 ====================

/** RFC4122 v4 uuid：优先加密随机源，退回 Math.random（测试锁定 8-4-4-4-12 与版本位） */
export function generateId(): string {
    const bytes = new Uint8Array(16);
    const csp = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => void } }).crypto;
    if (csp?.getRandomValues) {
        csp.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ==================== 持久化数据类型 ====================

export interface PersistedData {
    conversations?: Conversation[];
    settings?: Partial<WorkbuddianSettings>;
}

/** 落盘 JSON → 内存态：会话数组原样采信，设置一律过迁移 */
export function normalizePersistedData(raw: unknown): PersistedData {
    if (!isObject(raw)) return {};
    const conversations = Array.isArray(raw.conversations)
        ? (raw.conversations as Conversation[])
        : undefined;
    const settings = isObject(raw.settings) ? migrateSettings(raw.settings) : undefined;
    return {
        ...(conversations ? { conversations } : {}),
        ...(settings ? { settings } : {}),
    };
}

/** 把设置序列化为可导出的 JSON 字符串 */
export function exportSettings(settings: WorkbuddianSettings): string {
    return JSON.stringify(settings, null, 2);
}
