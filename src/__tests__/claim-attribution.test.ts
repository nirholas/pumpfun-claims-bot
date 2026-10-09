/**
 * Claim attribution after the October 2026 upgrade: a claim transaction
 * usually carries a sweep (curve or pool to creator vault) first. Only the
 * claim (vault to creator) is a payout; a sweep-only transaction is not a
 * claim; and no payout is ever counted twice.
 */

import { describe, expect, it } from 'vitest';

import {
    claimFactsFromLogs,
    isFeeSweepInstruction,
    matchClaimInstruction,
    planClaims,
    splitLogsByTopLevelInstruction,
    type TopLevelInstruction,
} from '../claim-attribution.js';
import { CLAIM_INSTRUCTIONS, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID } from '../types.js';
import {
    BorshWriter,
    collectCoinCreatorFeeEvent,
    collectCreatorFeeEvent,
    distributeCreatorFeesEvent,
    ixData,
    key,
    programData,
    socialFeePdaClaimed,
    sweepBondingCurveFeeEvent,
    sweepPoolFeeEvent,
    USDC,
} from './pump-event-bytes.js';

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const CREATOR = key(3);
const VAULT = key(10);
const MINT = key(1);
const LAMPORTS = 1_000_000_000n;

const DISC = {
    sweepCreatorFee: '20f6bf3408c949ba',
    sweepProtocolFee: '0830be07b644b7e5',
    collectCreatorFee: '1416567bc61cdb84',
    collectCreatorFeeV2: 'cf118af204221338',
    collectCoinCreatorFee: 'a039592ab58b2b42',
    distributeV2: 'ffcb134ff444089f',
    claimSocialV2: '114df0863abc3595',
};

function invoke(programId: string, logLine: string, ...events: Buffer[]): string[] {
    return [
        `Program ${programId} invoke [1]`,
        `Program log: Instruction: ${logLine}`,
        ...events.map(programData),
        `Program ${programId} success`,
    ];
}

const computeIx: TopLevelInstruction = { programId: COMPUTE_BUDGET, data: '3QAwFKa3MJAs' };
const computeLogs = [`Program ${COMPUTE_BUDGET} invoke [1]`, `Program ${COMPUTE_BUDGET} success`];

describe('instruction tables', () => {
    it('lists the V2 claim paths and keeps sweeps out of the claim table', () => {
        const discs = new Set(CLAIM_INSTRUCTIONS.map((d) => d.discriminator));
        for (const d of ['cf118af204221338', 'ffcb134ff444089f', '01214eb921432c5c', '114df0863abc3595', '7af3cc415e741d37']) {
            expect(discs.has(d)).toBe(true);
        }
        expect(discs.has(DISC.sweepCreatorFee)).toBe(false);
        expect(discs.has(DISC.sweepProtocolFee)).toBe(false);
        expect(matchClaimInstruction(ixData(DISC.sweepCreatorFee), PUMP_PROGRAM_ID)).toBeUndefined();
        expect(isFeeSweepInstruction(ixData(DISC.sweepCreatorFee), PUMP_PROGRAM_ID)).toBe(true);
        expect(isFeeSweepInstruction(ixData(DISC.sweepCreatorFee), PUMP_AMM_PROGRAM_ID)).toBe(true);
        expect(isFeeSweepInstruction(ixData(DISC.sweepProtocolFee), PUMP_PROGRAM_ID)).toBe(true);
    });

    it('splits logs on top-level invokes only', () => {
        const logs = [
            ...computeLogs,
            ...invoke(PUMP_PROGRAM_ID, 'SweepCreatorFee'),
            `Program ${PUMP_PROGRAM_ID} invoke [2]`,
            `Program ${PUMP_PROGRAM_ID} success`,
        ];
        const segments = splitLogsByTopLevelInstruction(logs);
        expect(segments).toHaveLength(2);
        expect(segments[1]).toHaveLength(5);
    });
});

