/**
 * Claim attribution: which top-level instructions of a transaction are fee
 * payouts, and which event pays each one.
 *
 * Since the October 2026 upgrade a claim transaction usually carries a sweep
 * first (sweep_creator_fee moves fees the curve or pool still holds into the
 * creator vault), then the claim (vault to creator). Only the claim is a payout.
 * A sweep is permissionless and pays nobody's wallet, so a sweep on its own is
 * never a claim, and its SweepBondingCurveFeeEvent / SweepPoolFeeEvent is never
 * counted as income. Each claim instruction is paid by exactly one event of its
 * own type, so two claims in one transaction are never counted twice.
 */

import bs58 from 'bs58';

import {
    decodeClaimCashbackEvent,
    decodeCollectCoinCreatorFeeEvent,
    decodeCollectCreatorFeeEvent,
    decodeDistributeCreatorFeesEvent,
    decodeSocialFeePdaClaimed,
    EVENT_DISCRIMINATORS,
    eventDiscriminator,
    isSolQuote,
    programDataPayloads,
    type SocialFeePdaClaimedData,
} from './pump-events.js';
import {
    CLAIM_INSTRUCTIONS,
    FEE_SWEEP_INSTRUCTIONS,
    type ClaimType,
    type InstructionDef,
} from './types.js';

/** A top-level instruction as the claim monitor sees it. */
export interface TopLevelInstruction {
    programId: string;
    /** Base58 instruction data; absent for instructions the RPC parsed (system, token, ...). */
    data?: string;
    /** Account keys, in instruction order. */
    accounts?: string[];
}

/** The payout facts one claim instruction's event carries. */
export interface ClaimFacts {
    /** Amount paid, in base units of the quote mint (lamports for SOL). 0n when no payout event was found. */
    amount: bigint;
    /** True when the instruction's own payout event was found. */
    hasEvent: boolean;
    tokenMint?: string;
    /** Non-SOL quote mint of the payout, when the event or instruction names one. */
    quoteMint?: string;
    /** Decoded SocialFeePdaClaimed, for social claims. */
    social?: SocialFeePdaClaimedData;
}

export interface PlannedClaim {
    /** Index of the instruction in the transaction's top-level instructions. */
    index: number;
    def: InstructionDef;
    instruction: TopLevelInstruction;
    facts: ClaimFacts;
}

/** The event that pays out each claim type. transfer_creator_fees_to_pump emits none. */
const PAYOUT_EVENT: Record<ClaimType, string | null> = {
    collect_creator_fee: EVENT_DISCRIMINATORS.CollectCreatorFeeEvent,
    collect_coin_creator_fee: EVENT_DISCRIMINATORS.CollectCoinCreatorFeeEvent,
    claim_cashback: EVENT_DISCRIMINATORS.ClaimCashbackEvent,
    distribute_creator_fees: EVENT_DISCRIMINATORS.DistributeCreatorFeesEvent,
    claim_social_fee_pda: EVENT_DISCRIMINATORS.SocialFeePdaClaimed,
    transfer_creator_fees_to_pump: null,
};

function instructionDiscriminator(data: string): string | null {
    try {
        const bytes = bs58.decode(data);
        return bytes.length >= 8 ? Buffer.from(bytes.subarray(0, 8)).toString('hex') : null;
    } catch {
        return null;
    }
}

/** The claim definition for an instruction, or undefined when it is not a payout. */
export function matchClaimInstruction(data: string, programId: string): InstructionDef | undefined {
    const disc = instructionDiscriminator(data);
    if (!disc) return undefined;
    return CLAIM_INSTRUCTIONS.find((def) => def.discriminator === disc && def.programId === programId);
}

/** True for sweep_creator_fee / sweep_protocol_fee on Pump or PumpSwap. */
export function isFeeSweepInstruction(data: string, programId: string): boolean {
    const disc = instructionDiscriminator(data);
    if (!disc) return false;
    return FEE_SWEEP_INSTRUCTIONS.some((def) => def.discriminator === disc && def.programId === programId);
}

/**
 * Split a transaction's logs into one slice per top-level instruction. Every
 * top-level instruction opens with "Program <id> invoke [1]", so the slices line
 * up with the instruction list unless the RPC truncated the logs.
 */
