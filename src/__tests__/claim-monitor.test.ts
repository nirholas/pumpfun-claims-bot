/**
 * ClaimMonitor transaction processing against the web3.js 3 response shape:
 * slots, block times and balances arrive as bigints and must reach the
 * FeeClaimEvent as plain numbers.
 */

import { PublicKey } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelBotConfig } from '../config.js';
import type { FeeClaimEvent } from '../types.js';
import { PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID } from '../types.js';
import { ixData, key, programData, socialFeePdaClaimed } from './pump-event-bytes.js';

const rpcState: { tx: unknown } = { tx: null };

vi.mock('../logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../rpc-fallback.js', () => ({
    RpcFallback: class {
        size = 1;
        currentUrl = 'https://rpc.example';
        async withFallback<T>(fn: (conn: unknown) => Promise<T>): Promise<T> {
            return fn({
                getParsedTransaction: async () => rpcState.tx,
                getAccountInfo: async () => null,
                getProgramAccounts: async () => [],
            });
        }
    },
}));

const CONFIG: ChannelBotConfig = {
    telegramToken: 'test-token',
    channelId: '@test',
    solanaRpcUrl: 'https://rpc.example',
    solanaRpcUrls: ['https://rpc.example'],
    pollIntervalSeconds: 30,
    logLevel: 'info',
    feed: { claims: true, graduations: false, feeDistributions: false },
    requireGithub: false,
    affiliates: { axiom: '', gmgn: '', padre: '' },
    mcp: { enabled: false, port: 3001 },
};

const SIGNER = key(3);
const PDA = key(20);

function parsedTx(instructions: unknown[], logs: string[], balances: { pre: bigint; post: bigint }) {
    return {
        slot: 312_000_123n,
        blockTime: 1_790_000_500n,
        meta: {
            err: null,
            logMessages: logs,
            preBalances: [balances.pre],
            postBalances: [balances.post],
            innerInstructions: [],
        },
        transaction: {
            message: {
                accountKeys: [{ pubkey: new PublicKey(SIGNER), signer: true, writable: true }],
                instructions,
            },
        },
    };
}

async function processWith(tx: unknown): Promise<FeeClaimEvent[]> {
    rpcState.tx = tx;
    const { ClaimMonitor } = await import('../claim-monitor.js');
    const events: FeeClaimEvent[] = [];
    const monitor = new ClaimMonitor(CONFIG, (e) => { events.push(e); });
    await monitor['processTransaction']('sig111');
    return events;
}

describe('ClaimMonitor.processTransaction (web3.js 3 bigint fields)', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { rpcState.tx = null; });

    it('converts bigint slot and blockTime to numbers on a social fee claim', async () => {
        const event = socialFeePdaClaimed({
            userId: '1234567',
            socialFeePda: PDA,
            recipient: SIGNER,
            amountClaimed: 2_500_000_000n,
        }, false);
        const tx = parsedTx(
            [{ programId: new PublicKey(PUMP_FEE_PROGRAM_ID), data: ixData('e115fb85a11ec7e2'), accounts: [new PublicKey(SIGNER), new PublicKey(PDA)] }],
            [
                `Program ${PUMP_FEE_PROGRAM_ID} invoke [1]`,
                'Program log: Instruction: ClaimSocialFeePda',
                programData(event),
                `Program ${PUMP_FEE_PROGRAM_ID} success`,
            ],
            { pre: 5_000_000n, post: 2_505_000_000n },
        );

        const [claim] = await processWith(tx);

        expect(claim).toBeDefined();
        expect(claim!.slot).toBe(312_000_123);
        expect(typeof claim!.slot).toBe('number');
        expect(claim!.timestamp).toBe(1_790_000_500);
        expect(typeof claim!.timestamp).toBe('number');
        expect(claim!.amountLamports).toBe(2_500_000_000);
        expect(claim!.amountSol).toBe(2.5);
        expect(claim!.githubUserId).toBe('1234567');
        expect(claim!.socialFeePda).toBe(PDA);
    });

    it('reads a payout from bigint balances when the claim emitted no event', async () => {
        const tx = parsedTx(
            [{ programId: new PublicKey(PUMP_PROGRAM_ID), data: ixData('1416567bc61cdb84'), accounts: [new PublicKey(SIGNER)] }],
            [
                `Program ${PUMP_PROGRAM_ID} invoke [1]`,
                'Program log: Instruction: CollectCreatorFee',
                `Program ${PUMP_PROGRAM_ID} success`,
            ],
            { pre: 1_000_000_000n, post: 1_750_000_000n },
        );

        const [claim] = await processWith(tx);

        expect(claim).toBeDefined();
        expect(claim!.claimType).toBe('collect_creator_fee');
        expect(claim!.amountLamports).toBe(750_000_000);
        expect(claim!.amountSol).toBe(0.75);
    });
});
