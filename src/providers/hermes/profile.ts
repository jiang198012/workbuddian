import { resolveHermesPath } from '../../utils/cliPath';
import type { PermissionMode } from '../../shared/cliOptions';
import type { AcpBackendProfile } from '../acp/profile';
import { bbLog } from '../../shared/logBuffer';

// 模式映射（探针实证 hermes modes=[default, accept_edits, dont_ask]）
const OUTGOING_MODE: Record<PermissionMode, string> = {
    default: 'default',
    acceptEdits: 'accept_edits',
    bypassPermissions: 'dont_ask',
    plan: 'default', // hermes 无 plan 模式，回落 default
};
const INCOMING_MODE: Record<string, PermissionMode> = {
    default: 'default',
    accept_edits: 'acceptEdits',
    dont_ask: 'bypassPermissions',
};

/** hermes 方言剖面：全部映射规则均经 scripts/probe-hermes-acp.mjs 活探针实证（v0.20.5） */
export const HERMES_PROFILE: AcpBackendProfile = {
    id: 'hermes',
    resolveCliPath: resolveHermesPath,
    acpArgs: ['acp'],
    spawnViaNode: false, // hermes shim 是 bash 脚本：node 解释即 SyntaxError（v2.6.0 实测事故）
    mapOutgoingMode: (m) => OUTGOING_MODE[m],
    mapIncomingMode: (id) => INCOMING_MODE[id],
    async applyRemoteModel(client, sessionId, model) {
        if (!model || model === 'auto') return; // auto = 跟随 hermes 当前 provider 默认模型
        try {
            await client.request('session/set_model', { sessionId, modelId: model });
        } catch (e) { bbLog('[WB] hermes 设置模型失败（忽略）:', e); }
    },
    supportsThoughtLevel: false, // set_config_option 收下不执行（探针实证）→ 不下发
    isReplayUpdate: () => false, // hermes 回放无 meta 标记：由引擎 load 窗口通用判别
    toolNameMetaKeys: [], // _meta 恒空：工具名走 normalizeToolCall 的 rawInput.tool
    forkMode: 'native-rpc',
    normalizeToolCall(update) {
        const ri = update.rawInput;
        if (ri && typeof ri === 'object' && !Array.isArray(ri) && 'arguments' in (ri as Record<string, unknown>)) {
            const rec = ri as { tool?: unknown; arguments?: unknown };
            const args = rec.arguments && typeof rec.arguments === 'object' && !Array.isArray(rec.arguments)
                ? rec.arguments as Record<string, unknown> : {};
            return { toolName: typeof rec.tool === 'string' ? rec.tool : undefined, rawInput: args };
        }
        return {};
    },
};
