/**
 * PumpFun Channel Bot — Graduation Monitor
 *
 * Watches the Pump program for graduations: CompleteEvent when the curve
 * completes (since synthetic migration this fires inside the completing buy)
 * and CompletePumpAmmMigrationEvent when migrate later opens the PumpSwap pool.
 * Each mint is reported once, whichever of the two events arrives first.
 *
 * Events are decoded from "Program data:" log lines by src/pump-events.ts.
 * Two modes: WebSocket (real-time) or HTTP polling (fallback).
 */

import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    type Logs,
    type SignaturesForAddressOptions,
} from '@solana/web3.js';

import { BoundedSet } from './bounded.js';
import type { ChannelBotConfig } from './config.js';
import { log } from './logger.js';
import {
    decodeCompleteEvent,
    decodeMigrationEvent,
    EVENT_DISCRIMINATORS,
    eventDiscriminator,
    programDataPayloads,
} from './pump-events.js';
import { RpcFallback } from './rpc-fallback.js';
import type { GraduationEvent } from './types.js';
import { PUMP_PROGRAM_ID } from './types.js';

const WS_HEARTBEAT_INTERVAL_MS = 60_000;
const WS_HEARTBEAT_TIMEOUT_MS = 90_000;
const MAX_PROCESSED_SIGNATURES = 10_000;
/** Mints already reported; far more than graduate in a day. */
const MAX_GRADUATED_MINTS = 20_000;

export class EventMonitor {
    private rpc: RpcFallback;
    private wsConnection?: Connection;
    private config: ChannelBotConfig;
    private programPubkey: PublicKey;
    private onGraduation: (event: GraduationEvent) => void;

    private pollTimer?: ReturnType<typeof setTimeout>;
    private wsSubscriptionId?: number;
    private lastSignature: string | undefined;
    private processedSignatures = new BoundedSet<string>(MAX_PROCESSED_SIGNATURES);
    private graduatedMints = new BoundedSet<string>(MAX_GRADUATED_MINTS);
    private stopped = false;
    private isRunning = false;
    private lastWsEventTime = 0;
    private wsHeartbeatTimer?: ReturnType<typeof setInterval>;

    constructor(config: ChannelBotConfig, onGraduation: (event: GraduationEvent) => void) {
        this.config = config;
        this.onGraduation = onGraduation;
        this.rpc = new RpcFallback(config.solanaRpcUrls, {
            commitment: 'confirmed',
        });
        if (config.solanaRpcUrls.length > 1) {
            log.info('Event monitor: %d RPC endpoints configured (fallback enabled)', config.solanaRpcUrls.length);
        }
        this.programPubkey = new PublicKey(PUMP_PROGRAM_ID);
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        if (this.config.solanaWsUrl && this.config.solanaWsUrlExplicit) {
            try {
                await this.startWebSocket();
                log.info('Event monitor: WebSocket mode');
                return;
            } catch (err) {
                log.warn('Event monitor WS failed, falling back to polling: %s', err);
            }
        }

        this.startPolling();
        log.info('Event monitor: polling mode (every %ds)', this.config.pollIntervalSeconds);
    }

    stop(): void {
        this.stopped = true;
        this.isRunning = false;
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
            this.wsHeartbeatTimer = undefined;
        }
        if (this.wsConnection && this.wsSubscriptionId !== undefined) {
            this.wsConnection.removeOnLogsListener(this.wsSubscriptionId).catch(() => {});
        }
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    // ── WebSocket ────────────────────────────────────────────────────

    private async startWebSocket(): Promise<void> {
        this.wsConnection = new Connection(this.rpc.currentUrl, {
            commitment: 'confirmed',
            wsEndpoint: this.config.solanaWsUrl,
        });

        this.lastWsEventTime = Date.now();

        this.wsSubscriptionId = this.wsConnection.onLogs(
            this.programPubkey,
            (logInfo: Logs) => {
                this.lastWsEventTime = Date.now();
                try { this.handleLogEvent(logInfo); }
                catch (err) { log.error('Event log error: %s', err); }
            },
            'confirmed',
        );

        // Heartbeat: if no event received for too long, reconnect
        this.wsHeartbeatTimer = setInterval(() => {
            if (this.stopped) return;
            const elapsed = Date.now() - this.lastWsEventTime;
            if (elapsed > WS_HEARTBEAT_TIMEOUT_MS) {
                log.warn('Event monitor WS silent for %ds — reconnecting...', Math.floor(elapsed / 1000));
                this.reconnectWebSocket();
            }
        }, WS_HEARTBEAT_INTERVAL_MS);
    }

