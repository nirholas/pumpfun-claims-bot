/**
 * Pump, PumpSwap and PumpFees event decoders.
 *
 * Every decoder reads one Anchor event from a "Program data:" log line (8-byte
 * event discriminator, then the Borsh body) using the field order of the
 * October 2026 IDLs. The programs only ever append fields to an event, so each
 * decoder requires the oldest prefix it needs, reads a newer trailing group only
 * when its bytes are present, and ignores anything past the last field it knows.
 * None of them requires an exact length: an older, shorter event and a newer,
 * longer one both decode.
 */

import bs58 from 'bs58';

import { WSOL_MINT } from './types.js';

// ============================================================================
// Discriminators (sha256("event:<Name>")[0..8], as listed in the IDLs)
// ============================================================================

export const EVENT_DISCRIMINATORS = {
    /** Pump */
    CompleteEvent: '5f72619cd42e9808',
    CompletePumpAmmMigrationEvent: 'bde95db95c94ea94',
    DistributeCreatorFeesEvent: 'a537817004b3ca28',
    CollectCreatorFeeEvent: '7a027f010ebf0caf',
    /** Pump and PumpSwap emit the same ClaimCashbackEvent layout. */
    ClaimCashbackEvent: 'e2d6f62107f293e5',
    /** PumpSwap */
    CollectCoinCreatorFeeEvent: 'e8f5c2eeeada3a59',
    /** PumpFees */
    SocialFeePdaClaimed: '3212c141edd2eaec',
} as const;

/** The all-zero key. V2+ events write it as the quote mint of a SOL coin. */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/** True when a quote mint means SOL: absent (pre-V2 event), wrapped SOL, or the zero key. */
export function isSolQuote(quoteMint: string | undefined): boolean {
    return quoteMint === undefined || quoteMint === WSOL_MINT || quoteMint === SYSTEM_PROGRAM_ID;
}

/** Shareholder vectors are bounded on chain; anything larger is not a real event. */
const MAX_SHAREHOLDERS = 100;
/** Borsh strings in these events are social user ids. */
const MAX_STRING_BYTES = 1_000;

// ============================================================================
// Reader
// ============================================================================

class BorshReader {
    offset: number;

    constructor(private readonly buf: Buffer, offset = 8) {
        this.offset = offset;
    }

    has(bytes: number): boolean {
        return this.offset + bytes <= this.buf.length;
    }

    u8(): number {
        const v = this.buf.readUInt8(this.offset);
        this.offset += 1;
        return v;
    }

    u16(): number {
        const v = this.buf.readUInt16LE(this.offset);
        this.offset += 2;
        return v;
    }

    u32(): number {
        const v = this.buf.readUInt32LE(this.offset);
        this.offset += 4;
        return v;
    }

    u64(): bigint {
        const v = this.buf.readBigUInt64LE(this.offset);
        this.offset += 8;
        return v;
    }

    i64(): number {
        const v = Number(this.buf.readBigInt64LE(this.offset));
        this.offset += 8;
        return v;
    }

    pubkey(): string {
        const v = bs58.encode(this.buf.subarray(this.offset, this.offset + 32));
        this.offset += 32;
        return v;
    }

    /** A Borsh string, or null when its length prefix runs past the buffer. */
    string(): string | null {
        if (!this.has(4)) return null;
        const len = this.buf.readUInt32LE(this.offset);
        if (len > MAX_STRING_BYTES || !this.has(4 + len)) return null;
        this.offset += 4;
        const v = this.buf.subarray(this.offset, this.offset + len).toString('utf8');
        this.offset += len;
        return v;
    }

