import type { App, EventRef } from 'obsidian';

/**
 * 插件内 config 变更广播（WB-007）：CLI 侧经 /effort、/model 等改动配置后，回流链会更新 settings，
 * 已打开的设置页借此事件就地刷新对应控件，不必重开设置页。
 * Obsidian workspace 事件类型不含自定义名，此处统一做一次类型收窄，调用方不再各自强转。
 */
const CONFIG_CHANGED_EVENT = 'workbuddian:config-changed';

export function emitConfigChanged(app: App): void {
    (app.workspace.trigger as (name: string) => void)(CONFIG_CHANGED_EVENT);
}

export function onConfigChanged(app: App, cb: () => void): EventRef {
    return (app.workspace.on as (name: string, callback: () => void) => EventRef)(CONFIG_CHANGED_EVENT, cb);
}
