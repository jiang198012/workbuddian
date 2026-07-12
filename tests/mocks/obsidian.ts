// Mock Obsidian API for testing

// ==================== 辅助：模拟 Obsidian 的 HTMLElement 扩展方法 ====================
function createObsidianEl(tag: string): HTMLElement {
    const el = document.createElement(tag);
    // Obsidian 在 HTMLElement 上添加的快捷方法
    (el as any).empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
    (el as any).createEl = function (t: string, attrs?: any) {
        const child = createObsidianEl(t);
        if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
                if (key === 'cls') {
                    child.className = value as string;
                } else if (key === 'text') {
                    child.textContent = value as string;
                } else if (key === 'href') {
                    (child as HTMLAnchorElement).href = value as string;
                } else if (key === 'value') {
                    (child as HTMLInputElement).value = value as string;
                } else if (key.startsWith('on')) {
                    (child as any)[key] = value;
                } else {
                    child.setAttribute(key, value as string);
                }
            }
        }
        el.appendChild(child);
        return child;
    };
    (el as any).createDiv = function (attrs?: any) { return (this as any).createEl('div', attrs); };
    (el as any).addClass = function (cls: string) { this.classList.add(cls); };
    return el;
}

export class Notice {
    constructor(public message: string) {}
}

export class ItemView {
    app: any;
    contentEl: HTMLElement;
    constructor(public leaf: any) {
        this.contentEl = createObsidianEl('div');
    }
    getViewType(): string { return ''; }
    getDisplayText(): string { return ''; }
    getIcon(): string { return ''; }
    async onOpen() {}
    async onClose() {}
}

export class Plugin {
    app: any;
    loadData(): Promise<any> { return Promise.resolve({}); }
    saveData(data: any): Promise<void> { return Promise.resolve(); }
    registerView(type: string, factory: Function) {}
    registerEvent(event: any) {}
    addRibbonIcon(icon: string, title: string, callback: Function) {}
    addCommand(command: any) {}
    addSettingTab(tab: any) {}
}

export class PluginSettingTab {
    containerEl: HTMLElement;
    constructor(public app: any, public plugin: any) {
        this.containerEl = createObsidianEl('div');
    }
    display(): void {}
}

export class MarkdownView {
    editor: any;
    constructor(public leaf: any) {
        this.editor = {
            getSelection: () => '',
            getValue: () => '',
            getCursor: () => ({ line: 0, ch: 0 }),
            lastLine: () => 0,
            getLine: (line: number) => '',
            replaceSelection: (text: string) => {},
            replaceRange: (text: string, pos: any) => {}
        };
    }
}

export class TFile {
    extension: string = 'md';
    path: string = '';
    name: string = '';
    parent: TFolder | null = null;
    constructor(path: string) {
        this.path = path;
        this.name = path.split('/').pop() || '';
    }
}

export class TFolder {
    children: Array<TFile | TFolder> = [];
    path: string = '';
    name: string = '';
    constructor(path: string) {
        this.path = path;
        this.name = path.split('/').pop() || '';
    }
}

export function debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number,
    immediate?: boolean
): T {
    let timeout: ReturnType<typeof setTimeout>;
    return function (this: any, ...args: any[]) {
        clearTimeout(timeout);
        if (immediate) {
            func.apply(this, args);
        }
        timeout = setTimeout(() => {
            if (!immediate) {
                func.apply(this, args);
            }
        }, delay);
    } as any;
}

export class WorkspaceLeaf {
    view: any = null;
}

export class Workspace {
    getActiveViewOfType<T>(type: any): T | null { return null; }
    getActiveFile(): TFile | null { return null; }
    getLeavesOfType(type: string): WorkspaceLeaf[] { return []; }
    getRightLeaf(split: boolean): WorkspaceLeaf | null { return null; }
    revealLeaf(leaf: WorkspaceLeaf): void {}
}

export class Vault {
    adapter: any = { basePath: '/test-vault' };
    read(file: TFile): Promise<string> { return Promise.resolve(''); }
    on(name: string, callback: Function): any { return { unsubscribe: () => {} }; }
}

export class App {
    workspace: Workspace = new Workspace();
    vault: Vault = new Vault();
}
