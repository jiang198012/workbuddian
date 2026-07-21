import { parseModelList, fetchModels } from '../src/providers/codebuddy/models';
import { FALLBACK_MODEL_OPTIONS } from '../src/shared/cliOptions';

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

import { spawn } from 'child_process';

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createFakeProc() {
    const handlers: Record<string, Function[]> = {};
    const proc = {
        stdout: {
            on: (event: string, cb: Function) => {
                handlers[`stdout:${event}`] = handlers[`stdout:${event}`] || [];
                handlers[`stdout:${event}`].push(cb);
            }
        },
        stderr: {
            on: (event: string, cb: Function) => {
                handlers[`stderr:${event}`] = handlers[`stderr:${event}`] || [];
                handlers[`stderr:${event}`].push(cb);
            }
        },
        on: (event: string, cb: Function) => {
            handlers[event] = handlers[event] || [];
            handlers[event].push(cb);
        },
        kill: jest.fn()
    };
    const emit = (source: string, event: string, ...args: unknown[]) => {
        const key = source ? `${source}:${event}` : event;
        handlers[key]?.forEach(cb => cb(...args));
    };
    return { proc, emit };
}

describe('parseModelList', () => {
    it('parses model list from --help output', () => {
        const help = `
--model <model>                                  Model for the current session. Please provide the model ID. Currently supported: (auto, hy3, glm-5.2, glm-5.1, glm-5v-turbo, minimax-m3, kimi-k2.7, kimi-k2.6, deepseek-v4-flash, deepseek-v4-pro)
        `;
        expect(parseModelList(help)).toEqual([
            'hy3',
            'glm-5.2',
            'glm-5.1',
            'glm-5v-turbo',
            'minimax-m3',
            'kimi-k2.7',
            'kimi-k2.6',
            'deepseek-v4-flash',
            'deepseek-v4-pro',
        ]);
    });

    it('returns empty array when --model line is missing', () => {
        expect(parseModelList('some other help text')).toEqual([]);
    });

    it('excludes auto from the list', () => {
        const help = '--model <model> Currently supported: (auto, hy3)';
        expect(parseModelList(help)).toEqual(['hy3']);
    });

    it('returns an empty array for empty help text', () => {
        expect(parseModelList('')).toEqual([]);
    });

    it('trims whitespace around model names', () => {
        const help = '--model <model> Currently supported: ( hy3 , glm-5.2 , minimax-m3 )\n';
        expect(parseModelList(help)).toEqual(['hy3', 'glm-5.2', 'minimax-m3']);
    });

    it('is case-insensitive for the --model help line', () => {
        const help = '--model <model> CURRENTLY SUPPORTED: (hy3, GLM-5.2)\n';
        expect(parseModelList(help)).toEqual(['hy3', 'GLM-5.2']);
    });

    it('returns an empty array for malformed parentheses', () => {
        expect(parseModelList('--model <model> Currently supported: (hy3')).toEqual([]);
    });
});

describe('fetchModels', () => {
    beforeEach(() => {
        mockedSpawn.mockClear();
    });

    it('returns CLI models when --help succeeds', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);

        const help = '--model <model> ... Currently supported: (auto, hy3)';
        const promise = fetchModels('codebuddy');

        emit('stdout', 'data', Buffer.from(help));
        emit('', 'close', 0, null);

        const result = await promise;
        expect(result.source).toBe('cli');
        expect(result.models).toEqual(['hy3']);
    });

    it('returns fallback models when CLI exits with non-zero', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);

        const promise = fetchModels('codebuddy');
        emit('', 'close', 1, null);

        const result = await promise;
        expect(result.source).toBe('fallback');
        expect(result.models).toEqual(Object.keys(FALLBACK_MODEL_OPTIONS));
    });

    it('returns fallback models when --help output has no model line', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);

        const promise = fetchModels('codebuddy');
        emit('stdout', 'data', Buffer.from('some other help'));
        emit('', 'close', 0, null);

        const result = await promise;
        expect(result.source).toBe('fallback');
        expect(result.models).toEqual(Object.keys(FALLBACK_MODEL_OPTIONS));
    });

    it('returns fallback models on spawn error', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);

        const promise = fetchModels('codebuddy');
        emit('', 'error', new Error('ENOENT'));

        const result = await promise;
        expect(result.source).toBe('fallback');
        expect(result.models).toEqual(Object.keys(FALLBACK_MODEL_OPTIONS));
    });

    it('resolves to fallback when the process hangs', async () => {
        const { proc } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);

        const promise = fetchModels('codebuddy', undefined, 50);
        // intentionally never emit 'close'

        const result = await promise;
        expect(result.source).toBe('fallback');
        expect(result.models).toEqual(Object.keys(FALLBACK_MODEL_OPTIONS));
        expect(proc.kill).toHaveBeenCalled();
    });

    it('uses custom node path when spawning a plain script', async () => {
        const { proc, emit } = createFakeProc();
        mockedSpawn.mockReturnValue(proc as any);

        const help = '--model <model> ... Currently supported: (auto, hy3)';
        const promise = fetchModels('/path/to/codebuddy', '/custom/node/bin/node');

        emit('stdout', 'data', Buffer.from(help));
        emit('', 'close', 0, null);

        const result = await promise;
        expect(result.source).toBe('cli');
        expect(result.models).toEqual(['hy3']);
        expect(mockedSpawn).toHaveBeenCalledTimes(1);
        const [command, args] = mockedSpawn.mock.calls[0];
        expect(command).toBe('/custom/node/bin/node');
        expect(args).toEqual(['/path/to/codebuddy', '--help']);
    });
});
