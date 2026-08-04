import { parseMcpServers, serializeMcpServers, activeMcpServers, parseClipboardServers } from '../src/shared/mcpServers';

describe('parseMcpServers', () => {
    it('parses stdio servers with args and env record', () => {
        const servers = parseMcpServers('[{"name":"a","command":"npx","args":["-y","pkg"],"env":{"K":"V"}}]');
        expect(servers).toEqual([{ name: 'a', command: 'npx', args: ['-y', 'pkg'], env: [{ name: 'K', value: 'V' }], disabled: undefined }]);
    });
    it('tolerates junk and non-array', () => {
        expect(parseMcpServers('')).toEqual([]);
        expect(parseMcpServers('{}')).toEqual([]);
        expect(parseMcpServers('[{"command":"node"}]')).toEqual([]); // 无 name 丢弃
    });
    it('keeps disabled flag', () => {
        expect(parseMcpServers('[{"name":"a","disabled":true}]')[0].disabled).toBe(true);
    });
});

describe('serializeMcpServers / activeMcpServers', () => {
    it('roundtrips and filters disabled on injection', () => {
        const servers = parseMcpServers('[{"name":"a","command":"c","args":[],"env":[]},{"name":"b","command":"d","args":[],"env":[],"disabled":true}]');
        expect(activeMcpServers(servers)).toEqual([{ name: 'a', command: 'c', args: [], env: [] }]);
        expect(serializeMcpServers(servers)).toContain('"disabled":true');
    });
});

describe('parseClipboardServers', () => {
    it('parses mcpServers wrapper form', () => {
        const text = '{"mcpServers":{"fs":{"command":"npx","args":["-y","@mcp/fs"]}}}';
        expect(parseClipboardServers(text).map((s) => s.name)).toEqual(['fs']);
    });
    it('parses single-server form', () => {
        expect(parseClipboardServers('{"name":"x","command":"node"}').map((s) => s.name)).toEqual(['x']);
    });
    it('rejects junk', () => {
        expect(parseClipboardServers('not json')).toEqual([]);
    });
});
