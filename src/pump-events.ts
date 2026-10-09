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
    CreateEvent: '1b72a94ddeeb6376',
    TradeEvent: 'bddb7fd34ee661ee',
    CompleteEvent: '5f72619cd42e9808',
    CompletePumpAmmMigrationEvent: 'bde95db95c94ea94',
    PostCompleteBuyEvent: '6fb06d8b316cd5fb',
    DistributeCreatorFeesEvent: 'a537817004b3ca28',
    CollectCreatorFeeEvent: '7a027f010ebf0caf',
    SweepBondingCurveFeeEvent: '742b4dbd117a482b',
    /** Pump and PumpSwap emit the same ClaimCashbackEvent layout. */
    ClaimCashbackEvent: 'e2d6f62107f293e5',
    /** PumpSwap */
    CollectCoinCreatorFeeEvent: 'e8f5c2eeeada3a59',
    SweepPoolFeeEvent: '82a42461e48287a5',
    /** PumpFees */
    SocialFeePdaClaimed: '3212c141edd2eaec',
} as const;

/** The all-zero key. V2+ events write it as the quote mint of a SOL coin, and v3 trades as fee_recipient. */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/** True when a quote mint means SOL: absent (pre-V2 event), wrapped SOL, or the zero key. */
export function isSolQuote(quoteMint: string | undefined): boolean {
    return quoteMint === undefined || quoteMint === WSOL_MINT || quoteMint === SYSTEM_PROGRAM_ID;
}

/** Sweep event `bucket`: which fee the sweep paid out. */
export const SWEEP_BUCKET_PROTOCOL = 0;
export const SWEEP_BUCKET_CREATOR = 1;

/** Shareholder vectors are bounded on chain; anything larger is not a real event. */
const MAX_SHAREHOLDERS = 100;
/** Borsh strings in these events are names, symbols, URIs and ids. */
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

    bool(): boolean {
        return this.u8() === 1;
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

    skip(bytes: number): void {
        this.offset += bytes;
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
// Pump: CreateEvent
// ============================================================================

export interface CreateEventData {
    name: string;
    symbol: string;
    uri: string;
    mint: string;
    bondingCurve: string;
    user: string;
    creator: string;
    timestamp: number;
    virtualTokenReserves?: bigint;
    virtualSolReserves?: bigint;
    realTokenReserves?: bigint;
    tokenTotalSupply?: bigint;
    tokenProgram?: string;
    isMayhemMode?: boolean;
    isCashbackEnabled?: boolean;
    quoteMint?: string;
    virtualQuoteReserves?: bigint;
    creatorFeeBps?: bigint;
    isHolderReward?: boolean;
}

export function decodeCreateEvent(bytes: Buffer): CreateEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.CreateEvent) return null;
    const r = new BorshReader(bytes);
    const name = r.string();
    const symbol = r.string();
    const uri = r.string();
    if (name === null || symbol === null || uri === null) return null;
    if (!r.has(32 * 4 + 8)) return null;
    const out: CreateEventData = {
        name,
        symbol,
        uri,
        mint: r.pubkey(),
        bondingCurve: r.pubkey(),
        user: r.pubkey(),
        creator: r.pubkey(),
        timestamp: r.i64(),
    };
    if (!r.has(8 * 4)) return out;
    out.virtualTokenReserves = r.u64();
    out.virtualSolReserves = r.u64();
    out.realTokenReserves = r.u64();
    out.tokenTotalSupply = r.u64();
    if (!r.has(32)) return out;
    out.tokenProgram = r.pubkey();
    if (!r.has(1)) return out;
    out.isMayhemMode = r.bool();
    if (!r.has(1)) return out;
    out.isCashbackEnabled = r.bool();
    if (!r.has(32 + 8 + 8)) return out;
    out.quoteMint = r.pubkey();
    out.virtualQuoteReserves = r.u64();
    out.creatorFeeBps = r.u64();
    if (!r.has(1)) return out;
    out.isHolderReward = r.bool();
    return out;
}

// ============================================================================
// Pump: TradeEvent
// ============================================================================