    /** A Vec<Shareholder { address: Pubkey, share_bps: u16 }>, or null when it does not fit. */
    shareholders(): Array<{ address: string; shareBps: number }> | null {
        if (!this.has(4)) return null;
        const count = this.buf.readUInt32LE(this.offset);
        if (count > MAX_SHAREHOLDERS || !this.has(4 + count * 34)) return null;
        this.offset += 4;
        const out: Array<{ address: string; shareBps: number }> = [];
        for (let i = 0; i < count; i++) {
            const address = this.pubkey();
            const shareBps = this.u16();
            out.push({ address, shareBps });
        }
        return out;
    }
}

/** Hex event discriminator of a decoded "Program data:" payload, or null. */
export function eventDiscriminator(bytes: Buffer): string | null {
    return bytes.length >= 8 ? bytes.subarray(0, 8).toString('hex') : null;
}

/** Every "Program data:" payload in a log list, in order. */
export function programDataPayloads(logs: readonly string[]): Buffer[] {
    const out: Buffer[] = [];
    for (const line of logs) {
        const idx = line.indexOf('Program data: ');
        if (idx === -1) continue;
        const b64 = line.slice(idx + 'Program data: '.length).trim();
        if (!b64) continue;
        const bytes = Buffer.from(b64, 'base64');
        if (bytes.length >= 8) out.push(bytes);
    }
    return out;
}

// ============================================================================
// Pump: CompleteEvent, CompletePumpAmmMigrationEvent
// ============================================================================

export interface CompleteEventData {
    user: string;
    mint: string;
    bondingCurve: string;
    timestamp?: number;
    quoteMint?: string;
}

/**
 * The curve is complete. Since synthetic migration this fires inside the
 * completing buy itself, before any migrate transaction exists.
 */
export function decodeCompleteEvent(bytes: Buffer): CompleteEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.CompleteEvent) return null;
    const r = new BorshReader(bytes);
    if (!r.has(32 * 3)) return null;
    const out: CompleteEventData = { user: r.pubkey(), mint: r.pubkey(), bondingCurve: r.pubkey() };
    if (!r.has(8)) return out;
    out.timestamp = r.i64();
    if (!r.has(32)) return out;
    out.quoteMint = r.pubkey();
    return out;
}

export interface MigrationEventData {
    user: string;
    mint: string;
    mintAmount: bigint;
    solAmount: bigint;
    poolMigrationFee: bigint;
    bondingCurve: string;
    timestamp: number;
    pool: string;
    quoteMint?: string;
}

export function decodeMigrationEvent(bytes: Buffer): MigrationEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.CompletePumpAmmMigrationEvent) return null;
    const r = new BorshReader(bytes);
    if (!r.has(32 + 32 + 8 * 3 + 32 + 8 + 32)) return null;
    const out: MigrationEventData = {
        user: r.pubkey(),
        mint: r.pubkey(),
        mintAmount: r.u64(),
        solAmount: r.u64(),
        poolMigrationFee: r.u64(),
        bondingCurve: r.pubkey(),
        timestamp: r.i64(),
        pool: r.pubkey(),
    };
    if (!r.has(32)) return out;
    out.quoteMint = r.pubkey();
    return out;
}

// ============================================================================
// Fee payouts
// ============================================================================

export interface DistributeCreatorFeesEventData {
    timestamp: number;
    mint: string;
    bondingCurve: string;
    sharingConfig: string;
    admin: string;
    shareholders: Array<{ address: string; shareBps: number }>;
    distributed: bigint;
    quoteMint?: string;
}

export function decodeDistributeCreatorFeesEvent(bytes: Buffer): DistributeCreatorFeesEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.DistributeCreatorFeesEvent) return null;
    const r = new BorshReader(bytes);
    if (!r.has(8 + 32 * 4)) return null;
    const timestamp = r.i64();
    const mint = r.pubkey();
    const bondingCurve = r.pubkey();
    const sharingConfig = r.pubkey();
    const admin = r.pubkey();
    const shareholders = r.shareholders();
    if (shareholders === null || !r.has(8)) return null;
    const out: DistributeCreatorFeesEventData = {
        timestamp, mint, bondingCurve, sharingConfig, admin, shareholders, distributed: r.u64(),
    };
    if (!r.has(32)) return out;
    out.quoteMint = r.pubkey();
    return out;
}

