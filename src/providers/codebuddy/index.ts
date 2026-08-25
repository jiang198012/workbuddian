import { AcpProvider } from '../acp/provider';
import { CODEBUDDY_PROFILE } from './profile';
import { bbLog } from '../../shared/logBuffer';

// 供测试与外部消费方沿用 v1 的 re-export 路径
export { isWindowsWrapper, isBareFallback, needsWindowsShell } from '../../utils/cliPath';
export type { StreamChunk } from '../acp/events';

/**
 * CodebuddyProvider v2 —— ACP 持久会话架构：单进程 `codebuddy --acp` + 多 session。
 * 对外契约与 v1 一致（StreamChunk / 公共方法签名 / 错误 throw）；后端无关实现全部在
 * AcpProvider 基类（providers/acp/provider.ts），本类仅余 codebuddy 专属灌线。
 */
export class CodebuddyProvider extends AcpProvider {
    constructor(timeout?: number) { super(CODEBUDDY_PROFILE, timeout); }

    setCodebuddyPath(p: string): void { this.client.setCliPath(p); }
    setNodePath(nodePath: string): void { this.client.setNodePath(nodePath); }

    /** 子代理 JSON（对象）：转为 CLI --agents 启动旗标；解析失败保留旧值；空串清空 */
    setCustomAgentsJson(json: string): void {
        const trimmed = json.trim();
        if (!trimmed) { this.client.setExtraArgs([]); return; }
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('agents 必须是对象');
            this.client.setExtraArgs(['--agents', trimmed]);
        } catch (e) {
            bbLog('[WB] customAgentsJson 解析失败，保留旧值:', e);
        }
    }
}
