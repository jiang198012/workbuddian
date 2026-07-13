import { bbLog, bbError, getLogs, clearLogs } from '../src/shared/logBuffer';

describe('logBuffer', () => {
    let logSpy: jest.SpyInstance;
    let errSpy: jest.SpyInstance;

    beforeEach(() => {
        clearLogs();
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        logSpy.mockRestore();
        errSpy.mockRestore();
    });

    it('captures a log line and still forwards to console.log', () => {
        bbLog('[BB] hello', 42);
        const logs = getLogs();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain('[BB] hello');
        expect(logs[0]).toContain('42');
        expect(logSpy).toHaveBeenCalledWith('[BB] hello', 42);
    });

    it('marks error lines and forwards to console.error', () => {
        bbError('[BB] boom');
        const logs = getLogs();
        expect(logs[0]).toContain('ERR');
        expect(logs[0]).toContain('[BB] boom');
        expect(errSpy).toHaveBeenCalledWith('[BB] boom');
    });

    it('serializes non-string args', () => {
        bbLog('x', { a: 1 });
        expect(getLogs()[0]).toContain('{"a":1}');
    });

    it('caps the buffer at 300 entries, dropping the oldest', () => {
        for (let i = 0; i < 350; i++) bbLog('line', i);
        const logs = getLogs();
        expect(logs).toHaveLength(300);
        expect(logs[0]).toContain('50');          // 0..49 dropped
        expect(logs[logs.length - 1]).toContain('349');
    });

    it('clearLogs empties the buffer', () => {
        bbLog('a');
        clearLogs();
        expect(getLogs()).toHaveLength(0);
    });
});