export interface TradeEventData {
    mint: string;
    /** Quote paid or received on the curve, in the coin's quote units (lamports for SOL coins). */
    solAmount: bigint;
    tokenAmount: bigint;
    isBuy: boolean;
    user: string;
    timestamp: number;
    virtualSolReserves: bigint;
    virtualTokenReserves: bigint;
    realSolReserves: bigint;
    realTokenReserves: bigint;
    /** The zero key on v3 trades: the protocol fee stayed on the curve. */
    feeRecipient?: string;
    feeBasisPoints?: bigint;
    fee?: bigint;
    creator?: string;
    creatorFeeBasisPoints?: bigint;
    creatorFee?: bigint;
    /** buy, sell, buy_v2, buy_v3, sell_v3, buy_exact_quote_in_v3, multi_hop_swap, ... */
    ixName?: string;
    mayhemMode?: boolean;
    cashback?: bigint;
    buybackFee?: bigint;
    quoteMint?: string;
    quoteAmount?: bigint;
    virtualQuoteReserves?: bigint;
    realQuoteReserves?: bigint;
    /** Creator fee still waiting on the curve after this trade (v3 trades keep fees on the curve). */
    creatorFeeUnclaimed?: bigint;
}

/** TradeEvent ix_name values written by the v3 and multi-hop trade paths. */
export const V3_TRADE_IX_NAMES = ['buy_v3', 'sell_v3', 'buy_exact_quote_in_v3', 'multi_hop_swap'] as const;

export function decodeTradeEvent(bytes: Buffer): TradeEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.TradeEvent) return null;
    const r = new BorshReader(bytes);
    if (!r.has(32 + 8 + 8 + 1 + 32 + 8 + 8 * 4)) return null;
    const out: TradeEventData = {
        mint: r.pubkey(),
        solAmount: r.u64(),
        tokenAmount: r.u64(),
        isBuy: r.bool(),
        user: r.pubkey(),
        timestamp: r.i64(),
        virtualSolReserves: r.u64(),
        virtualTokenReserves: r.u64(),
        realSolReserves: r.u64(),
        realTokenReserves: r.u64(),
    };
    if (!r.has(32 + 8 + 8 + 32 + 8 + 8)) return out;
    out.feeRecipient = r.pubkey();
    out.feeBasisPoints = r.u64();
    out.fee = r.u64();
    out.creator = r.pubkey();
    out.creatorFeeBasisPoints = r.u64();
    out.creatorFee = r.u64();
    // track_volume, total_unclaimed_tokens, total_claimed_tokens,
    // current_sol_volume, last_update_timestamp
    if (!r.has(1 + 8 * 4)) return out;
    r.skip(1 + 8 * 4);
    const ixName = r.string();
    if (ixName === null) return out;
    out.ixName = ixName;
    if (!r.has(1)) return out;
    out.mayhemMode = r.bool();
    if (!r.has(16)) return out;
    r.skip(8); // cashback_fee_basis_points
    out.cashback = r.u64();
    if (!r.has(16)) return out;
    r.skip(8); // buyback_fee_basis_points
    out.buybackFee = r.u64();
    if (r.shareholders() === null) return out;
    if (!r.has(32 + 8 * 3)) return out;
    out.quoteMint = r.pubkey();
    out.quoteAmount = r.u64();
    out.virtualQuoteReserves = r.u64();
    out.realQuoteReserves = r.u64();
    if (!r.has(8 * 3)) return out;
    r.skip(16); // holder_rewards_bps, holder_rewards
    out.creatorFeeUnclaimed = r.u64();
    return out;
}

// ============================================================================
// Pump: CompleteEvent, CompletePumpAmmMigrationEvent, PostCompleteBuyEvent
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

export interface PostCompleteBuyEventData {
    user: string;
    mint: string;
    bondingCurve: string;
    quoteMint: string;
    timestamp: number;
    /** Extra tokens the completing buy took from the pool part. */
    baseOut: bigint;
    /** Quote that pool part cost. */
    quoteIn: bigint;
    fee?: bigint;
    creatorFee?: bigint;
    buybackFee?: bigint;
}

/** The pool part of a completing v3 buy (synthetic migration). */
export function decodePostCompleteBuyEvent(bytes: Buffer): PostCompleteBuyEventData | null {
    if (eventDiscriminator(bytes) !== EVENT_DISCRIMINATORS.PostCompleteBuyEvent) return null;
    const r = new BorshReader(bytes);
    if (!r.has(32 * 4 + 8 * 3)) return null;
    const out: PostCompleteBuyEventData = {
        user: r.pubkey(),
        mint: r.pubkey(),
        bondingCurve: r.pubkey(),
        quoteMint: r.pubkey(),
        timestamp: r.i64(),
        baseOut: r.u64(),
        quoteIn: r.u64(),
    };
    if (!r.has(8 * 5)) return out;
    r.skip(8); // fee_basis_points
    out.fee = r.u64();
    r.skip(8); // creator_fee_basis_points
    out.creatorFee = r.u64();
    out.buybackFee = r.u64();
    return out;
}

// ============================================================================
// Fee payouts and sweeps
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

