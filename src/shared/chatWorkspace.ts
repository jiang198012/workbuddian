import type { ConversationWorkspace, WorkbuddianSettings } from '../types';
import { isPermissionMode, isThoughtLevel } from './cliOptions';

/** 把全局默认设置与会话覆盖合并成发送时使用的完整工作区配置 */
export function resolveConversationWorkspace(
    settings: Pick<WorkbuddianSettings, 'model' | 'permissionMode' | 'thoughtLevel' | 'customInstruction' | 'injectVaultContext' | 'injectCurrentNoteLink'>,
    override?: Partial<ConversationWorkspace>,
): ConversationWorkspace {
    const model = typeof override?.model === 'string' && override.model.trim()
        ? override.model.trim() : settings.model;
    const permissionMode = isPermissionMode(override?.permissionMode)
        ? override.permissionMode
        : isPermissionMode(settings.permissionMode) ? settings.permissionMode : 'default';
    const thoughtLevel = isThoughtLevel(override?.thoughtLevel)
        ? override.thoughtLevel
        : isThoughtLevel(settings.thoughtLevel) ? settings.thoughtLevel : 'enabled';
    const customInstruction = typeof override?.customInstruction === 'string'
        ? override.customInstruction : settings.customInstruction;
    const injectVaultContext = typeof override?.injectVaultContext === 'boolean'
        ? override.injectVaultContext : settings.injectVaultContext;
    const injectCurrentNoteLink = typeof override?.injectCurrentNoteLink === 'boolean'
        ? override.injectCurrentNoteLink : settings.injectCurrentNoteLink;
    return { model, permissionMode, thoughtLevel, customInstruction, injectVaultContext, injectCurrentNoteLink };
}
