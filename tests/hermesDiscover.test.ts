import { discoverHermes } from '../src/shared/hermesDiscover';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeHermesDir(config: string, env = ''): string {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-test-'));
    if (config) writeFileSync(join(dir, 'config.yaml'), config);
    if (env) writeFileSync(join(dir, '.env'), env);
    return dir;
}

const CONFIG = `
model:
  default: kimi-k2.7-code
platforms:
  api_server:
    enabled: true
    extra:
      host: 127.0.0.1
      port: 8642
      key: hms-testkey123
`;

describe('discoverHermes', () => {
    it('reads api_server config from config.yaml', () => {
        const d = discoverHermes(makeHermesDir(CONFIG));
        expect(d).not.toBeNull();
        expect(d!.gatewayUrl).toBe('http://127.0.0.1:8642');
        expect(d!.apiKey).toBe('hms-testkey123');
        expect(d!.enabled).toBe(true);
    });

    it('falls back to .env for key/port', () => {
        const cfg = CONFIG.replace('      key: hms-testkey123\n', '').replace('      port: 8642\n', '');
        const d = discoverHermes(makeHermesDir(cfg, 'API_SERVER_PORT=9000\nAPI_SERVER_KEY=env-key\n'));
        expect(d!.gatewayUrl).toBe('http://127.0.0.1:9000');
        expect(d!.apiKey).toBe('env-key');
    });

    it('defaults port to 8642 when unset', () => {
        const cfg = CONFIG.replace('      port: 8642\n', '');
        const d = discoverHermes(makeHermesDir(cfg));
        expect(d!.gatewayUrl).toBe('http://127.0.0.1:8642');
    });

    it('enabled=false when api_server not enabled', () => {
        const d = discoverHermes(makeHermesDir('model:\n  default: x\n'));
        expect(d!.enabled).toBe(false);
    });

    it('returns null when nothing exists', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hermes-empty-'));
        mkdirSync(dir, { recursive: true });
        expect(discoverHermes(dir)).toBeNull();
    });
});
