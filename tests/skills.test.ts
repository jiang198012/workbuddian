import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverSkills, parseSkillFrontmatter } from '../src/shared/skills';

describe('skills', () => {
    it('parses name and description from SKILL.md frontmatter', () => {
        expect(parseSkillFrontmatter('---\nname: reviewer\ndescription: Review code\n---\nbody'))
            .toEqual({ name: 'reviewer', description: 'Review code' });
    });

    it('discovers user and vault skills with vault override', () => {
        const root = mkdtempSync(join(tmpdir(), 'workbuddian-skills-'));
        const home = join(root, 'home');
        const vault = join(root, 'vault');
        mkdirSync(join(home, '.workbuddy', 'skills', 'reviewer'), { recursive: true });
        mkdirSync(join(vault, '.codebuddy', 'skills', 'reviewer'), { recursive: true });
        mkdirSync(join(vault, '.codebuddy', 'skills', 'writer'), { recursive: true });
        writeFileSync(join(home, '.workbuddy', 'skills', 'reviewer', 'SKILL.md'), '---\nname: reviewer\ndescription: user\n---\n');
        writeFileSync(join(vault, '.codebuddy', 'skills', 'reviewer', 'SKILL.md'), '---\nname: reviewer\ndescription: vault\n---\n');
        writeFileSync(join(vault, '.codebuddy', 'skills', 'writer', 'SKILL.md'), '---\nname: writer\ndescription: write\n---\n');
        try {
            expect(discoverSkills(vault, home).map(s => [s.name, s.description, s.source])).toEqual([
                ['reviewer', 'vault', 'vault'], ['writer', 'write', 'vault'],
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