    private reconnectWebSocket(): void {
        if (this.stopped) return;
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
            this.wsHeartbeatTimer = undefined;
        }
        if (this.wsConnection && this.wsSubscriptionId !== undefined) {
            this.wsConnection.removeOnLogsListener(this.wsSubscriptionId).catch(() => {});
        }
        this.wsSubscriptionId = undefined;
        this.wsConnection = undefined;

        this.startWebSocket().catch((err) => {
            log.warn('Event monitor WS reconnect failed, falling back to polling: %s', err);
            if (this.wsHeartbeatTimer) {
                clearInterval(this.wsHeartbeatTimer);
                this.wsHeartbeatTimer = undefined;
            }
            this.startPolling();
        });
    }

    /** Decode the graduation events in one transaction's logs. */
    handleLogEvent(logInfo: Logs, blockTime?: number | null): void {
        const { signature, logs: logLines, err } = logInfo;
        if (err) return;
        if (!this.processedSignatures.add(signature)) return;

        for (const bytes of programDataPayloads(logLines)) {
            const disc = eventDiscriminator(bytes);
            if (disc === EVENT_DISCRIMINATORS.CompleteEvent || disc === EVENT_DISCRIMINATORS.CompletePumpAmmMigrationEvent) {
                try {
                    this.decodeGraduation(bytes, signature, blockTime);
                } catch (decodeErr) {
                    log.debug('Malformed graduation event in %s: %s', signature.slice(0, 8), decodeErr);
                }
            }
        }
    }

    // ── Polling ──────────────────────────────────────────────────────

    private startPolling(): void {
        const poll = async () => {
            if (this.stopped) return;
            try {
                const opts: SignaturesForAddressOptions = { limit: 20 };
                if (this.lastSignature) opts.until = this.lastSignature;

                const sigs = await this.rpc.withFallback((conn) => conn.getSignaturesForAddress(this.programPubkey, opts));
                if (sigs.length > 0) this.lastSignature = sigs[0]!.signature;

                for (const sigInfo of sigs) {
                    if (sigInfo.err) continue;
                    if (this.processedSignatures.has(sigInfo.signature)) continue;
                    await this.fetchAndProcessLogs(sigInfo.signature);
                }
            } catch (err) {
                log.error('Event poll error: %s', err);
            }

            if (!this.stopped) {
                this.pollTimer = setTimeout(poll, this.config.pollIntervalSeconds * 1000);
            }
        };
        void poll();
    }

    private async fetchAndProcessLogs(signature: string): Promise<void> {
        try {
            const tx = await this.rpc.withFallback((conn) => conn.getParsedTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            }));
            if (!tx?.meta || tx.meta.err) return;

            this.handleLogEvent({
                signature,
                logs: tx.meta.logMessages ?? [],
                err: null,
            }, tx.blockTime == null ? null : Number(tx.blockTime));
        } catch (err) {
            log.debug('Failed to fetch tx %s: %s', signature.slice(0, 8), err);
        }
    }

    // ── Decoders ─────────────────────────────────────────────────────

    private decodeGraduation(bytes: Buffer, signature: string, blockTime?: number | null): void {
        const fallbackTime = blockTime ?? Math.floor(Date.now() / 1000);
        const migration = decodeMigrationEvent(bytes);
        if (migration) {
            this.emitGraduation({
                txSignature: signature,
                slot: 0,
                timestamp: migration.timestamp || fallbackTime,
                mintAddress: migration.mint,
                user: migration.user,
                bondingCurve: migration.bondingCurve,
                isMigration: true,
                solAmount: Number(migration.solAmount) / LAMPORTS_PER_SOL,
                mintAmount: Number(migration.mintAmount),
                poolMigrationFee: Number(migration.poolMigrationFee) / LAMPORTS_PER_SOL,
                poolAddress: migration.pool,
            });
            return;
        }
        const complete = decodeCompleteEvent(bytes);
        if (!complete) return;
        this.emitGraduation({
            txSignature: signature,
            slot: 0,
            timestamp: complete.timestamp ?? fallbackTime,
            mintAddress: complete.mint,
            user: complete.user,
            bondingCurve: complete.bondingCurve,
            isMigration: false,
        });
    }

    /** A curve completes once and migrates once: report the mint the first time only. */
    private emitGraduation(event: GraduationEvent): void {
        if (!this.graduatedMints.add(event.mintAddress)) {
            log.debug('Graduation for %s already reported', event.mintAddress.slice(0, 8));
            return;
        }
        this.onGraduation(event);
    }
}
