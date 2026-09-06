import { readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, relative } from 'path';

export interface SkillInfo {
    name: string;
    description: string;
    path: string;
    source: 'user' | 'vault';
}

export interface SkillFrontmatter {
    name: string;
    description: string;
}

/** 读取 SKILL.md 的最小元数据，不把技能正文默认注入聊天。 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = match ? match[1] : '';
    const name = frontmatter.match(/^name:\s*(.*)$/m)?.[1]?.trim() ?? '';
    const description = frontmatter.match(/^description(?:_zh)?:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ?? '';
    return { name, description };
}

function scanRoot(root: string, source: SkillInfo['source']): SkillInfo[] {
    const results: SkillInfo[] = [];
    const walk = (dir: string, depth: number) => {
        if (depth > 3) return;
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath, depth + 1);
                continue;
            }
            if (entry.name !== 'SKILL.md') continue;
            try {
                if (statSync(fullPath).size > 256 * 1024) continue;
                const metadata = parseSkillFrontmatter(readFileSync(fullPath, 'utf8'));
                const relativeName = relative(root, dir).split('\\').join('/');
                const fallbackName = relativeName || entry.name.replace(/\.md$/, '');
                const name = metadata.name || fallbackName;
                if (!/^[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(name)) continue;
                results.push({ name, description: metadata.description, path: fullPath, source });
            } catch { /* 单个损坏或不可读技能不应阻塞补全 */ }
        }
    };
    walk(root, 0);
    return results;
}

/** 扫描 WorkBuddy/CodeBuddy 的用户级与 Vault 级技能目录。仅返回元数据。 */
export function discoverSkills(vaultPath?: string, homePath: string = homedir()): SkillInfo[] {
    const roots: Array<{ path: string; source: SkillInfo['source'] }> = [
        { path: join(homePath, '.workbuddy', 'skills'), source: 'user' },
        { path: join(homePath, '.codebuddy', 'skills'), source: 'user' },
    ];
    if (vaultPath) {
        roots.push(
            { path: join(vaultPath, '.workbuddy', 'skills'), source: 'vault' },
            { path: join(vaultPath, '.codebuddy', 'skills'), source: 'vault' },
        );
    }
    const byName = new Map<string, SkillInfo>();
    for (const root of roots) {
        for (const skill of scanRoot(root.path, root.source)) {
            if (!byName.has(skill.name) || skill.source === 'vault') byName.set(skill.name, skill);
        }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
