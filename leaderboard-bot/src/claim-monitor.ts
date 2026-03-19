/**
 * PumpFun Leaderboard Bot — Social Fee Claim Monitor
 *
 * Watches the PumpFees program for `claim_social_fee_pda` instructions
 * and parses the SocialFeePdaClaimed CPI event to extract GitHub user ID
 * and SOL amount. Supports WebSocket (real-time) + polling (fallback).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    type Logs,
    type SignaturesForAddressOptions,
} from '@solana/web3.js';
import bs58 from 'bs58';

import type { LeaderboardConfig } from './config.js';
import { log } from './logger.js';
import { RpcFallback } from './rpc.js';
import {
    PUMP_FEE_PROGRAM_ID,
    SOCIAL_FEE_CLAIMED_DISC,
    CLAIM_SOCIAL_FEE_DISC,
    type SocialFeeClaimEvent,
} from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_QUEUE = 50;
const MIN_REQUEST_INTERVAL_MS = 1_000;
const WS_HEARTBEAT_MS = 60_000;
const WS_TIMEOUT_MS = 90_000;
const CURSOR_SAVE_DEBOUNCE_MS = 3_000;
const MAX_PROCESSED_CACHE = 10_000;

// ── Queue ─────────────────────────────────────────────────────────────────────

class TxQueue {
    private queue: string[] = [];
    private inFlight = 0;
    private processing = false;
    private lastRequest = 0;

    constructor(private processFn: (sig: string) => Promise<void>) {}

    enqueue(sig: string): void {
        if (this.queue.length >= MAX_QUEUE) return;
        this.queue.push(sig);
        void this.drain();
    }

    private async drain(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        while (this.queue.length > 0 && this.inFlight < 1) {
            const elapsed = Date.now() - this.lastRequest;
            if (elapsed < MIN_REQUEST_INTERVAL_MS) await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
            const sig = this.queue.shift();
            if (!sig) break;
            this.lastRequest = Date.now();
            this.inFlight++;
            this.processFn(sig)
                .catch((e) => log.debug('TX queue error: %s', e))
                .finally(() => { this.inFlight--; void this.drain(); });
        }
        this.processing = false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ── Monitor ───────────────────────────────────────────────────────────────────

export class ClaimMonitor {
    private rpc: RpcFallback;
    private wsConn?: Connection;
    private wsSubId?: number;
    private wsHeartbeat?: ReturnType<typeof setInterval>;
    private pollTimer?: ReturnType<typeof setTimeout>;
    private lastWsEvent = 0;
    private lastCursor: string | undefined;
    private cursorSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private processed = new Set<string>();
    private queue: TxQueue;
    private programPk = new PublicKey(PUMP_FEE_PROGRAM_ID);
    private isRunning = false;
    private claimsFound = 0;
    private startedAt = 0;
    private consecutive429s = 0;
    private readonly cursorFile: string;

    constructor(
        private config: LeaderboardConfig,
        private onClaim: (event: SocialFeeClaimEvent) => void,
    ) {
        this.rpc = new RpcFallback(config.solanaRpcUrls, {
            commitment: 'confirmed',
            disableRetryOnRateLimit: true,
        });
        this.queue = new TxQueue((sig) => this.processTransaction(sig));
        this.cursorFile = join(config.dataDir, 'poll-cursor.json');
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startedAt = Date.now();
        this.loadCursor();
        log.info('Claim monitor: watching %s', PUMP_FEE_PROGRAM_ID.slice(0, 8) + '…');

        if (this.config.solanaWsUrl) {
            try {
                await this.startWebSocket();
                log.info('Claim monitor: WebSocket mode');
                return;
            } catch (err) {
                log.warn('WebSocket failed, falling back to polling: %s', err);
            }
        }

        this.startPolling();
        log.info('Claim monitor: polling every %ds', this.config.pollIntervalSeconds);
    }

    stop(): void {
        this.isRunning = false;
        if (this.wsHeartbeat) { clearInterval(this.wsHeartbeat); this.wsHeartbeat = undefined; }
        if (this.wsConn && this.wsSubId !== undefined) {
            this.wsConn.removeOnLogsListener(this.wsSubId).catch(() => {});
            this.wsSubId = undefined;
        }
        if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = undefined; }
        log.info('Claim monitor stopped. Claims detected: %d, uptime: %ds',
            this.claimsFound, Math.floor((Date.now() - this.startedAt) / 1000));
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────

    private async startWebSocket(): Promise<void> {
        this.wsConn = new Connection(this.rpc.currentUrl, {
            commitment: 'confirmed',
            wsEndpoint: this.config.solanaWsUrl,
            disableRetryOnRateLimit: true,
        });
        this.lastWsEvent = Date.now();

        this.wsSubId = this.wsConn.onLogs(
            this.programPk,
            async (info: Logs) => {
                this.lastWsEvent = Date.now();
                try { await this.handleLogs(info); }
                catch (e) { log.error('WS log error: %s', e); }
            },
            'confirmed',
        );

        this.wsHeartbeat = setInterval(() => {
            if (!this.isRunning) return;
            const elapsed = Date.now() - this.lastWsEvent;
            if (elapsed > WS_TIMEOUT_MS) {
                log.warn('WS silent for %ds — reconnecting', Math.floor(elapsed / 1000));
                this.reconnectWebSocket();
            } else {
                log.info('WS heartbeat: %d claims detected (uptime %ds)',
                    this.claimsFound, Math.floor((Date.now() - this.startedAt) / 1000));
            }
        }, WS_HEARTBEAT_MS);
    }

    private reconnectWebSocket(): void {
        if (!this.isRunning) return;
        if (this.wsConn && this.wsSubId !== undefined) {
            this.wsConn.removeOnLogsListener(this.wsSubId).catch(() => {});
            this.wsSubId = undefined;
        }
        this.wsConn = undefined;
        this.startWebSocket().catch((err) => {
            log.warn('WS reconnect failed, switching to polling: %s', err);
            if (this.wsHeartbeat) { clearInterval(this.wsHeartbeat); this.wsHeartbeat = undefined; }
            this.startPolling();
        });
    }

    private async handleLogs(info: Logs): Promise<void> {
        const { signature, logs, err } = info;
        if (err) return;
        if (this.processed.has(signature)) return;
        this.processed.add(signature);
        this.trimProcessed();

        const hasSocialClaim = logs.some(
            (l) => l.includes('Program log: Instruction: ClaimSocialFeePda'),
        );
        if (hasSocialClaim) this.queue.enqueue(signature);
    }

    // ── Polling ───────────────────────────────────────────────────────────────

    private startPolling(): void {
        const poll = async () => {
            if (!this.isRunning) return;
            try {
                await this.pollProgram();
                this.consecutive429s = 0;
            } catch (err) {
                if (String(err).includes('429')) this.consecutive429s++;
                else log.error('Poll error: %s', err);
            }
            if (!this.isRunning) return;
            const backoff = Math.min(2 ** this.consecutive429s, 8);
            this.pollTimer = setTimeout(poll, this.config.pollIntervalSeconds * backoff * 1000);
        };
        void poll();
    }

    private async pollProgram(): Promise<void> {
        const opts: SignaturesForAddressOptions = { limit: 20 };
        if (this.lastCursor) opts.until = this.lastCursor;

        const sigs = await this.rpc.withFallback((c) =>
            c.getSignaturesForAddress(this.programPk, opts),
        );
        if (!sigs.length) return;

        this.lastCursor = sigs[0]!.signature;
        this.scheduleCursorSave();

        for (const s of sigs) {
            if (s.err || this.processed.has(s.signature)) continue;
            this.processed.add(s.signature);
            this.queue.enqueue(s.signature);
        }
        this.trimProcessed();
    }

    // ── Transaction Parsing ───────────────────────────────────────────────────

    private async processTransaction(signature: string): Promise<void> {
        try {
            const tx = await this.rpc.withFallback((c) =>
                c.getParsedTransaction(signature, {
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0,
                }),
            );
            if (!tx?.meta || tx.meta.err) return;

            const logs = tx.meta.logMessages ?? [];
            const hasClaim = logs.some(
                (l) => l.includes('Program log: Instruction: ClaimSocialFeePda'),
            );
            if (!hasClaim) return;

            const accountKeys = tx.transaction.message.accountKeys;
            const signerKey = accountKeys.find((a) => a.signer)?.pubkey?.toBase58();
            if (!signerKey) return;

            const timestamp = tx.blockTime ?? Math.floor(Date.now() / 1000);
            const event = this.parseClaimEvent(signature, tx.slot, timestamp, signerKey, logs, tx);
            if (event) {
                this.claimsFound++;
                this.onClaim(event);
            }
        } catch (err) {
            if (!String(err).includes('429')) {
                log.error('TX parse error %s: %s', signature.slice(0, 8), err);
            }
        }
    }

    private parseClaimEvent(
        txSignature: string,
        slot: number,
        timestamp: number,
        claimerWallet: string,
        logs: string[],
        tx: import('@solana/web3.js').ParsedTransactionWithMeta,
    ): SocialFeeClaimEvent | null {
        let githubUserId = '';
        let socialPlatform = 0;
        let socialFeePda: string | undefined;
        let amountLamports = 0;
        let lifetimeClaimedLamports: number | undefined;
        let isFake = false;

        // Parse SocialFeePdaClaimed event from CPI logs
        for (const line of logs) {
            if (!line.includes('Program data:')) continue;
            const b64 = line.split('Program data: ')[1]?.trim();
            if (!b64) continue;
            try {
                const bytes = Buffer.from(b64, 'base64');
                if (bytes.length < 8) continue;
                const disc = Buffer.from(bytes.subarray(0, 8)).toString('hex');
                if (disc !== SOCIAL_FEE_CLAIMED_DISC) continue;

                // Layout: disc(8) + timestamp(i64=8) + user_id(borsh string) + platform(u8)
                //         + social_fee_pda(32) + recipient(32) + authority(32) + amount(u64=8)
                //         + [lifetime(u64=8)] + [claimable_before(u64=8)]
                let offset = 16; // skip disc + timestamp

                // user_id: 4-byte LE length + UTF-8
                if (bytes.length >= offset + 4) {
                    const uidLen = bytes.readUInt32LE(offset);
                    offset += 4;
                    if (bytes.length >= offset + uidLen) {
                        githubUserId = bytes.subarray(offset, offset + uidLen).toString('utf8');
                        offset += uidLen;
                    }
                }
                // platform: u8
                if (bytes.length >= offset + 1) {
                    socialPlatform = bytes[offset]!;
                    offset += 1;
                }
                // social_fee_pda: pubkey(32)
                if (bytes.length >= offset + 32) {
                    socialFeePda = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
                    offset += 32;
                }
                // recipient: pubkey(32) — skip
                offset += 32;
                // authority: pubkey(32) — skip
                offset += 32;
                // amount_claimed: u64
                if (bytes.length >= offset + 8) {
                    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                    amountLamports = Number(view.getBigUint64(offset, true));
                    offset += 8;
                }
                // lifetime and claimable_before (two u64s, order varies by program version)
                // Real lifetime lamports are always < a unix timestamp (~1.74B for 2026)
                if (bytes.length >= offset + 16) {
                    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                    const a = Number(view.getBigUint64(offset, true));
                    const b = Number(view.getBigUint64(offset + 8, true));
                    lifetimeClaimedLamports = Math.min(a, b);
                } else if (bytes.length >= offset + 8) {
                    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                    lifetimeClaimedLamports = Number(view.getBigUint64(offset, true));
                }
            } catch { /* skip unparseable */ }
        }

        // Fake claim: instruction present but no event emitted (amountLamports = 0)
        if (amountLamports === 0) {
            isFake = true;
            // Try extracting user_id from the instruction data itself
            const ixs = tx.transaction.message.instructions;
            for (const ix of ixs) {
                if (!('data' in ix) || !ix.data) continue;
                if (ix.programId.toBase58() !== PUMP_FEE_PROGRAM_ID) continue;
                try {
                    const ixBytes = bs58.decode(ix.data);
                    const disc = Buffer.from(ixBytes.subarray(0, 8)).toString('hex');
                    if (disc !== CLAIM_SOCIAL_FEE_DISC) continue;
                    let offset = 8;
                    const uidLen = Buffer.from(ixBytes.subarray(offset, offset + 4)).readUInt32LE(0);
                    offset += 4;
                    if (uidLen > 0 && uidLen <= 20 && ixBytes.length >= offset + uidLen) {
                        githubUserId = Buffer.from(ixBytes.subarray(offset, offset + uidLen)).toString('utf8');
                        offset += uidLen;
                        if (ixBytes.length >= offset + 1) socialPlatform = ixBytes[offset]!;
                    }
                    if ('accounts' in ix && Array.isArray(ix.accounts) && ix.accounts.length >= 2) {
                        socialFeePda = ix.accounts[1]?.toBase58();
                    }
                } catch { /* ignore */ }
            }
        }

        if (!githubUserId) return null;
        if (!isFake && amountLamports < 1_000) return null;

        return {
            txSignature,
            slot,
            timestamp,
            claimerWallet,
            githubUserId,
            socialPlatform,
            amountSol: amountLamports / LAMPORTS_PER_SOL,
            amountLamports,
            lifetimeClaimedLamports,
            socialFeePda,
            isFake,
        };
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    private loadCursor(): void {
        try {
            if (!existsSync(this.cursorFile)) return;
            const raw = JSON.parse(readFileSync(this.cursorFile, 'utf8')) as Record<string, string>;
            this.lastCursor = raw.cursor;
            if (this.lastCursor) log.info('Claim monitor: resumed from cursor %s', this.lastCursor.slice(0, 12) + '…');
        } catch { /* ignore */ }
    }

    private scheduleCursorSave(): void {
        if (this.cursorSaveTimer) return;
        this.cursorSaveTimer = setTimeout(() => {
            this.cursorSaveTimer = null;
            if (!this.lastCursor) return;
            try {
                if (!existsSync(this.config.dataDir)) mkdirSync(this.config.dataDir, { recursive: true });
                writeFileSync(this.cursorFile, JSON.stringify({ cursor: this.lastCursor }), 'utf8');
            } catch (e) { log.warn('Failed to save cursor: %s', e); }
        }, CURSOR_SAVE_DEBOUNCE_MS);
    }

    private trimProcessed(): void {
        if (this.processed.size > MAX_PROCESSED_CACHE) {
            const arr = [...this.processed];
            this.processed = new Set(arr.slice(-5_000));
        }
    }
}