describe('planClaims', () => {
    it('counts the claim, not the sweep before it', () => {
        const instructions: TopLevelInstruction[] = [
            computeIx,
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.sweepCreatorFee) },
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.collectCreatorFeeV2), accounts: [CREATOR, VAULT, key(11), key(12), key(13)] },
        ];
        const logs = [
            ...computeLogs,
            ...invoke(PUMP_PROGRAM_ID, 'SweepCreatorFee', sweepBondingCurveFeeEvent(MINT, VAULT, 2n * LAMPORTS, 1)),
            ...invoke(PUMP_PROGRAM_ID, 'CollectCreatorFeeV2', collectCreatorFeeEvent(CREATOR, 5n * LAMPORTS, key(0))),
        ];
        const planned = planClaims(instructions, logs);
        expect(planned).toHaveLength(1);
        expect(planned[0]!.index).toBe(2);
        expect(planned[0]!.def.label).toBe('Collect Creator Fee V2 (Pump)');
        expect(planned[0]!.facts.amount).toBe(5n * LAMPORTS);
        expect(planned[0]!.facts.hasEvent).toBe(true);
        expect(planned[0]!.facts.quoteMint).toBeUndefined();
    });

    it('plans nothing for a sweep-only transaction', () => {
        const instructions: TopLevelInstruction[] = [
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.sweepCreatorFee) },
            { programId: PUMP_AMM_PROGRAM_ID, data: ixData(DISC.sweepCreatorFee) },
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.sweepProtocolFee) },
        ];
        const logs = [
            ...invoke(PUMP_PROGRAM_ID, 'SweepCreatorFee', sweepBondingCurveFeeEvent(MINT, VAULT, 2n * LAMPORTS, 1)),
            ...invoke(PUMP_AMM_PROGRAM_ID, 'SweepCreatorFee', sweepPoolFeeEvent(MINT, VAULT, 3n * LAMPORTS, 1)),
            ...invoke(PUMP_PROGRAM_ID, 'SweepProtocolFee', sweepBondingCurveFeeEvent(MINT, key(14), LAMPORTS, 0)),
        ];
        expect(planClaims(instructions, logs)).toEqual([]);
    });

    it('gives each claim in one transaction its own event', () => {
        const instructions: TopLevelInstruction[] = [
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.sweepCreatorFee) },
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.collectCreatorFee) },
            { programId: PUMP_AMM_PROGRAM_ID, data: ixData(DISC.sweepCreatorFee) },
            { programId: PUMP_AMM_PROGRAM_ID, data: ixData(DISC.collectCoinCreatorFee), accounts: [USDC, key(15)] },
        ];
        const logs = [
            ...invoke(PUMP_PROGRAM_ID, 'SweepCreatorFee', sweepBondingCurveFeeEvent(MINT, VAULT, LAMPORTS, 1)),
            ...invoke(PUMP_PROGRAM_ID, 'CollectCreatorFee', collectCreatorFeeEvent(CREATOR, 4n * LAMPORTS)),
            ...invoke(PUMP_AMM_PROGRAM_ID, 'SweepCreatorFee', sweepPoolFeeEvent(MINT, VAULT, 9_000_000n, 1)),
            ...invoke(PUMP_AMM_PROGRAM_ID, 'CollectCoinCreatorFee', collectCoinCreatorFeeEvent(CREATOR, 9_000_000n)),
        ];
        const planned = planClaims(instructions, logs);
        expect(planned.map((p) => p.facts.amount)).toEqual([4n * LAMPORTS, 9_000_000n]);
        expect(planned[1]!.facts.quoteMint).toBe(USDC);
        const total = planned.reduce((sum, p) => sum + p.facts.amount, 0n);
        expect(total).toBe(4n * LAMPORTS + 9_000_000n);
    });

    it('falls back to per-type ordinals when truncated logs cannot be split', () => {
        const instructions: TopLevelInstruction[] = [
            computeIx,
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.collectCreatorFee) },
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.collectCreatorFeeV2) },
        ];
        // The compute budget invoke line is missing, so segments do not line up.
        const logs = [
            ...invoke(PUMP_PROGRAM_ID, 'CollectCreatorFee', collectCreatorFeeEvent(CREATOR, LAMPORTS)),
            ...invoke(PUMP_PROGRAM_ID, 'CollectCreatorFeeV2', collectCreatorFeeEvent(CREATOR, 2n * LAMPORTS, key(0))),
        ];
        expect(planClaims(instructions, logs).map((p) => p.facts.amount)).toEqual([LAMPORTS, 2n * LAMPORTS]);
    });

    it('reads distribute_creator_fees_v2 mint and quote from the event', () => {
        const holders = [{ address: key(30), shareBps: 10_000 }];
        const instructions: TopLevelInstruction[] = [
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.sweepCreatorFee) },
            { programId: PUMP_PROGRAM_ID, data: ixData(DISC.distributeV2), accounts: [key(16), MINT, key(17)] },
        ];
        const logs = [
            ...invoke(PUMP_PROGRAM_ID, 'SweepCreatorFee', sweepBondingCurveFeeEvent(MINT, VAULT, 12_000_000n, 1)),
            ...invoke(PUMP_PROGRAM_ID, 'DistributeCreatorFeesV2', distributeCreatorFeesEvent(MINT, 12_000_000n, holders, USDC)),
        ];
        const [planned] = planClaims(instructions, logs);
        expect(planned!.facts.tokenMint).toBe(MINT);
        expect(planned!.facts.amount).toBe(12_000_000n);
        expect(planned!.facts.quoteMint).toBe(USDC);
    });

    it('takes the distribute_creator_fees_v2 mint from accounts[1] when no event was emitted', () => {
        const def = matchClaimInstruction(ixData(DISC.distributeV2), PUMP_PROGRAM_ID)!;
        const facts = claimFactsFromLogs(def, [], 0, { programId: PUMP_PROGRAM_ID, accounts: [key(16), MINT] });
        expect(facts).toEqual({ amount: 0n, hasEvent: false, tokenMint: MINT });
    });

    it('decodes a V2 social claim paid in USDC', () => {
        const args = new BorshWriter().str('1234567').u8(2).build();
        const instructions: TopLevelInstruction[] = [
            { programId: PUMP_FEE_PROGRAM_ID, data: ixData(DISC.claimSocialV2, args), accounts: [key(33), key(32), USDC] },
        ];
        const logs = invoke(PUMP_FEE_PROGRAM_ID, 'ClaimSocialFeePdaV2', socialFeePdaClaimed({
            userId: '1234567',
            socialFeePda: key(32),
            recipient: key(33),
            amountClaimed: 15_000_000n,
            quoteMint: USDC,
            lifetimeStableClaimed: 15_000_000n,
        }, true));
        const [planned] = planClaims(instructions, logs);
        expect(planned!.def.claimType).toBe('claim_social_fee_pda');
        expect(planned!.facts.amount).toBe(15_000_000n);
        expect(planned!.facts.quoteMint).toBe(USDC);
        expect(planned!.facts.social?.userId).toBe('1234567');
        expect(planned!.facts.social?.lifetimeStableClaimed).toBe(15_000_000n);
    });
});
