/**
 * PumpFun Leaderboard Bot — RPC Connection Manager with Fallback
 */

import { Connection, type ConnectionConfig } from '@solana/web3.js';
import { log } from './logger.js';

const MAX_FAILS = 3;
const COOLDOWN_MS = 60_000;

export class RpcFallback {
    private readonly urls: string[];
    private index = 0;
    private connections = new Map<number, Connection>();
    private failCounts = new Map<number, number>();
    private cooldowns = new Map<number, number>();
    private readonly cfg: ConnectionConfig;

    constructor(urls: string[], cfg: ConnectionConfig = { commitment: 'confirmed' }) {
        if (!urls.length) throw new Error('At least one RPC URL required');
        this.urls = [...urls];
        this.cfg = cfg;
    }

    get size(): number { return this.urls.length; }
    get currentUrl(): string { return this.urls[this.index]!; }

    getConnection(): Connection {
        let conn = this.connections.get(this.index);
        if (!conn) {
            conn = new Connection(this.urls[this.index]!, this.cfg);
            this.connections.set(this.index, conn);
        }
        return conn;
    }

    private reportSuccess(): void { this.failCounts.set(this.index, 0); }

    private reportFailure(): void {
        const count = (this.failCounts.get(this.index) ?? 0) + 1;
        this.failCounts.set(this.index, count);
        if (count >= MAX_FAILS && this.urls.length > 1) {
            this.cooldowns.set(this.index, Date.now() + COOLDOWN_MS);
            this.rotate();
        }
    }

    private rotate(): void {
        const prev = this.index;
        const now = Date.now();
        for (let i = 1; i < this.urls.length; i++) {
            const c = (this.index + i) % this.urls.length;
            if (now >= (this.cooldowns.get(c) ?? 0)) { this.index = c; break; }
        }
        if (this.index === prev && this.urls.length > 1) {
            let earliest = Infinity, best = (prev + 1) % this.urls.length;
            for (let i = 0; i < this.urls.length; i++) {
                if (i === prev) continue;
                const u = this.cooldowns.get(i) ?? 0;
                if (u < earliest) { earliest = u; best = i; }
            }
            this.index = best;
        }
        if (this.index !== prev) {
            log.warn('RPC fallback: %s → %s', maskUrl(this.urls[prev]!), maskUrl(this.urls[this.index]!));
        }
    }

    async withFallback<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
        let lastErr: unknown;
        for (let attempt = 0; attempt < this.urls.length; attempt++) {
            try {
                const result = await fn(this.getConnection());
                this.reportSuccess();
                return result;
            } catch (err) {
                lastErr = err;
                const msg = String(err);
                const retryable = msg.includes('429') || msg.includes('502') ||
                    msg.includes('503') || msg.includes('504') ||
                    msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') ||
                    msg.includes('ECONNRESET') || msg.includes('fetch failed');
                if (retryable && attempt < this.urls.length - 1) {
                    log.warn('RPC failed on %s, trying next endpoint', maskUrl(this.currentUrl));
                    this.reportFailure();
                    continue;
                }
                if (retryable) this.reportFailure();
                throw err;
            }
        }
        throw lastErr;
    }
}

export function maskUrl(url: string): string {
    try {
        const u = new URL(url);
        return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 10) + '…' : '');
    } catch { return url.slice(0, 30); }
}
