import { AcpProvider } from '../acp/provider';
import { HERMES_PROFILE } from './profile';

/**
 * Hermes ACP 完整版 provider：spawn `hermes acp`，全能力（工具/批准卡/thinking/usage/fork）。
 * 公共契约与 CodebuddyProvider 一致（main.ts 联合类型不动）。
 */
export class HermesAcpProvider extends AcpProvider {
    constructor(timeout?: number) { super(HERMES_PROFILE, timeout); }

    /** hermes acp 无 --agents 旗标：空操作（main.ts 会无条件灌 customAgentsJson） */
    setCustomAgentsJson(_json: string): void {}

    /** 路由器灌入：自定义 CLI 路径（--check 探测与 spawn 同一路径来源） */
    setCliPath(p: string): void { this.client.setCliPath(p); }

}
