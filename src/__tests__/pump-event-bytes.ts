/**
 * Borsh byte builders for Pump / PumpSwap / PumpFees events and instructions,
 * laid out field by field from the October 2026 IDLs. Tests use them to build
 * both the older, shorter layouts and the newer, longer ones.
 */

import bs58 from 'bs58';

export class BorshWriter {
    private parts: Buffer[] = [];

    hex(hex: string): this {
        this.parts.push(Buffer.from(hex, 'hex'));
        return this;
    }

    u8(v: number): this {
        this.parts.push(Buffer.from([v]));
        return this;
    }

    bool(v: boolean): this {
        return this.u8(v ? 1 : 0);
    }

    u16(v: number): this {
        const b = Buffer.alloc(2);
        b.writeUInt16LE(v);
        this.parts.push(b);
        return this;
    }

    u32(v: number): this {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(v);
        this.parts.push(b);
        return this;
    }

    u64(v: bigint | number): this {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(BigInt(v));
        this.parts.push(b);
        return this;
    }

    i64(v: number): this {
        const b = Buffer.alloc(8);
        b.writeBigInt64LE(BigInt(v));
        this.parts.push(b);
        return this;
    }

    pubkey(v: string): this {
        const b = Buffer.from(bs58.decode(v));
        if (b.length !== 32) throw new Error(`not a 32-byte key: ${v}`);
        this.parts.push(b);
        return this;
    }

    str(v: string): this {
        const b = Buffer.from(v, 'utf8');
        return this.u32(b.length).raw(b);
    }

    raw(b: Buffer): this {
        this.parts.push(b);
        return this;
    }

    build(): Buffer {
        return Buffer.concat(this.parts);
    }
}

/** A deterministic 32-byte key filled with one byte value. */
export function key(fill: number): string {
    return bs58.encode(Buffer.alloc(32, fill));
}

export const ZERO_KEY = '11111111111111111111111111111111';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** Bytes a future program version might append; every decoder must ignore them. */
export const FUTURE_TAIL = Buffer.alloc(24, 0xab);

export function programData(bytes: Buffer): string {
    return `Program data: ${bytes.toString('base64')}`;
}

export function ixData(discHex: string, args: Buffer = Buffer.alloc(0)): string {
    return bs58.encode(Buffer.concat([Buffer.from(discHex, 'hex'), args]));
}

// ── Pump TradeEvent ──────────────────────────────────────────────────────

export interface TradeFields {
    mint: string;
    solAmount: bigint;
    tokenAmount: bigint;
    isBuy: boolean;
    user: string;
    timestamp: number;
    virtualSolReserves?: bigint;
    virtualTokenReserves?: bigint;
    realSolReserves?: bigint;
    realTokenReserves?: bigint;
    feeRecipient?: string;
    fee?: bigint;
    creator?: string;
    creatorFee?: bigint;
    ixName?: string;
    mayhemMode?: boolean;
    cashback?: bigint;
    buybackFee?: bigint;
    shareholders?: Array<{ address: string; shareBps: number }>;
    quoteMint?: string;
    quoteAmount?: bigint;
    virtualQuoteReserves?: bigint;
    realQuoteReserves?: bigint;
    creatorFeeUnclaimed?: bigint;
}

/** The oldest TradeEvent: discriminator plus the 121-byte prefix. */
export function tradeEventPrefix(f: TradeFields): BorshWriter {
    return new BorshWriter()
        .hex('bddb7fd34ee661ee')
        .pubkey(f.mint)
        .u64(f.solAmount)
        .u64(f.tokenAmount)
        .bool(f.isBuy)
        .pubkey(f.user)
        .i64(f.timestamp)
        .u64(f.virtualSolReserves ?? 30_000_000_000n)
        .u64(f.virtualTokenReserves ?? 1_073_000_000_000_000n)
        .u64(f.realSolReserves ?? 0n)
        .u64(f.realTokenReserves ?? 793_100_000_000_000n);
}

/** A pre-upgrade TradeEvent: prefix, fees, volume tracking, ix_name and mayhem_mode. */
export function tradeEventLegacy(f: TradeFields): BorshWriter {
    return tradeEventPrefix(f)
        .pubkey(f.feeRecipient ?? key(9))
        .u64(95)
        .u64(f.fee ?? 0n)
        .pubkey(f.creator ?? key(8))
        .u64(30)
        .u64(f.creatorFee ?? 0n)
        .bool(true)
        .u64(0)
        .u64(0)
        .u64(0)
        .i64(0)
        .str(f.ixName ?? 'buy')
        .bool(f.mayhemMode ?? false);
}

/** The October 2026 TradeEvent, every field in IDL order, plus bytes from a future version. */
export function tradeEventV3(f: TradeFields): Buffer {
    const shareholders = f.shareholders ?? [];
    const w = tradeEventLegacy({ ...f, feeRecipient: f.feeRecipient ?? ZERO_KEY })
        .u64(0)
        .u64(f.cashback ?? 0n)
        .u64(0)
        .u64(f.buybackFee ?? 0n)
        .u32(shareholders.length);
    for (const s of shareholders) w.pubkey(s.address).u16(s.shareBps);
    return w
        .pubkey(f.quoteMint ?? ZERO_KEY)
        .u64(f.quoteAmount ?? f.solAmount)
        .u64(f.virtualQuoteReserves ?? 0n)
        .u64(f.realQuoteReserves ?? 0n)
        .u64(0)
        .u64(0)
        .u64(f.creatorFeeUnclaimed ?? 0n)
        .raw(FUTURE_TAIL)
        .build();
}

