import {
    mapSessionUpdate, mapUsageUpdate, mapConfigUpdate,
    extractToolName, summarizeRawInput, mergeRawInput, isReplayUpdate,
} from '../src/providers/codebuddy/acp/events';

describe('mapSessionUpdate', () => {
    it('maps agent_thought_chunk to thinking chunk', () => {
        expect(mapSessionUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }))
            .toEqual({ type: 'thinking', content: 'hmm' });
    });
    it('maps agent_message_chunk to text chunk', () => {
        expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } }))
            .toEqual({ type: 'text', content: '你好' });
    });
    it('returns null for non-text content blocks', () => {
        expect(mapSessionUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'x' } })).toBeNull();
    });
    it('maps tool_call to tool chunk with _meta toolName and rawInput summary', () => {
        const chunk = mapSessionUpdate({
            sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write', rawInput: { file_path: '/a/b.md' },
            _meta: { 'codebuddy.ai/toolName': 'Write' },
        });
        expect(chunk).toEqual({ type: 'tool', content: '', toolName: 'Write', toolDetail: '/a/b.md' });
    });
    it.each(['tool_call_update', 'usage_update', 'config_option_update', 'current_mode_update',
        'session_info_update', 'available_commands_update', 'user_message_chunk'])('returns null for %s', (k) => {
        expect(mapSessionUpdate({ sessionUpdate: k })).toBeNull();
    });
});

describe('extractToolName / summarizeRawInput / mergeRawInput', () => {
    it('prefers _meta codebuddy toolName over title', () => {
        expect(extractToolName({ title: 'Write', _meta: { 'codebuddy.ai/toolName': 'Write' } })).toBe('Write');
        expect(extractToolName({ title: 'Bash' })).toBe('Bash');
        expect(extractToolName({})).toBe('tool');
    });
    it('summarizes rawInput by file_path then command then compact json', () => {
        expect(summarizeRawInput({ file_path: '/a/b.md' })).toBe('/a/b.md');
        expect(summarizeRawInput({ command: 'ls -la' })).toBe('ls -la');
        expect(summarizeRawInput({})).toBe('');
    });
    it('truncates long json summaries', () => {
        const long = summarizeRawInput({ data: 'x'.repeat(200) });
        expect(long.length).toBeLessThanOrEqual(120);
        expect(long.endsWith('...')).toBe(true);
    });
    it('merges rawInput increments shallowly', () => {
        expect(mergeRawInput({ file_path: 'a' }, { content: 'x' })).toEqual({ file_path: 'a', content: 'x' });
        expect(mergeRawInput(null, { a: 1 })).toEqual({ a: 1 });
        expect(mergeRawInput({ a: 1 }, null)).toEqual({ a: 1 });
    });
});

describe('mapUsageUpdate / mapConfigUpdate / isReplayUpdate', () => {
    it('reads used/size from usage_update', () => {
        expect(mapUsageUpdate({ sessionUpdate: 'usage_update', used: 24091, size: 168000 }))
            .toEqual({ used: 24091, size: 168000 });
        expect(mapUsageUpdate({ sessionUpdate: 'usage_update' })).toBeNull();
        expect(mapUsageUpdate({ sessionUpdate: 'agent_message_chunk' })).toBeNull();
    });
    it('reads mode/model currentValue from config_option_update', () => {
        expect(mapConfigUpdate({
            sessionUpdate: 'config_option_update',
            configOptions: [
                { id: 'mode', currentValue: 'plan' },
                { id: 'model', currentValue: 'glm-5.2' },
            ],
        })).toEqual({ mode: 'plan', model: 'glm-5.2' });
        expect(mapConfigUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toEqual({ mode: 'plan' });
        expect(mapConfigUpdate({ sessionUpdate: 'usage_update' })).toBeNull();
    });
    it('detects history replay via _meta mode', () => {
        expect(isReplayUpdate({ _meta: { 'codebuddy.ai': { mode: 'history' } } })).toBe(true);
        expect(isReplayUpdate({})).toBe(false);
    });
});
