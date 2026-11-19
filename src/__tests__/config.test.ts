import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../config.js';

const REQUIRED = { TELEGRAM_BOT_TOKEN: 'test-token', CHANNEL_ID: '@test' };

function problemsFor(env: Record<string, string>): string[] {
    try {
        loadConfig({ ...REQUIRED, ...env });
    } catch (err) {
        if (err instanceof ConfigError) return err.problems;
        throw err;
    }
    return [];
}

describe('loadConfig', () => {
    it('applies defaults when only the required variables are set', () => {
        const config = loadConfig(REQUIRED);
        expect(config.solanaRpcUrl).toBe('https://api.mainnet-beta.solana.com');
        expect(config.solanaRpcUrls).toEqual(['https://api.mainnet-beta.solana.com']);
        expect(config.solanaWsUrl).toBe('wss://api.mainnet-beta.solana.com/');
        expect(config.solanaWsUrlExplicit).toBe(false);
        expect(config.pollIntervalSeconds).toBe(30);
        expect(config.logLevel).toBe('info');
        expect(config.feed).toEqual({ claims: true, graduations: false, feeDistributions: false });
        expect(config.requireGithub).toBe(true);
        expect(config.healthPort).toBe(3000);
        expect(config.mcp).toEqual({ enabled: false, port: 3001 });
    });

    it('reports every missing required variable at once', () => {
        expect(() => loadConfig({})).toThrow(ConfigError);
        try {
            loadConfig({});
        } catch (err) {
            expect((err as ConfigError).problems.map((p) => p.split(' ')[0])).toEqual(['TELEGRAM_BOT_TOKEN', 'CHANNEL_ID']);
        }
    });

    it('rejects numbers that would have become NaN or nonsense', () => {
        expect(problemsFor({ POLL_INTERVAL_SECONDS: '30s', MCP_PORT: '70000', PORT: '-1' })).toHaveLength(3);
        expect(problemsFor({ POLL_INTERVAL_SECONDS: '0' })[0]).toMatch(/POLL_INTERVAL_SECONDS must be an integer from 1/);
    });

    it('rejects booleans it cannot read instead of treating them as false', () => {
        expect(problemsFor({ FEED_CLAIMS: 'ture' })).toEqual(['FEED_CLAIMS must be true or false, got "ture"']);
        expect(loadConfig({ ...REQUIRED, FEED_GRADUATIONS: 'YES', REQUIRE_GITHUB: '0' })).toMatchObject({
            feed: { graduations: true },
            requireGithub: false,
        });
    });

    it('rejects an unknown log level', () => {
        expect(problemsFor({ LOG_LEVEL: 'verbose' })[0]).toMatch(/LOG_LEVEL must be one of/);
    });

    it('validates RPC URLs without echoing their API keys', () => {
        const problems = problemsFor({
            SOLANA_RPC_URL: 'ftp://rpc.example.com/?api-key=SECRET123',
            SOLANA_RPC_URLS: 'https://ok.example.com,not a url SECRET456',
            SOLANA_WS_URL: 'https://ws.example.com/SECRET789',
        });
        expect(problems).toHaveLength(3);
        expect(problems.join('\n')).not.toMatch(/SECRET/);
    });

    it('keeps the primary RPC first and drops duplicate fallbacks', () => {
        const config = loadConfig({
            ...REQUIRED,
            SOLANA_RPC_URL: 'https://a.example.com',
            SOLANA_RPC_URLS: 'https://b.example.com, https://a.example.com ,',
        });
        expect(config.solanaRpcUrls).toEqual(['https://a.example.com', 'https://b.example.com']);
    });

    it('lets HEALTH_PORT override PORT', () => {
        expect(loadConfig({ ...REQUIRED, PORT: '8080' }).healthPort).toBe(8080);
        expect(loadConfig({ ...REQUIRED, PORT: '8080', HEALTH_PORT: '9090' }).healthPort).toBe(9090);
    });

    it('uses the explicit WebSocket URL and marks it explicit', () => {
        const config = loadConfig({ ...REQUIRED, SOLANA_WS_URL: 'wss://ws.example.com' });
        expect(config.solanaWsUrl).toBe('wss://ws.example.com');
        expect(config.solanaWsUrlExplicit).toBe(true);
    });
});