// ── Pump curve completion ─────────────────────────────────────────────────

export function completeEvent(user: string, mint: string, bondingCurve: string, withV2Tail: boolean): Buffer {
    const w = new BorshWriter().hex('5f72619cd42e9808').pubkey(user).pubkey(mint).pubkey(bondingCurve);
    if (withV2Tail) w.i64(1_790_000_000).pubkey(ZERO_KEY).raw(FUTURE_TAIL);
    return w.build();
}

export interface PostCompleteFields {
    user: string;
    mint: string;
    baseOut: bigint;
    quoteIn: bigint;
    fee?: bigint;
    creatorFee?: bigint;
}

export function postCompleteBuyEvent(f: PostCompleteFields): Buffer {
    return new BorshWriter()
        .hex('6fb06d8b316cd5fb')
        .pubkey(f.user)
        .pubkey(f.mint)
        .pubkey(key(77))
        .pubkey(ZERO_KEY)
        .i64(1_790_000_000)
        .u64(f.baseOut)
        .u64(f.quoteIn)
        .u64(95)
        .u64(f.fee ?? 0n)
        .u64(30)
        .u64(f.creatorFee ?? 0n)
        .u64(0)
        .u64(1n)
        .u64(2n)
        .u64(3n)
        .u64(4n)
        .build();
}

// ── Fee payouts and sweeps ────────────────────────────────────────────────

export function collectCreatorFeeEvent(creator: string, amount: bigint, quoteMint?: string): Buffer {
    const w = new BorshWriter().hex('7a027f010ebf0caf').i64(1_790_000_000).pubkey(creator).u64(amount);
    if (quoteMint) w.pubkey(quoteMint).raw(FUTURE_TAIL);
    return w.build();
}

export function collectCoinCreatorFeeEvent(creator: string, amount: bigint): Buffer {
    return new BorshWriter()
        .hex('e8f5c2eeeada3a59')
        .i64(1_790_000_000)
        .pubkey(creator)
        .u64(amount)
        .pubkey(key(40))
        .pubkey(key(41))
        .build();
}

export function distributeCreatorFeesEvent(
    mint: string,
    distributed: bigint,
    shareholders: Array<{ address: string; shareBps: number }>,
    quoteMint?: string,
): Buffer {
    const w = new BorshWriter()
        .hex('a537817004b3ca28')
        .i64(1_790_000_000)
        .pubkey(mint)
        .pubkey(key(50))
        .pubkey(key(51))
        .pubkey(key(52))
        .u32(shareholders.length);
    for (const s of shareholders) w.pubkey(s.address).u16(s.shareBps);
    w.u64(distributed);
    if (quoteMint) w.pubkey(quoteMint).raw(FUTURE_TAIL);
    return w.build();
}

export function sweepBondingCurveFeeEvent(mint: string, recipient: string, amount: bigint, bucket: number): Buffer {
    return new BorshWriter()
        .hex('742b4dbd117a482b')
        .i64(1_790_000_000)
        .pubkey(mint)
        .pubkey(key(60))
        .pubkey(ZERO_KEY)
        .pubkey(recipient)
        .u64(amount)
        .u8(bucket)
        .build();
}

export function sweepPoolFeeEvent(baseMint: string, recipient: string, amount: bigint, bucket: number): Buffer {
    return new BorshWriter()
        .hex('82a42461e48287a5')
        .i64(1_790_000_000)
        .pubkey(key(61))
        .pubkey(baseMint)
        .pubkey(ZERO_KEY)
        .pubkey(recipient)
        .pubkey(key(62))
        .u64(amount)
        .u8(bucket)
        .build();
}

export interface SocialClaimFields {
    userId: string;
    socialFeePda: string;
    recipient: string;
    amountClaimed: bigint;
    claimableBefore?: bigint;
    lifetimeClaimed?: bigint;
    quoteMint?: string;
    lifetimeStableClaimed?: bigint;
}

/** SocialFeePdaClaimed; `v2` appends quote_mint and lifetime_stable_claimed. */
export function socialFeePdaClaimed(f: SocialClaimFields, v2: boolean): Buffer {
    const w = new BorshWriter()
        .hex('3212c141edd2eaec')
        .i64(1_790_000_000)
        .str(f.userId)
        .u8(2)
        .pubkey(f.socialFeePda)
        .pubkey(f.recipient)
        .pubkey(key(70))
        .u64(f.amountClaimed)
        .u64(f.claimableBefore ?? f.amountClaimed)
        .u64(f.lifetimeClaimed ?? f.amountClaimed)
        .u64(1_000_000n)
        .u64(1_000_000n + f.amountClaimed);
    if (v2) w.pubkey(f.quoteMint ?? ZERO_KEY).u64(f.lifetimeStableClaimed ?? 0n).raw(FUTURE_TAIL);
    return w.build();
}