export interface FeeSweepEventData {
    program: 'pump' | 'pump_amm';
    timestamp: number;
    /** Coin mint (Pump) or the pool's base mint (PumpSwap). */
    mint: string;
    quoteMint: string;
    /** Creator vault for a creator sweep, the protocol fee recipient otherwise. */
    recipient: string;
    amount: bigint;
    /** SWEEP_BUCKET_PROTOCOL or SWEEP_BUCKET_CREATOR. */
    bucket: number;
}

/**
 * A sweep moves fees the v3 / v2 / multi-hop trades left on the curve or pool
 * into the creator vault (or to the protocol). It is permissionless and pays
 * nobody's wallet, so it is never creator income and never a claim: the claim
 * that follows it (vault to creator) is the payout.
 */
export function decodeFeeSweepEvent(bytes: Buffer): FeeSweepEventData | null {
    const disc = eventDiscriminator(bytes);
    const r = new BorshReader(bytes);
    if (disc === EVENT_DISCRIMINATORS.SweepBondingCurveFeeEvent) {
        if (!r.has(8 + 32 * 4 + 8 + 1)) return null;
        const timestamp = r.i64();
        const mint = r.pubkey();
        r.skip(32); // bonding_curve
        const quoteMint = r.pubkey();
        const recipient = r.pubkey();
        return { program: 'pump', timestamp, mint, quoteMint, recipient, amount: r.u64(), bucket: r.u8() };
    }
    if (disc === EVENT_DISCRIMINATORS.SweepPoolFeeEvent) {
        if (!r.has(8 + 32 * 5 + 8 + 1)) return null;
        const timestamp = r.i64();
        r.skip(32); // pool
        const mint = r.pubkey();
        const quoteMint = r.pubkey();
        const recipient = r.pubkey();
        r.skip(32); // payer
        return { program: 'pump_amm', timestamp, mint, quoteMint, recipient, amount: r.u64(), bucket: r.u8() };
    }
    return null;
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

// ============================================================================
// Buyer totals across a synthetic-migration buy
// ============================================================================

export interface BuyerTrade {
    trade: TradeEventData;
    /** Present when this buy completed the curve and continued into the pool part. */
    postComplete?: PostCompleteBuyEventData;
    /** True when a CompleteEvent for this mint followed the trade in the same transaction. */
    completedCurve: boolean;
    /** Quote the buyer paid or received in total (curve part plus pool part). */
    totalQuote: bigint;
    /** Tokens the buyer received or sold in total (curve part plus pool part). */
    totalTokens: bigint;
}

/**
 * Pair every TradeEvent in a transaction with the PostCompleteBuyEvent its
 * completing buy emitted. A completing v3 buy emits TradeEvent (curve part),
 * CompleteEvent, then PostCompleteBuyEvent (pool part), and the buyer's total
 * is the TradeEvent amounts plus the PostCompleteBuyEvent amounts. A pool part
 * attaches to the nearest earlier unpaired buy by the same user on the same mint.
 */
export function buyerTradesFromPayloads(payloads: readonly Buffer[]): BuyerTrade[] {
    const trades: BuyerTrade[] = [];
    for (const bytes of payloads) {
        const disc = eventDiscriminator(bytes);
        if (disc === EVENT_DISCRIMINATORS.TradeEvent) {
            const trade = decodeTradeEvent(bytes);
            if (trade) {
                trades.push({
                    trade,
                    completedCurve: false,
                    totalQuote: trade.solAmount,
                    totalTokens: trade.tokenAmount,
                });
            }
        } else if (disc === EVENT_DISCRIMINATORS.CompleteEvent) {
            const complete = decodeCompleteEvent(bytes);
            if (!complete) continue;
            const last = lastMatching(trades, (t) => t.trade.mint === complete.mint);
            if (last) last.completedCurve = true;
        } else if (disc === EVENT_DISCRIMINATORS.PostCompleteBuyEvent) {
            const post = decodePostCompleteBuyEvent(bytes);
            if (!post) continue;
            const buy = lastMatching(trades, (t) =>
                t.trade.isBuy && !t.postComplete && t.trade.mint === post.mint && t.trade.user === post.user);
            if (!buy) continue;
            buy.postComplete = post;
            buy.completedCurve = true;
            buy.totalQuote += post.quoteIn;
            buy.totalTokens += post.baseOut;
        }
    }
    return trades;
}

function lastMatching<T>(items: T[], pred: (item: T) => boolean): T | undefined {
    for (let i = items.length - 1; i >= 0; i--) {
        if (pred(items[i]!)) return items[i];
    }
    return undefined;
}
