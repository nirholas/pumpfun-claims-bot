/**
 * Tests for RpcFallback — multi-endpoint RPC manager.
 *
 * Tests maskUrl (pure), endpoint rotation logic, and withFallback retry behaviour.
 * Uses a fake Connection-like object to avoid real Solana network calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { RpcFallback, maskUrl } from '../rpc-fallback.js';

// ── maskUrl ──────────────────────────────────────────────────────────────────

describe('maskUrl', () => {
    it('returns only the hostname for a plain URL', () => {
        expect(maskUrl('https://api.mainnet-beta.solana.com')).toBe('api.mainnet-beta.solana.com');
    });

    it('truncates long path-based API keys', () => {
        const url = 'https://rpc.helius.xyz/abcdefghijklmnopqrstuvwxyz0123456789';
        const result = maskUrl(url);
        expect(result).toContain('rpc.helius.xyz');
        expect(result).toContain('…');
        expect(result.length).toBeLessThan(url.length);
    });

    it('handles URLs with no path gracefully', () => {
        const result = maskUrl('https://mainnet.rpc.example.com');
        expect(result).toBe('mainnet.rpc.example.com');
    });

    it('handles non-URL strings without throwing', () => {
        const result = maskUrl('not-a-valid-url');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('masks query-param API keys (shows only hostname)', () => {
        const url = 'https://solana-mainnet.g.alchemy.com/v2/secretkey123';
        const result = maskUrl(url);
        expect(result).toContain('solana-mainnet.g.alchemy.com');
        expect(result).not.toContain('secretkey');
    });
});

// ── RpcFallback construction ─────────────────────────────────────────────────

describe('RpcFallback constructor', () => {
    it('throws when constructed with no URLs', () => {
        expect(() => new RpcFallback([])).toThrow();
    });

    it('reports the correct number of endpoints', () => {
        const rpc = new RpcFallback(['https://rpc1.example.com', 'https://rpc2.example.com']);
        expect(rpc.size).toBe(2);
    });

    it('starts on the first URL', () => {
        const rpc = new RpcFallback(['https://rpc1.example.com', 'https://rpc2.example.com']);
        expect(rpc.currentUrl).toBe('https://rpc1.example.com');
    });
});

// ── reportSuccess / reportFailure ────────────────────────────────────────────

describe('RpcFallback failure tracking', () => {
    it('does not rotate after fewer than 3 failures', () => {
        const rpc = new RpcFallback([
            'https://rpc1.example.com',
            'https://rpc2.example.com',
        ]);
        rpc.reportFailure(); // 1
        rpc.reportFailure(); // 2
        expect(rpc.currentUrl).toBe('https://rpc1.example.com');
    });

    it('rotates to the next endpoint after MAX_CONSECUTIVE_FAILS (3)', () => {
        const rpc = new RpcFallback([
            'https://rpc1.example.com',
            'https://rpc2.example.com',
        ]);
        rpc.reportFailure();
        rpc.reportFailure();
        const rotated = rpc.reportFailure(); // 3rd failure triggers rotation
        expect(rotated).toBe(true);
        expect(rpc.currentUrl).toBe('https://rpc2.example.com');
    });

    it('does not rotate with only one endpoint configured', () => {
        const rpc = new RpcFallback(['https://rpc1.example.com']);
        rpc.reportFailure();
        rpc.reportFailure();
        const rotated = rpc.reportFailure();
        expect(rotated).toBe(false);
        expect(rpc.currentUrl).toBe('https://rpc1.example.com');
    });

    it('resets fail count after reportSuccess', () => {
        const rpc = new RpcFallback([
            'https://rpc1.example.com',
            'https://rpc2.example.com',
        ]);
        rpc.reportFailure();
        rpc.reportFailure();
        rpc.reportSuccess(); // resets count
        rpc.reportFailure(); // back to 1
        rpc.reportFailure(); // 2
        // Should NOT have rotated yet (only 2 failures since reset)
        expect(rpc.currentUrl).toBe('https://rpc1.example.com');
    });
});

// ── withFallback ─────────────────────────────────────────────────────────────

describe('RpcFallback.withFallback', () => {
    it('returns result on first successful call', async () => {
        const rpc = new RpcFallback(['https://rpc1.example.com']);
        const result = await rpc.withFallback(async () => 42);
        expect(result).toBe(42);
    });

    it('falls back to second endpoint on retryable error', async () => {
        const rpc = new RpcFallback([
            'https://rpc1.example.com',
            'https://rpc2.example.com',
        ]);

        let attempt = 0;
        const result = await rpc.withFallback(async () => {
            attempt++;
            if (attempt === 1) throw new Error('429 Too Many Requests');
            return 'success';
        });

        expect(result).toBe('success');
        expect(attempt).toBe(2);
    });

    it('throws after exhausting all endpoints', async () => {
        const rpc = new RpcFallback([
            'https://rpc1.example.com',
            'https://rpc2.example.com',
        ]);

        await expect(
            rpc.withFallback(async () => { throw new Error('503 Service Unavailable'); }),
        ).rejects.toThrow();
    });

    it('does not retry on non-retryable errors', async () => {
        const rpc = new RpcFallback([
            'https://rpc1.example.com',
            'https://rpc2.example.com',
        ]);

        let callCount = 0;
        await expect(
            rpc.withFallback(async () => {
                callCount++;
                throw new Error('Invalid account data');
            }),
        ).rejects.toThrow('Invalid account data');

        // Non-retryable error: only called once, no fallback attempt
        expect(callCount).toBe(1);
    });

    it('passes the Connection object to the callback', async () => {
        const rpc = new RpcFallback(['https://api.mainnet-beta.solana.com']);
        let receivedConn: unknown;
        await rpc.withFallback(async (conn) => {
            receivedConn = conn;
            return null;
        });
        expect(receivedConn).toBeDefined();
        expect(typeof receivedConn).toBe('object');
    });
});
