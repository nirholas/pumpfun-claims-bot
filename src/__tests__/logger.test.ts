import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log, setLogFormat, setLogLevel, setLogOutput } from '../logger.js';

describe('logger', () => {
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setLogLevel('info');
        setLogFormat('text');
        setLogOutput('stdout');
    });

    it('writes text lines with printf-style formatting, filtered by level', () => {
        log.debug('hidden');
        log.info('claim %s for %d SOL', 'abc', 2);
        expect(stdout).toHaveBeenCalledTimes(1);
        expect(String(stdout.mock.calls[0]![0])).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[INFO\] claim abc for 2 SOL\n$/);
    });

    it('writes one JSON object per line in json format', () => {
        setLogFormat('json');
        log.warn('rpc %s failed', 'host');
        const line = String(stderr.mock.calls[0]![0]);
        expect(line.endsWith('\n')).toBe(true);
        expect(JSON.parse(line)).toMatchObject({ level: 'warn', msg: 'rpc host failed' });
    });

    it('sends warn and error to stderr, and everything there in stdio mode', () => {
        log.error('boom');
        expect(stderr).toHaveBeenCalledTimes(1);
        setLogOutput('stderr');
        log.info('quiet stdout');
        expect(stdout).not.toHaveBeenCalled();
        expect(stderr).toHaveBeenCalledTimes(2);
    });
});
