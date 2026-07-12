import { parseSlashCommand, extractSlashQuery, filterSlashCommands, BUILTIN_SLASH_COMMANDS } from '../src/shared/slashCommand';

describe('parseSlashCommand', () => {
    it('parses /clear', () => {
        expect(parseSlashCommand('/clear')).toEqual({ name: 'clear', rest: '' });
    });
    it('parses command with args', () => {
        expect(parseSlashCommand('/model glm-5.2')).toEqual({ name: 'model', rest: 'glm-5.2' });
    });
    it('parses a bare command', () => {
        expect(parseSlashCommand('/cost')).toEqual({ name: 'cost', rest: '' });
    });
    it('returns null for normal text', () => {
        expect(parseSlashCommand('hello')).toBeNull();
    });
    it('returns null for a lone slash', () => {
        expect(parseSlashCommand('/')).toBeNull();
    });
    it('returns null for slash followed by space', () => {
        expect(parseSlashCommand('/ hello')).toBeNull();
    });
    it('trims surrounding whitespace', () => {
        expect(parseSlashCommand('  /status  ')).toEqual({ name: 'status', rest: '' });
    });
    it('only considers the first line', () => {
        expect(parseSlashCommand('/cost\nmore')).toEqual({ name: 'cost', rest: '' });
    });
});

describe('extractSlashQuery', () => {
    it('returns empty string for a lone slash at cursor', () => {
        expect(extractSlashQuery('/', 1)).toBe('');
    });
    it('returns the command prefix', () => {
        expect(extractSlashQuery('/co', 3)).toBe('co');
    });
    it('returns null once past the command name (space)', () => {
        expect(extractSlashQuery('/clear ', 7)).toBeNull();
    });
    it('returns null for non-slash text', () => {
        expect(extractSlashQuery('hello', 5)).toBeNull();
    });
    it('returns null when cursor is on a later line', () => {
        expect(extractSlashQuery('/a\nb', 3)).toBeNull();
    });
});

describe('filterSlashCommands', () => {
    it('returns all for empty query', () => {
        expect(filterSlashCommands('')).toHaveLength(BUILTIN_SLASH_COMMANDS.length);
    });
    it('filters by prefix', () => {
        expect(filterSlashCommands('co').map(c => c.name)).toEqual(['compact', 'context', 'cost']);
    });
    it('matches a single command', () => {
        expect(filterSlashCommands('clear').map(c => c.name)).toEqual(['clear']);
    });
    it('returns empty array for no match', () => {
        expect(filterSlashCommands('zzz')).toEqual([]);
    });
});
