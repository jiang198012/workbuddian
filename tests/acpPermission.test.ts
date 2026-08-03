import { mapPermissionRequest, buildPermissionResult, pickOptionId } from '../src/providers/codebuddy/acp/permission';

const OPTIONS = [
    { kind: 'allow_always', name: 'Always Allow', optionId: 'allow_always' },
    { kind: 'allow_once', name: 'Allow', optionId: 'allow' },
    { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
];

function paramsOf(toolName: string, rawInput: unknown, metaToolName?: string) {
    return {
        sessionId: 's1',
        options: OPTIONS,
        toolCall: { toolCallId: 'c1', rawInput, _meta: metaToolName ? { 'codebuddy.ai/toolName': metaToolName } : undefined },
    };
}

describe('mapPermissionRequest', () => {
    it('maps Write to path + line count', () => {
        const data = mapPermissionRequest(0, paramsOf('Write', { file_path: '/a/b.md', content: 'l1\nl2\nl3' }, 'Write'));
        expect(data).toMatchObject({ requestId: 0, sessionId: 's1', toolName: 'Write', isPlanApproval: false });
        expect(data.detail).toEqual({ kind: 'write', path: '/a/b.md', lines: 3 });
        expect(data.options).toEqual([
            { optionId: 'allow_always', kind: 'allow_always', label: 'Always Allow' },
            { optionId: 'allow', kind: 'allow_once', label: 'Allow' },
            { optionId: 'reject', kind: 'reject_once', label: 'Reject' },
        ]);
    });
    it('maps Edit to path + old/new text', () => {
        const data = mapPermissionRequest(1, paramsOf('Edit', { file_path: 'a.md', old_string: 'foo', new_string: 'bar' }, 'Edit'));
        expect(data.detail).toEqual({ kind: 'edit', path: 'a.md', oldText: 'foo', newText: 'bar' });
    });
    it('maps Bash to full command', () => {
        const data = mapPermissionRequest(2, paramsOf('Bash', { command: 'rm -rf /tmp/x' }, 'Bash'));
        expect(data.detail).toEqual({ kind: 'bash', command: 'rm -rf /tmp/x' });
    });
    it('flags DeferExecuteTool as plan approval', () => {
        const data = mapPermissionRequest(3, paramsOf('ExitPlanMode', { params: {}, toolName: 'ExitPlanMode' }, 'DeferExecuteTool'));
        expect(data.isPlanApproval).toBe(true);
        expect(data.detail).toEqual({ kind: 'plan' });
    });
    it('flags rawInput ExitPlanMode as plan approval even without _meta', () => {
        const data = mapPermissionRequest(5, paramsOf('tool', { params: {}, toolName: 'ExitPlanMode' }));
        expect(data.isPlanApproval).toBe(true);
    });
    it('falls back to generic summary for unknown tools', () => {
        const data = mapPermissionRequest(4, paramsOf('WebFetch', { url: 'https://x.com' }, 'WebFetch'));
        expect(data.detail.kind).toBe('generic');
        expect(data.toolName).toBe('WebFetch');
    });
    it('tolerates malformed params', () => {
        const data = mapPermissionRequest(6, null);
        expect(data.sessionId).toBe('');
        expect(data.options).toEqual([]);
        expect(data.detail.kind).toBe('generic');
    });
});

describe('buildPermissionResult / pickOptionId', () => {
    it('builds the selected-outcome wire shape', () => {
        expect(buildPermissionResult('allow')).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    });
    it('picks option ids by kind prefix without confusing allow_once/allow_always', () => {
        const opts = mapPermissionRequest(0, paramsOf('Bash', {}, 'Bash')).options;
        expect(pickOptionId(opts, 'allow_once')).toBe('allow');
        expect(pickOptionId(opts, 'allow_always')).toBe('allow_always');
        expect(pickOptionId(opts, 'reject')).toBe('reject');
        expect(pickOptionId([], 'reject')).toBeUndefined();
    });
});
