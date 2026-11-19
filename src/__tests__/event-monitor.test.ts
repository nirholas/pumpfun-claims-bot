/**
 * EventMonitor (graduations) in polling mode, against a stubbed RPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelBotConfig } from '../config.js';
import type { GraduationEvent } from '../types.js';
import { PUMP_PROGRAM_ID } from '../types.js';
import { completeEvent, key, programData } from './pump-event-bytes.js';

const rpcState: { signatures: Array<{ signature: string; err: null }>; logsBySignature: Map<string, string[]> } = {
    signatures: [],
    logsBySignature: new Map(),
};

vi.mock('../logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../rpc-fallback.js', () => ({
    RpcFallback: class {
        currentUrl = 'https://rpc.example';
        async withFallback<T>(fn: (conn: unknown) => Promise<T>): Promise<T> {
            return fn({
                getSignaturesForAddress: async () => rpcState.signatures,
                getParsedTransaction: async (signature: string) => ({
                    blockTime: 1_790_000_000n,
                    meta: { err: null, logMessages: rpcState.logsBySignature.get(signature) ?? [] },
                }),
            });
        }
    },
}));

const CONFIG = {
    telegramToken: 'test-token',
    channelId: '@test',
    solanaRpcUrl: 'https://rpc.example',
    solanaRpcUrls: ['https://rpc.example'],
    pollIntervalSeconds: 3600,
    logLevel: 'info',
    feed: { claims: false, launches: false, graduations: true, whales: false, feeDistributions: false },
    requireGithub: true,
    whaleThresholdSol: 10,
    affiliates: { axiom: '', gmgn: '', padre: '' },
    mcp: { enabled: false, port: 3001 },
} satisfies ChannelBotConfig;

function graduationLogs(mint: string): string[] {
    return [
        `Program ${PUMP_PROGRAM_ID} invoke [1]`,
        'Program log: Instruction: Buy',
        programData(completeEvent(key(5), mint, key(6), true)),
        `Program ${PUMP_PROGRAM_ID} success`,
    ];
}

describe('EventMonitor polling', () => {
    beforeEach(() => {
        vi.resetModules();
        rpcState.signatures = [];
        rpcState.logsBySignature = new Map();
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('emits graduations found by polling', async () => {
        const mint = key(1);
        rpcState.signatures = [{ signature: 'sigA', err: null }];
        rpcState.logsBySignature.set('sigA', graduationLogs(mint));
        const { EventMonitor } = await import('../event-monitor.js');
        const seen: GraduationEvent[] = [];
        const monitor = new EventMonitor(CONFIG, () => {}, (e) => { seen.push(e); }, () => {}, () => {});

        await monitor.start();
        await vi.waitFor(() => expect(seen).toHaveLength(1));
        monitor.stop();

        expect(seen[0]!.mintAddress).toBe(mint);
        expect(seen[0]!.txSignature).toBe('sigA');
        expect(seen[0]!.isMigration).toBe(false);
    });
});
