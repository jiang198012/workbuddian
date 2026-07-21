import { type ChildProcess, type SpawnOptions } from 'child_process';
import { FALLBACK_MODEL_OPTIONS } from '../../shared/cliOptions';
import { spawnCli, needsWindowsShell } from '../../utils/cliPath';

export interface ModelListResult {
    models: string[];
    source: 'cli' | 'fallback';
}

export function parseModelList(helpText: string): string[] {
    const match = helpText.match(/--model\s+<model>[^\n]*Currently supported:\s*\(([^)]+)\)/i);
    if (!match) return [];
    return match[1]
        .split(',')
        .map(s => s.trim())
        .filter(s => s && s !== 'auto');
}

export async function fetchModels(scriptPath: string, nodePath?: string, timeoutMs = 10_000): Promise<ModelListResult> {
    const fallback: ModelListResult = {
        models: Object.keys(FALLBACK_MODEL_OPTIONS),
        source: 'fallback',
    };

    return new Promise((resolve) => {
        const procOptions: SpawnOptions = { stdio: ['ignore', 'pipe', 'pipe'] };
        if (needsWindowsShell(scriptPath)) {
            procOptions.shell = true;
        }

        const proc: ChildProcess = spawnCli(scriptPath, ['--help'], procOptions, nodePath);

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
            proc.kill();
            resolve(fallback);
        }, timeoutMs);

        proc.on('error', () => {
            clearTimeout(timer);
            resolve(fallback);
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                resolve(fallback);
                return;
            }
            const text = stdout || stderr;
            const models = parseModelList(text);
            if (models.length === 0) {
                resolve(fallback);
            } else {
                resolve({ models, source: 'cli' });
            }
        });
    });
}
