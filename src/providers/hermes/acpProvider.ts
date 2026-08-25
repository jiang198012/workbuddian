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

    /** 设置页模型下拉展示用：label 来自握手 availableModels 的 name 字段（探针实证），缺省回落 id */
    getAvailableModelLabels(): Array<{ id: string; label: string }> {
        return this.modelPairs.map((m) => ({ id: m.id, label: m.name ?? m.id }));
    }
    protected modelPairs: Array<{ id: string; name?: string }> = [];
    protected override onModels(models: Array<{ id: string; name?: string }>): void {
        this.modelPairs = models;
        super.onModels(models);
    }
}