export function splitLogsByTopLevelInstruction(logs: readonly string[]): string[][] {
    const segments: string[][] = [];
    for (const line of logs) {
        if (/^Program \S+ invoke \[1\]$/.test(line)) {
            segments.push([line]);
        } else if (segments.length > 0) {
            segments[segments.length - 1]!.push(line);
        }
    }
    return segments;
}

/**
 * Read the payout of one claim instruction from logs. `ordinal` picks the n-th
 * payout event of the instruction's own type, for when the logs could not be
 * split per instruction. Sweep events and other claim types' events are skipped.
 */
export function claimFactsFromLogs(
    def: InstructionDef,
    logs: readonly string[],
    ordinal = 0,
    instruction?: TopLevelInstruction,
): ClaimFacts {
    const facts: ClaimFacts = { amount: 0n, hasEvent: false };
    const accounts = instruction?.accounts ?? [];
    if (def.mintAccountIndex !== undefined) facts.tokenMint = accounts[def.mintAccountIndex];
    if (def.quoteMintAccountIndex !== undefined) {
        const quote = accounts[def.quoteMintAccountIndex];
        if (quote && !isSolQuote(quote)) facts.quoteMint = quote;
    }

    const wanted = PAYOUT_EVENT[def.claimType];
    if (!wanted) return facts;

    let seen = 0;
    for (const bytes of programDataPayloads(logs)) {
        if (eventDiscriminator(bytes) !== wanted) continue;
        const candidate: ClaimFacts = { ...facts };
        if (!applyPayoutEvent(def.claimType, bytes, candidate)) continue;
        if (seen++ === ordinal) return { ...candidate, hasEvent: true };
    }
    return facts;
}

/** A quote mint the event itself carries overrides the instruction's account. Older events carry none. */
function applyEventQuote(facts: ClaimFacts, quoteMint: string | undefined): void {
    if (quoteMint === undefined) return;
    facts.quoteMint = isSolQuote(quoteMint) ? undefined : quoteMint;
}

/** Decode one payout event into `facts`. Returns false when the bytes do not decode. */
function applyPayoutEvent(claimType: ClaimType, bytes: Buffer, facts: ClaimFacts): boolean {
    switch (claimType) {
        case 'collect_creator_fee': {
            const ev = decodeCollectCreatorFeeEvent(bytes);
            if (!ev) return false;
            facts.amount = ev.creatorFee;
            applyEventQuote(facts, ev.quoteMint);
            return true;
        }
        case 'collect_coin_creator_fee': {
            const ev = decodeCollectCoinCreatorFeeEvent(bytes);
            if (!ev) return false;
            facts.amount = ev.coinCreatorFee;
            return true;
        }
        case 'claim_cashback': {
            const ev = decodeClaimCashbackEvent(bytes);
            if (!ev) return false;
            facts.amount = ev.amount;
            return true;
        }
        case 'distribute_creator_fees': {
            const ev = decodeDistributeCreatorFeesEvent(bytes);
            if (!ev) return false;
            facts.amount = ev.distributed;
            facts.tokenMint = ev.mint;
            applyEventQuote(facts, ev.quoteMint);
            return true;
        }
        case 'claim_social_fee_pda': {
            const ev = decodeSocialFeePdaClaimed(bytes);
            if (!ev) return false;
            facts.amount = ev.amountClaimed;
            facts.social = ev;
            applyEventQuote(facts, ev.quoteMint);
            return true;
        }
        case 'transfer_creator_fees_to_pump':
            return false;
    }
}

/**
 * Every payout in a transaction, in instruction order, each with its own event.
 * Sweeps and every other instruction are skipped, so a sweep-only transaction
 * returns an empty list.
 */
export function planClaims(instructions: readonly TopLevelInstruction[], logs: readonly string[]): PlannedClaim[] {
    const segments = splitLogsByTopLevelInstruction(logs);
    const aligned = segments.length === instructions.length;
    const ordinals = new Map<ClaimType, number>();
    const out: PlannedClaim[] = [];

    instructions.forEach((instruction, index) => {
        if (!instruction.data) return;
        const def = matchClaimInstruction(instruction.data, instruction.programId);
        if (!def) return;
        const ordinal = ordinals.get(def.claimType) ?? 0;
        ordinals.set(def.claimType, ordinal + 1);
        const facts = aligned
            ? claimFactsFromLogs(def, segments[index]!, 0, instruction)
            : claimFactsFromLogs(def, logs, ordinal, instruction);
        out.push({ index, def, instruction, facts });
    });
    return out;
}
