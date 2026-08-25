import type { PermissionMode } from '../../shared/cliOptions';
import { resolveCodebuddyPath } from '../../utils/cliPath';
import { bbLog } from '../../shared/logBuffer';
import type { AcpUpdate } from './events';

/** applyRemoteModel 对传输层的最小依赖（AcpClient/AcpClientFacade 天然满足） */
export interface ModelConfigClient {
    request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
}

/** 后端方言剖面：ACP 共享引擎与具体 CLI 之间的全部差异点 */
export interface AcpBackendProfile {
    readonly id: 'codebuddy' | 'hermes';
    /** CLI 路径解析：自定义覆盖 → 自动发现 → bare fallback */
    resolveCliPath(customPath: string): string;
    /** spawn 时 CLI 后的 ACP 入口参数 */
    readonly acpArgs: readonly string[];
    /** 插件权限模式 → agent 侧 mode id */
    mapOutgoingMode(mode: PermissionMode): string;
    /** agent 侧 mode id → 插件权限模式（不认识返回 undefined） */
    mapIncomingMode(modeId: string): PermissionMode | undefined;
    /** 模型下发到远端会话 */
    applyRemoteModel(client: ModelConfigClient, sessionId: string, model: string): Promise<void>;
    /** thoughtLevel 是否真下发（hermes 收下不执行 → false 跳过） */
    readonly supportsThoughtLevel: boolean;
    /** session/load 回放事件的 meta 判别（hermes 无标记 → 恒 false，靠引擎 load 窗口） */
    isReplayUpdate(update: AcpUpdate): boolean;
    /** extractToolName 读取的 _meta 键（空 = 只用 title 兜底） */
    readonly toolNameMetaKeys: readonly string[];
    /** fork 机制：/branch prompt 捕获（codebuddy）| session/fork RPC（hermes） */
    readonly forkMode: 'branch-prompt' | 'native-rpc';
    /** 工具事件归一化（探针实证 hermes rawInput 为 {tool, arguments} 嵌套）：返回平铺补丁，codebuddy 恒等 {} */
    normalizeToolCall(update: { title?: unknown; rawInput?: unknown; _meta?: unknown; [key: string]: unknown }):
        { toolName?: string; rawInput?: Record<string, unknown> };
}

/**
 * 引擎默认方言 = codebuddy（引擎的历史行为钉）。
 * 注意：本对象内联实现回放判别（与 events.ts 的 isReplayUpdate 同逻辑）——
 * profile.ts 不能运行时 import events.ts（events.ts 运行时 import 本文件拿默认值，会成环）。
 */
export const ACP_DEFAULT_PROFILE: AcpBackendProfile = {
    id: 'codebuddy',
    resolveCliPath: resolveCodebuddyPath,
    acpArgs: ['--acp'],
    mapOutgoingMode: (m) => m,
    mapIncomingMode: (id) => id as PermissionMode,
    async applyRemoteModel(client, sessionId, model) {
        try {
            await client.request('session/set_config_option', { sessionId, configId: 'model', value: model });
        } catch (e) { bbLog('[WB] acp 设置模型失败（忽略）:', e); }
    },
    supportsThoughtLevel: true,
    isReplayUpdate: (update) => {
        const meta = update._meta as Record<string, unknown> | undefined;
        const cb = meta?.['codebuddy.ai'] as { mode?: unknown } | undefined;
        return cb?.mode === 'history';
    },
    toolNameMetaKeys: ['codebuddy.ai/toolName'],
    forkMode: 'branch-prompt',
    normalizeToolCall: () => ({}),
};
