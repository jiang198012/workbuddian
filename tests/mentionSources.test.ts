import { parseAgentNames, parseMcpServerNames } from '../src/shared/mentionSources';

describe('parseAgentNames', () => {
    it('reads keys from agents json', () => {
        expect(parseAgentNames('{"reviewer":{"description":"d"},"coder":{}}')).toEqual(['reviewer', 'coder']);
    });
    it('tolerates junk', () => {
        expect(parseAgentNames('')).toEqual([]);
        expect(parseAgentNames('{bad')).toEqual([]);
        expect(parseAgentNames('["x"]')).toEqual([]);
        expect(parseAgentNames('42')).toEqual([]);
    });
});

describe('parseMcpServerNames', () => {
    it('reads name fields from servers array', () => {
        expect(parseMcpServerNames('[{"name":"fake","command":"node"},{"name":"x"}]')).toEqual(['fake', 'x']);
    });
    it('tolerates junk and missing names', () => {
        expect(parseMcpServerNames('{}')).toEqual([]);
        expect(parseMcpServerNames('[{"command":"node"}]')).toEqual([]);
        expect(parseMcpServerNames('bad')).toEqual([]);
    });
});