export interface CollectCreatorFeeEventData {
    timestamp: number;
    creator: string;
    creatorFee: bigint;
    quoteMint?: string;
}

/** Pump creator vault paid out to the creator (collect_creator_fee / _v2). */
export function decodeCollectCreatorFeeEvent(bytes: Buffer): CollectCreatorFeeEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.CollectCreatorFeeEvent) return null;
    const r = new BorshReader(bytes);
    if (!r.has(8 + 32 + 8)) return null;
    const out: CollectCreatorFeeEventData = { timestamp: r.i64(), creator: r.pubkey(), creatorFee: r.u64() };
    if (!r.has(32)) return out;
    out.quoteMint = r.pubkey();
    return out;
}

export interface CollectCoinCreatorFeeEventData {
    timestamp: number;
    coinCreator: string;
    coinCreatorFee: bigint;
}

/** PumpSwap creator vault paid out to the coin creator (collect_coin_creator_fee). */
export function decodeCollectCoinCreatorFeeEvent(bytes: Buffer): CollectCoinCreatorFeeEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.CollectCoinCreatorFeeEvent) return null;
    const r = new BorshReader(bytes);
    if (!r.has(8 + 32 + 8)) return null;
    return { timestamp: r.i64(), coinCreator: r.pubkey(), coinCreatorFee: r.u64() };
}

export interface ClaimCashbackEventData {
    user: string;
    amount: bigint;
    timestamp?: number;
}

export function decodeClaimCashbackEvent(bytes: Buffer): ClaimCashbackEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.ClaimCashbackEvent) return null;
    const r = new BorshReader(bytes);
    if (!r.has(32 + 8)) return null;
    const out: ClaimCashbackEventData = { user: r.pubkey(), amount: r.u64() };
    if (r.has(8)) out.timestamp = r.i64();
    return out;
}

// ============================================================================
// PumpFees: SocialFeePdaClaimed
// ============================================================================

export interface SocialFeePdaClaimedData {
    timestamp: number;
    userId: string;
    platform: number;
    socialFeePda: string;
    recipient: string;
    socialClaimAuthority: string;
    amountClaimed: bigint;
    claimableBefore?: bigint;
    /** Lifetime SOL claimed by the PDA (IDL order: after claimable_before). */
    lifetimeClaimed?: bigint;
    recipientBalanceBefore?: bigint;
    recipientBalanceAfter?: bigint;
    quoteMint?: string;
    /** Lifetime claimed in the PDA's non-SOL quote currency. */
    lifetimeStableClaimed?: bigint;
}

export function decodeSocialFeePdaClaimed(bytes: Buffer): SocialFeePdaClaimedData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.SocialFeePdaClaimed) return null;
    const r = new BorshReader(bytes);
    if (!r.has(8)) return null;
    const timestamp = r.i64();
    const userId = r.string();
    if (userId === null || !r.has(1 + 32 * 3 + 8)) return null;
    const out: SocialFeePdaClaimedData = {
        timestamp,
        userId,
        platform: r.u8(),
        socialFeePda: r.pubkey(),
        recipient: r.pubkey(),
        socialClaimAuthority: r.pubkey(),
        amountClaimed: r.u64(),
    };
    if (!r.has(8)) return out;
    out.claimableBefore = r.u64();
    if (!r.has(8)) return out;
    out.lifetimeClaimed = r.u64();
    if (!r.has(16)) return out;
    out.recipientBalanceBefore = r.u64();
    out.recipientBalanceAfter = r.u64();
    if (!r.has(32)) return out;
    out.quoteMint = r.pubkey();
    if (!r.has(8)) return out;
    out.lifetimeStableClaimed = r.u64();
    return out;
}
