/**
 * PumpFun Channel Bot — Solana Fee Claim Monitor
 *
 * Monitors both Pump and PumpSwap programs for fee claim transactions.
 * Two modes: WebSocket (real-time) or HTTP polling (fallback).
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

import type { ChannelBotConfig } from './config.js';
import { log } from './logger.js';
import { RpcFallback } from './rpc-fallback.js';
import {
    SocialFeeIndex,
    CREATE_FEE_SHARING_CONFIG_EVENT_DISC,
    UPDATE_FEE_SHARES_EVENT_DISC,
} from './social-fee-index.js';
import { planClaims, type PlannedClaim, type TopLevelInstruction } from './claim-attribution.js';
import type { FeeClaimEvent, ClaimType } from './types.js';
import {
    PUMP_PROGRAM_ID,
    PUMP_AMM_PROGRAM_ID,
    PUMP_FEE_PROGRAM_ID,
} from './types.js';

// ============================================================================
// Rate limiter
// ============================================================================

const MAX_CONCURRENCY = 1;
const MIN_REQUEST_INTERVAL_MS = 1_000;
const MAX_QUEUE_SIZE = 50;
const RATE_LIMIT_LOG_WINDOW_MS = 30_000;
const WS_HEARTBEAT_INTERVAL_MS = 60_000;
const WS_HEARTBEAT_TIMEOUT_MS = 90_000;
// After this many heartbeat reconnects with zero new events, abandon the
// WebSocket and fall back to polling (the pump programs are always active, so
// sustained silence means the socket is dead, not the feed quiet).
const WS_MAX_SILENT_RECONNECTS = 3;
// GitHub-only mode never falls back to polling (the PumpFees firehose can't be
// polled), so a failed WS reconnect is retried on this backoff instead.
const WS_RETRY_BACKOFF_MS = 15_000;

// Persistence for poll cursor (survives restarts so already-seen txs aren't re-processed)
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const LAST_SIGNATURES_FILE = join(DATA_DIR, 'last-signatures.json');
const LAST_SIG_SAVE_DEBOUNCE_MS = 3_000;

class RpcQueue {
    private queue: string[] = [];
    private inFlight = 0;
    private processing = false;
    private lastRequestTime = 0;
    private last429LogTime = 0;
    private dropped429Count = 0;
    private processFn: (sig: string) => Promise<void>;

    constructor(processFn: (sig: string) => Promise<void>) {
        this.processFn = processFn;
    }

    enqueue(signature: string): boolean {
        if (this.queue.length >= MAX_QUEUE_SIZE) return false;
        this.queue.push(signature);
        this.drain();
        return true;
    }

    note429(): void {
        this.dropped429Count++;
        const now = Date.now();
        if (now - this.last429LogTime >= RATE_LIMIT_LOG_WINDOW_MS) {
            log.warn('RPC 429 — %d in last %ds', this.dropped429Count, RATE_LIMIT_LOG_WINDOW_MS / 1000);
            this.dropped429Count = 0;
            this.last429LogTime = now;
        }
    }

    private async drain(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        while (this.queue.length > 0 && this.inFlight < MAX_CONCURRENCY) {
            const elapsed = Date.now() - this.lastRequestTime;
            if (elapsed < MIN_REQUEST_INTERVAL_MS) {
                await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
            }
            const sig = this.queue.shift();
            if (!sig) break;
            this.lastRequestTime = Date.now();
            this.inFlight++;
            this.processFn(sig)
                .catch((err) => { log.debug('RPC queue item failed: %s', err); })
                .finally(() => { this.inFlight--; this.drain(); });
        }
        this.processing = false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

// ============================================================================
// Monitor
// ============================================================================

export class ClaimMonitor {
    private rpc: RpcFallback;
    private wsConnection?: Connection;
    private config: ChannelBotConfig;
    private onClaim: (event: FeeClaimEvent) => void;
    private pollTimer?: ReturnType<typeof setInterval>;
    private wsSubscriptionIds: number[] = [];
    private lastSignatures = new Map<string, string | undefined>();
    private programPubkeys: PublicKey[];
    private processedSignatures = new Set<string>();
    private readonly MAX_PROCESSED_CACHE = 10_000;
    private rpcQueue: RpcQueue;
    private consecutive429s = 0;
    private isRunning = false;
    private startedAt = 0;
    private claimsDetected = 0;
    private lastWsEventTime = 0;
    private wsHeartbeatTimer?: ReturnType<typeof setInterval>;
    private wsEventsReceived = 0;
    // Silent-reconnect guard: a dead-but-connected WS (e.g. a silently
    // rate-limited endpoint) never throws, so the heartbeat would reconnect it
    // forever. Count reconnects that produced zero new events and give up to
    // polling after WS_MAX_SILENT_RECONNECTS.
    private wsEventsAtLastReconnect = 0;
    private wsSilentReconnects = 0;
    private claimTxProcessed = 0;
    private claimsByType = new Map<string, number>();
    private socialFeeIndex = new SocialFeeIndex();
    private lastSigSaveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(config: ChannelBotConfig, onClaim: (event: FeeClaimEvent) => void) {
        this.config = config;
        this.onClaim = onClaim;
        this.rpc = new RpcFallback(config.solanaRpcUrls, {
            commitment: 'confirmed',
            disableRetryOnRateLimit: true,
        });
        if (config.solanaRpcUrls.length > 1) {
            log.info('Claim monitor: %d RPC endpoints configured (fallback enabled)', config.solanaRpcUrls.length);
        }
        // GitHub social-fee claims (claim_social_fee_pda) live ONLY on the PumpFees
        // program. On a GitHub-only channel (REQUIRE_GITHUB, the default) that is the
        // only program worth watching — Pump and PumpAMM carry creator/coin-creator
        // fee claims that are suppressed anyway, and subscribing to those two
        // firehoses (~100 tx/s each) is what drowns the RPC in getTransaction calls
        // and 429s, starving the rare social claim we actually care about. Watch all
        // three only when creator-fee claims are also being posted.
        this.programPubkeys = config.requireGithub
            ? [new PublicKey(PUMP_FEE_PROGRAM_ID)]
            : [
                  new PublicKey(PUMP_FEE_PROGRAM_ID),
                  new PublicKey(PUMP_PROGRAM_ID),
                  new PublicKey(PUMP_AMM_PROGRAM_ID),
              ];
        this.rpcQueue = new RpcQueue((sig) => this.processTransaction(sig));
    }

    /**
     * Returns true if the given social fee PDA has any CLAIM transactions BEFORE
     * the specified signature. Used to verify that a claim with lifetime==amount
     * on-chain is genuinely the first-ever claim on this PDA.
     *
     * Only counts transactions containing the ClaimSocialFeePda instruction —
     * ignores PDA setup transactions (CreateFeeSharingConfig, UpdateFeeShares)
     * which touch the PDA but are not claims.
     */
    async pdaHasPriorTransactions(pdaAddress: string, beforeSig: string): Promise<boolean> {
        try {
            const pubkey = new PublicKey(pdaAddress);
            const sigs = await this.rpc.withFallback((conn) =>
                conn.getSignaturesForAddress(pubkey, { limit: 5, before: beforeSig }),
            );
            if (sigs.length === 0) return false;

            for (const sigInfo of sigs) {
                if (sigInfo.err) continue;
                const tx = await this.rpc.withFallback((conn) =>
                    conn.getTransaction(sigInfo.signature, {
                        maxSupportedTransactionVersion: 0,
                        commitment: 'confirmed',
                    }),
                );
                if (!tx?.meta?.logMessages) continue;
                if (tx.meta.logMessages.some((l) => l.includes('Instruction: ClaimSocialFeePda'))) {
                    return true;
                }
            }
            return false;
        } catch (err) {
            // On RPC error, err on the side of caution — do NOT post
            log.warn('pdaHasPriorTransactions: RPC error for %s: %s', pdaAddress.slice(0, 8), err);
            return true;
        }
    }

    /**
     * Returns true if the given recipient wallet has prior ClaimSocialFeePda
     * transactions on any token's PDA — not just the current one.
     * This catches the cross-PDA case where a GitHub user already claimed fees
     * on one token but the current event is for a different (fresh) token PDA.
     * Fetches the last few transactions for the wallet and checks log messages
     * for the ClaimSocialFeePda instruction marker.
     * On RPC error, returns false (don't block posting — other guards exist).
     */
    async walletHasPriorSocialFeeClaims(recipientWallet: string, beforeSig: string): Promise<boolean> {
        try {
            const walletPubkey = new PublicKey(recipientWallet);
            const sigs = await this.rpc.withFallback((conn) =>
                conn.getSignaturesForAddress(walletPubkey, { limit: 50, before: beforeSig }),
            );
            if (sigs.length === 0) return false;

            for (const sigInfo of sigs) {
                const tx = await this.rpc.withFallback((conn) =>
                    conn.getTransaction(sigInfo.signature, {
                        maxSupportedTransactionVersion: 0,
                        commitment: 'confirmed',
                    }),
                );
                if (!tx?.meta?.logMessages) continue;
                if (tx.meta.logMessages.some((l) => l.includes('Instruction: ClaimSocialFeePda'))) {
                    return true;
                }
            }
            return false;
        } catch (err) {
            log.warn('walletHasPriorSocialFeeClaims: RPC error for %s: %s', recipientWallet.slice(0, 8), err);
            return false;
        }
    }

    /**
     * Returns true if the given PDA address has ANY transactions at all.
     * Used to check whether a user has claimed from a different PDA (different token)
     * in a prior session, when local persistence was lost but we still know about
     * their other PDA addresses from persisted github-user-pdas.json.
     */
    async pdaHasAnyTransactions(pdaAddress: string): Promise<boolean> {
        try {
            const pubkey = new PublicKey(pdaAddress);
            const sigs = await this.rpc.withFallback((conn) =>
                conn.getSignaturesForAddress(pubkey, { limit: 1 }),
            );
            return sigs.length > 0;
        } catch (err) {
            log.warn('pdaHasAnyTransactions: RPC error for %s: %s', pdaAddress.slice(0, 8), err);
            return true; // conservative — do NOT post if we can't verify
        }
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startedAt = Date.now();

        log.info('Claim monitor: monitoring %d programs', this.programPubkeys.length);

        // Load persisted poll cursors so we don't re-process already-seen transactions
        // on restart (which would cause duplicate "FIRST CLAIM" posts after redeploy).
        this.loadLastSignatures();

        // Bootstrap social fee index from on-chain SharingConfig accounts (non-blocking)
        this.socialFeeIndex.bootstrap(this.rpc).catch((err: unknown) => {
            log.warn('SocialFeeIndex bootstrap error: %s', err);
        });

        // A GitHub-only channel MUST use the WebSocket: the PumpFees program is a
        // ~100 tx/s firehose of mostly cashback claims, and polling it with
        // getTransaction-per-signature can't keep up (429 storm) and drops the rare
        // social claim we exist to catch. WS pushes the log lines, so we only fetch
        // the full transaction when `ClaimSocialFeePda` actually appears. Use the
        // derived wss endpoint even without an explicit SOLANA_WS_URL here — for this
        // mode WS is not optional. Non-GitHub (creator-inclusive) mode still requires
        // the explicit opt-in because that path fans out to more programs.
        const preferWebSocket =
            !!this.config.solanaWsUrl && (this.config.requireGithub || !!process.env.SOLANA_WS_URL);
        if (preferWebSocket) {
            try {
                await this.startWebSocket();
                log.info('Claim monitor: WebSocket mode');
                return;
            } catch (err) {
                log.warn('WS failed, falling back to polling:', err);
            }
        }

        this.startPolling();
        log.info('Claim monitor: polling mode (every %ds)', this.config.pollIntervalSeconds);
    }

    stop(): void {
        this.isRunning = false;
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
            this.wsHeartbeatTimer = undefined;
        }
        if (this.wsConnection) {
            for (const id of this.wsSubscriptionIds) {
                this.wsConnection.removeOnLogsListener(id).catch(() => {});
            }
            this.wsSubscriptionIds = [];
        }
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
        log.info('Claim monitor stopped');
    }

    getMetrics(): Record<string, unknown> {
        return {
            claimsDetected: this.claimsDetected,
            processedSignatures: this.processedSignatures.size,
            mode: this.wsSubscriptionIds.length > 0 ? 'websocket' : 'polling',
            rpcEndpoints: this.rpc.size,
            activeRpc: maskRpcUrl(this.rpc.currentUrl),
            uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
        };
    }

    // ── WebSocket ────────────────────────────────────────────────────

    private async startWebSocket(): Promise<void> {
        this.wsConnection = new Connection(this.rpc.currentUrl, {
            commitment: 'confirmed',
            wsEndpoint: this.config.solanaWsUrl,
            disableRetryOnRateLimit: true,
        });

        this.lastWsEventTime = Date.now();

        for (const pubkey of this.programPubkeys) {
            const subId = this.wsConnection.onLogs(
                pubkey,
                async (logInfo: Logs) => {
                    this.lastWsEventTime = Date.now();
                    this.wsEventsReceived++;
                    try { await this.handleLogEvent(logInfo); }
                    catch (err) { log.error('Log event error:', err); }
                },
                'confirmed',
            );
            this.wsSubscriptionIds.push(subId);
        }

        // Heartbeat: if no event for too long, reconnect
        this.wsHeartbeatTimer = setInterval(() => {
            if (!this.isRunning) return;
            const elapsed = Date.now() - this.lastWsEventTime;
            if (elapsed > WS_HEARTBEAT_TIMEOUT_MS) {
                log.warn('Claim monitor WS silent for %ds — reconnecting...', Math.floor(elapsed / 1000));
                this.reconnectWebSocket();
            } else {
                const typeBreakdown = [...this.claimsByType.entries()]
                    .map(([type, count]) => `${type}=${count}`).join(', ');
                log.info('WS heartbeat: %d events, %d claims queued, %d detected [%s] (uptime %s)',
                    this.wsEventsReceived, this.claimTxProcessed, this.claimsDetected,
                    typeBreakdown || 'none',
                    formatUptime(Date.now() - this.startedAt));
            }
        }, WS_HEARTBEAT_INTERVAL_MS);
    }

    private reconnectWebSocket(): void {
        if (!this.isRunning) return;

        // Track whether the last cycle produced any events. A dead-but-connected
        // socket never throws (startWebSocket resolves fine), so without this the
        // heartbeat would reconnect it forever and never fall back.
        if (this.wsEventsReceived === this.wsEventsAtLastReconnect) this.wsSilentReconnects++;
        else this.wsSilentReconnects = 0;
        this.wsEventsAtLastReconnect = this.wsEventsReceived;

        // Clean up old connection
        if (this.wsConnection) {
            for (const id of this.wsSubscriptionIds) {
                this.wsConnection.removeOnLogsListener(id).catch(() => {});
            }
            this.wsSubscriptionIds = [];
        }
        this.wsConnection = undefined;

        // Dead WS across repeated reconnects. Creator-inclusive mode falls back to
        // polling; GitHub-only mode cannot (polling the PumpFees firehose can't catch
        // social claims and just 429-storms), so it keeps retrying the WebSocket.
        if (this.wsSilentReconnects >= WS_MAX_SILENT_RECONNECTS) {
            if (this.config.requireGithub) {
                log.warn('Claim monitor WS silent across %d reconnects — retrying WS (polling cannot catch social claims)',
                    this.wsSilentReconnects);
                this.wsSilentReconnects = 0;
            } else {
                log.warn('Claim monitor WS dead across %d reconnects (0 events) — falling back to polling',
                    this.wsSilentReconnects);
                if (this.wsHeartbeatTimer) {
                    clearInterval(this.wsHeartbeatTimer);
                    this.wsHeartbeatTimer = undefined;
                }
                this.startPolling();
                return;
            }
        }

        this.startWebSocket().catch((err) => {
            if (this.config.requireGithub) {
                // No polling fallback for a GitHub-only channel — schedule another WS
                // attempt (the heartbeat may not be armed if startWebSocket failed early).
                log.warn('Claim monitor WS reconnect failed: %s — retrying WS in %ds', err,
                    Math.floor(WS_RETRY_BACKOFF_MS / 1000));
                setTimeout(() => { if (this.isRunning) this.reconnectWebSocket(); }, WS_RETRY_BACKOFF_MS);
                return;
            }
            log.warn('Claim monitor WS reconnect failed, falling back to polling: %s', err);
            if (this.wsHeartbeatTimer) {
                clearInterval(this.wsHeartbeatTimer);
                this.wsHeartbeatTimer = undefined;
            }
            this.startPolling();
        });
    }

    private async handleLogEvent(logInfo: Logs): Promise<void> {
        const { signature, logs, err } = logInfo;
        if (err) return;
        if (this.processedSignatures.has(signature)) return;
        this.processedSignatures.add(signature);
        this.trimProcessedCache();

        // Scan all log lines for relevant events.
        // NOTE: claim_social_fee_pda does NOT emit a CPI event — it returns a
        // SocialFeePdaClaimed struct. Detect it via Anchor's instruction log line
        // instead of a "Program data:" discriminator.
        let hasClaimIx = false;

        for (const line of logs) {
            // Detect claim_social_fee_pda via Anchor instruction log
            if (!hasClaimIx && line.includes('Program log: Instruction: ClaimSocialFeePda')) {
                hasClaimIx = true;
            }

            if (!line.includes('Program data:')) continue;
            const b64 = line.split('Program data: ')[1]?.trim();
            if (!b64) continue;
            try {
                const bytes = Buffer.from(b64, 'base64');
                if (bytes.length < 8) continue;
                const disc = Buffer.from(bytes.subarray(0, 8)).toString('hex');

                if (disc === CREATE_FEE_SHARING_CONFIG_EVENT_DISC) {
                    this.socialFeeIndex.updateFromCreateEvent(bytes);
                } else if (disc === UPDATE_FEE_SHARES_EVENT_DISC) {
                    this.socialFeeIndex.updateFromUpdateSharesEvent(bytes);
                }
            } catch { /* ignore unparseable */ }
        }

        if (hasClaimIx) {
            this.claimTxProcessed++;
            this.rpcQueue.enqueue(signature);
        }
    }

    // ── Polling ──────────────────────────────────────────────────────

    private startPolling(): void {
        const poll = async () => {
            if (!this.isRunning) return;
            try {
                await this.pollAllPrograms();
                this.consecutive429s = 0;
            } catch (err) {
                const msg = String(err);
                if (msg.includes('429')) {
                    this.consecutive429s++;
                    this.rpcQueue.note429();
                } else {
                    log.error('Poll error:', err);
                }
            }
            if (this.isRunning) {
                const backoff = Math.min(
                    2 ** this.consecutive429s,
                    8,
                );
                const delay = this.config.pollIntervalSeconds * backoff * 1000;
                this.pollTimer = setTimeout(poll, delay);
            }
        };
        poll();
    }

    private async pollAllPrograms(): Promise<void> {
        let updated = false;
        for (const pubkey of this.programPubkeys) {
            const programId = pubkey.toBase58();
            const opts: SignaturesForAddressOptions = { limit: 20 };
            const lastSig = this.lastSignatures.get(programId);
            if (lastSig) opts.until = lastSig;

            const sigs = await this.rpc.withFallback((conn) => conn.getSignaturesForAddress(pubkey, opts));
            if (sigs.length === 0) continue;

            this.lastSignatures.set(programId, sigs[0]!.signature);
            updated = true;

            for (const sigInfo of sigs) {
                if (sigInfo.err) continue;
                if (this.processedSignatures.has(sigInfo.signature)) continue;
                this.processedSignatures.add(sigInfo.signature);
                this.rpcQueue.enqueue(sigInfo.signature);
            }
        }
        this.trimProcessedCache();
        if (updated) this.scheduleLastSignaturesSave();
    }

    /** Load the persisted poll cursors from disk. */
    private loadLastSignatures(): void {
        try {
            if (!existsSync(LAST_SIGNATURES_FILE)) return;
            const raw = readFileSync(LAST_SIGNATURES_FILE, 'utf8');
            const data: unknown = JSON.parse(raw);
            if (data && typeof data === 'object') {
                for (const [k, v] of Object.entries(data)) {
                    if (typeof v === 'string') this.lastSignatures.set(k, v);
                }
                log.info('Claim monitor: loaded %d persisted poll cursors', this.lastSignatures.size);
            }
        } catch (err) {
            log.warn('Claim monitor: failed to load poll cursors: %s', err);
        }
    }

    /** Persist the current poll cursors to disk (debounced). */
    private scheduleLastSignaturesSave(): void {
        if (this.lastSigSaveTimer) return;
        this.lastSigSaveTimer = setTimeout(() => {
            this.lastSigSaveTimer = null;
            try {
                if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
                const obj: Record<string, string> = {};
                for (const [k, v] of this.lastSignatures) {
                    if (v) obj[k] = v;
                }
                writeFileSync(LAST_SIGNATURES_FILE, JSON.stringify(obj), 'utf8');
            } catch (err) {
                log.warn('Claim monitor: failed to save poll cursors: %s', err);
            }
        }, LAST_SIG_SAVE_DEBOUNCE_MS);
    }

    // ── Transaction Processing ───────────────────────────────────────

    private async processTransaction(signature: string): Promise<void> {
        try {
            const tx = await this.rpc.withFallback((conn) => conn.getParsedTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            }));
            if (!tx?.meta || tx.meta.err) return;

            const timestamp = tx.blockTime ?? Math.floor(Date.now() / 1000);
            const slot = tx.slot;

            // One payout per claim instruction, each read from its own event.
            // Sweeps (curve or pool to creator vault) are never claims and never
            // income, so a sweep-only transaction plans nothing.
            const instructions: TopLevelInstruction[] = tx.transaction.message.instructions.map((ix) => ({
                programId: ix.programId.toBase58(),
                data: 'data' in ix ? ix.data : undefined,
                accounts: 'accounts' in ix ? ix.accounts.map((a) => a.toBase58()) : undefined,
            }));
            for (const planned of planClaims(instructions, tx.meta.logMessages ?? [])) {
                const event = this.buildClaimEvent(signature, slot, timestamp, tx, planned);
                if (event) {
                    // On-demand mint resolution: when the SocialFeeIndex didn't
                    // have this PDA at claim time (e.g. token created before bot
                    // started and bootstrap is disabled), try to fetch ALL mints
                    // from the RPC so multi-candidate disambiguation can run.
                    if (event.claimType === 'claim_social_fee_pda' && !event.tokenMint && event.socialFeePda) {
                        await this.socialFeeIndex.resolveFromChain(event.socialFeePda, this.rpc);
                        // resolveFromChain may have added multiple mints — re-read all candidates
                        const allCandidates = this.socialFeeIndex.lookupAll(event.socialFeePda);
                        if (allCandidates.length === 1) {
                            event.tokenMint = allCandidates[0]!;
                            log.info('SocialFeeIndex: on-demand resolved mint %s for PDA %s',
                                allCandidates[0]!.slice(0, 8), event.socialFeePda.slice(0, 8));
                        } else if (allCandidates.length > 1) {
                            event.allCandidateMints = allCandidates;
                            event.tokenMint = allCandidates[0]!;
                            log.info('SocialFeeIndex: on-demand resolved %d mints for PDA %s — pipeline will disambiguate',
                                allCandidates.length, event.socialFeePda.slice(0, 8));
                        } else {
                            log.warn('SocialFeeIndex: could not resolve mint for PDA %s — claim will post without CA',
                                event.socialFeePda.slice(0, 8));
                        }
                    }
                    this.claimsDetected++;
                    const typeCount = (this.claimsByType.get(event.claimType) ?? 0) + 1;
                    this.claimsByType.set(event.claimType, typeCount);
                    this.onClaim(event);
                }
            }
        } catch (err) {
            const msg = String(err);
            if (msg.includes('429')) {
                this.rpcQueue.note429();
            } else {
                log.error('TX processing error %s: %s', signature.slice(0, 8), err);
            }
        }
    }

    private buildClaimEvent(
        signature: string,
        slot: number,
        timestamp: number,
        tx: import('@solana/web3.js').ParsedTransactionWithMeta,
        planned: PlannedClaim,
    ): FeeClaimEvent | null {
        const { def, instruction: ix, facts } = planned;
        const accountKeys = tx.transaction.message.accountKeys;
        const signerKey = accountKeys.find((a) => a.signer)?.pubkey?.toBase58();
        if (!signerKey) return null;

        // distribute_creator_fees names its mint (V1 accounts[0], V2 accounts[1]);
        // collect_creator_fee, claim_cashback and collect_coin_creator_fee are
        // wallet-level claims with no mint; claim_social_fee_pda resolves its
        // mint through the SocialFeeIndex below.
        let tokenMint = facts.tokenMint ?? '';
        const social = facts.social;
        let githubUserId = social?.userId;
        let socialPlatform = social?.platform;
        const recipientWallet = social?.recipient;
        let socialFeePda = social?.socialFeePda;
        const quoteMint = facts.quoteMint;
        // Lifetime in the claim's own currency, so it compares with amountLamports.
        const lifetime = quoteMint ? social?.lifetimeStableClaimed : social?.lifetimeClaimed;
        const lifetimeClaimedLamports = lifetime !== undefined ? Number(lifetime) : undefined;

        let amountLamports = Number(facts.amount);

        // Fallback for claims that emitted no payout event: SOL balance change
        if (amountLamports === 0 && !facts.hasEvent && !quoteMint) {
            const preBalances = tx.meta?.preBalances ?? [];
            const postBalances = tx.meta?.postBalances ?? [];
            const signerIdx = accountKeys.findIndex(
                (a) => a.pubkey.toBase58() === signerKey,
            );
            if (signerIdx >= 0 && signerIdx < preBalances.length) {
                const diff = (postBalances[signerIdx] ?? 0) - (preBalances[signerIdx] ?? 0);
                if (diff > 0) amountLamports = diff;
            }
        }

        // If still no amount, try inner SOL transfers to the signer
        if (amountLamports === 0 && !facts.hasEvent && !quoteMint) {
            const innerIxs = tx.meta?.innerInstructions ?? [];
            for (const inner of innerIxs) {
                for (const innerIx of inner.instructions) {
                    if (
                        'parsed' in innerIx &&
                        innerIx.parsed?.type === 'transfer' &&
                        innerIx.parsed?.info?.destination === signerKey
                    ) {
                        amountLamports = Number(innerIx.parsed.info.lamports ?? 0);
                    }
                }
            }
        }

        // Detect fake claims: claim_social_fee_pda was called but no
        // SocialFeePdaClaimed event was emitted (amount stays 0).
        // Parse user_id and platform from the instruction arguments instead.
        let isFake = false;
        if (def.claimType === 'claim_social_fee_pda' && amountLamports === 0) {
            isFake = true;
            // Try to extract user_id & platform from instruction args
            // Anchor ix data: disc(8) + user_id(borsh string: 4-byte len + N) + platform(u8)
            if (ix.data && !githubUserId) {
                try {
                    const ixBytes = bs58.decode(ix.data);
                    if (ixBytes.length > 12) {
                        let offset = 8; // skip discriminator
                        const uidLen = Buffer.from(ixBytes.subarray(offset, offset + 4)).readUInt32LE(0);
                        offset += 4;
                        if (uidLen > 0 && uidLen <= 20 && ixBytes.length >= offset + uidLen) {
                            githubUserId = Buffer.from(ixBytes.subarray(offset, offset + uidLen)).toString('utf8');
                            offset += uidLen;
                        }
                        if (ixBytes.length >= offset + 1) {
                            socialPlatform = ixBytes[offset];
                        }
                    }
                } catch { /* ignore parse errors */ }
            }
            // social_fee_pda is accounts[1] in both claim_social_fee_pda and _v2
            if (ix.accounts && ix.accounts.length >= 2 && !socialFeePda) {
                socialFeePda = ix.accounts[1];
            }
        }

        // Skip non-social dust amounts (real social claims always emit event data)
        if (!isFake && amountLamports < 1000) return null;

        // For social fee PDA claims, resolve mint from the index.
        // When multiple tokens share the same PDA (scam vector), return all
        // candidates so the caller can disambiguate by market cap.
        let allCandidateMints: string[] | undefined;
        if (def.claimType === 'claim_social_fee_pda' && socialFeePda && !tokenMint) {
            const candidates = this.socialFeeIndex.lookupAll(socialFeePda);
            if (candidates.length === 1) {
                tokenMint = candidates[0]!;
            } else if (candidates.length > 1) {
                allCandidateMints = candidates;
                // Use first as fallback; caller should disambiguate
                tokenMint = candidates[0]!;
            }
        }

        return {
            txSignature: signature,
            slot,
            timestamp,
            claimerWallet: signerKey,
            tokenMint,
            amountSol: quoteMint ? 0 : amountLamports / LAMPORTS_PER_SOL,
            amountLamports,
            claimType: def.claimType,
            isCashback: !def.isCreatorClaim,
            programId: def.programId,
            claimLabel: def.label,
            githubUserId,
            socialPlatform,
            recipientWallet,
            socialFeePda,
            isFake,
            lifetimeClaimedLamports,
            allCandidateMints,
            quoteMint,
        };
    }

    private trimProcessedCache(): void {
        if (this.processedSignatures.size > this.MAX_PROCESSED_CACHE) {
            // Keep the most recent entries (Sets are insertion-ordered in JS)
            const arr = [...this.processedSignatures];
            this.processedSignatures = new Set(arr.slice(-5_000));
        }
    }
}

function maskRpcUrl(url: string): string {
    try {
        const u = new URL(url);
        return u.hostname;
    } catch {
        return url.slice(0, 30);
    }
}

