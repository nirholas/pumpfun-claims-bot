/**
 * Event decoders against IDL-built byte buffers: each event is decoded from an
 * older, shorter layout and from the October 2026 longer one (with extra bytes
 * appended), and neither may require an exact length.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { tradeAlertsFromLogs } from '../event-monitor.js';
import { formatWhaleFeed } from '../formatters.js';
import {
    buyerTradesFromPayloads,
    decodeCollectCreatorFeeEvent,
    decodeCompleteEvent,
    decodeCreateEvent,
    decodeDistributeCreatorFeesEvent,
    decodeFeeSweepEvent,
    decodeMigrationEvent,
    decodeSocialFeePdaClaimed,
    decodeTradeEvent,
    isSolQuote,
    programDataPayloads,
    SWEEP_BUCKET_CREATOR,
    V3_TRADE_IX_NAMES,
} from '../pump-events.js';
import {
    BorshWriter,
    collectCreatorFeeEvent,
    completeEvent,
    distributeCreatorFeesEvent,
    FUTURE_TAIL,
    key,
    postCompleteBuyEvent,
    programData,
    socialFeePdaClaimed,
    sweepBondingCurveFeeEvent,
    sweepPoolFeeEvent,
    tradeEventLegacy,
    tradeEventPrefix,
    tradeEventV3,
    USDC,
    ZERO_KEY,
} from './pump-event-bytes.js';

const MINT = key(1);
const USER = key(2);
const CREATOR = key(3);
const LAMPORTS = 1_000_000_000n;

describe('TradeEvent', () => {
    const base = {
        mint: MINT,
        solAmount: 12n * LAMPORTS,
        tokenAmount: 345_000_000_000n,
        isBuy: true,
        user: USER,
        timestamp: 1_790_000_000,
        creator: CREATOR,
        fee: 114_000_000n,
        creatorFee: 36_000_000n,
    };

    it('decodes the oldest 129-byte layout and leaves the later groups unset', () => {
        const bytes = tradeEventPrefix(base).build();
        expect(bytes.length).toBe(129);
        const ev = decodeTradeEvent(bytes)!;
        expect(ev.mint).toBe(MINT);
        expect(ev.solAmount).toBe(12n * LAMPORTS);
        expect(ev.tokenAmount).toBe(345_000_000_000n);
        expect(ev.isBuy).toBe(true);
        expect(ev.user).toBe(USER);
        expect(ev.timestamp).toBe(1_790_000_000);
        expect(ev.virtualTokenReserves).toBe(1_073_000_000_000_000n);
        expect(ev.creator).toBeUndefined();
        expect(ev.ixName).toBeUndefined();
    });

    it('reads fee and creator after the reserves in IDL order (pre-upgrade layout)', () => {
        const ev = decodeTradeEvent(tradeEventLegacy({ ...base, ixName: 'buy', mayhemMode: true }).build())!;
        expect(ev.feeRecipient).toBe(key(9));
        expect(ev.fee).toBe(114_000_000n);
        expect(ev.creator).toBe(CREATOR);
        expect(ev.creatorFee).toBe(36_000_000n);
        expect(ev.ixName).toBe('buy');
        expect(ev.mayhemMode).toBe(true);
        expect(ev.quoteMint).toBeUndefined();
    });

    it('decodes the October 2026 layout with shareholders and ignores trailing bytes', () => {
        const bytes = tradeEventV3({
            ...base,
            ixName: 'buy_v3',
            cashback: 7n,
            buybackFee: 11n,
            shareholders: [{ address: key(20), shareBps: 6_000 }, { address: key(21), shareBps: 4_000 }],
            quoteAmount: 12n * LAMPORTS,
            creatorFeeUnclaimed: 999n,
        });
        const ev = decodeTradeEvent(bytes)!;
        expect(ev.ixName).toBe('buy_v3');
        expect(ev.feeRecipient).toBe(ZERO_KEY);
        expect(ev.cashback).toBe(7n);
        expect(ev.buybackFee).toBe(11n);
        expect(ev.quoteMint).toBe(ZERO_KEY);
        expect(ev.quoteAmount).toBe(12n * LAMPORTS);
        expect(ev.creatorFeeUnclaimed).toBe(999n);
        expect(isSolQuote(ev.quoteMint)).toBe(true);
    });

    it.each([...V3_TRADE_IX_NAMES])('recognises ix_name %s', (ixName) => {
        const ev = decodeTradeEvent(tradeEventV3({ ...base, ixName, isBuy: ixName !== 'sell_v3' }))!;
        expect(ev.ixName).toBe(ixName);
        expect(ev.creatorFee).toBe(36_000_000n);
    });

    it('rejects a buffer shorter than the prefix', () => {
        expect(decodeTradeEvent(tradeEventPrefix(base).build().subarray(0, 120))).toBeNull();
    });
});

describe('CreateEvent', () => {
    const head = () => new BorshWriter()
        .hex('1b72a94ddeeb6376')
        .str('Three')
        .str('THREE')
        .str('https://example.org/meta.json')
        .pubkey(MINT)
        .pubkey(key(4))
        .pubkey(USER)
        .pubkey(CREATOR)
        .i64(1_790_000_000)
        .u64(1_073_000_000_000_000n)
        .u64(30n * LAMPORTS)
        .u64(793_100_000_000_000n)
        .u64(1_000_000_000_000_000n)
        .pubkey(key(5));

    it('decodes an older layout that ends at is_mayhem_mode', () => {
        const ev = decodeCreateEvent(head().bool(true).build())!;
        expect(ev.name).toBe('Three');
        expect(ev.symbol).toBe('THREE');
        expect(ev.mint).toBe(MINT);
        expect(ev.creator).toBe(CREATOR);
        expect(ev.isMayhemMode).toBe(true);
        expect(ev.isCashbackEnabled).toBeUndefined();
        expect(ev.quoteMint).toBeUndefined();
    });

    it('decodes the October 2026 layout with quote mint, creator fee bps and trailing bytes', () => {
        const bytes = head()
            .bool(false)
            .bool(true)
            .pubkey(USDC)
            .u64(5_000_000_000n)
            .u64(30n)
            .bool(true)
            .u8(1)
            .raw(FUTURE_TAIL)
            .build();
        const ev = decodeCreateEvent(bytes)!;
        expect(ev.isCashbackEnabled).toBe(true);
        expect(ev.quoteMint).toBe(USDC);
        expect(ev.virtualQuoteReserves).toBe(5_000_000_000n);
        expect(ev.creatorFeeBps).toBe(30n);
        expect(ev.isHolderReward).toBe(true);
    });

    it('does not decode the create instruction discriminator as an event', () => {
        const bytes = Buffer.concat([Buffer.from('d6904cec5f8b31b4', 'hex'), head().build().subarray(8)]);
        expect(decodeCreateEvent(bytes)).toBeNull();
    });
});

describe('CompleteEvent and migration', () => {
    it('decodes the 96-byte and the longer CompleteEvent', () => {
        const old = decodeCompleteEvent(completeEvent(USER, MINT, key(4), false))!;
        expect(old).toEqual({ user: USER, mint: MINT, bondingCurve: key(4) });
        const neu = decodeCompleteEvent(completeEvent(USER, MINT, key(4), true))!;
        expect(neu.mint).toBe(MINT);
        expect(neu.timestamp).toBe(1_790_000_000);
        expect(neu.quoteMint).toBe(ZERO_KEY);
    });

    it('reads CompletePumpAmmMigrationEvent at IDL offsets, with and without quote_mint', () => {
        const head = new BorshWriter()
            .hex('bde95db95c94ea94')
            .pubkey(USER)
            .pubkey(MINT)
            .u64(206_900_000_000_000n)
            .u64(84_990_000_000n)
            .u64(15_000_000n)
            .pubkey(key(4))
            .i64(1_790_000_100)
            .pubkey(key(6));
        const old = decodeMigrationEvent(head.build())!;
        expect(old.mintAmount).toBe(206_900_000_000_000n);
        expect(old.solAmount).toBe(84_990_000_000n);
        expect(old.poolMigrationFee).toBe(15_000_000n);
        expect(old.bondingCurve).toBe(key(4));
        expect(old.pool).toBe(key(6));
        expect(old.quoteMint).toBeUndefined();
        const neu = decodeMigrationEvent(head.pubkey(ZERO_KEY).raw(FUTURE_TAIL).build())!;
        expect(neu.pool).toBe(key(6));
        expect(neu.quoteMint).toBe(ZERO_KEY);
    });
});

describe('fee events', () => {
    const holders = [{ address: key(30), shareBps: 7_500 }, { address: key(31), shareBps: 2_500 }];

    it('reads DistributeCreatorFeesEvent after the shareholder vec, old and new', () => {
        const old = decodeDistributeCreatorFeesEvent(distributeCreatorFeesEvent(MINT, 3n * LAMPORTS, holders))!;
        expect(old.mint).toBe(MINT);
        expect(old.admin).toBe(key(52));
        expect(old.shareholders).toEqual(holders);
        expect(old.distributed).toBe(3n * LAMPORTS);
        expect(old.quoteMint).toBeUndefined();
        const neu = decodeDistributeCreatorFeesEvent(distributeCreatorFeesEvent(MINT, 25_000_000n, holders, USDC))!;
        expect(neu.distributed).toBe(25_000_000n);
        expect(neu.quoteMint).toBe(USDC);
    });

    it('reads CollectCreatorFeeEvent old and new', () => {
        expect(decodeCollectCreatorFeeEvent(collectCreatorFeeEvent(CREATOR, 5n * LAMPORTS))).toEqual({
            timestamp: 1_790_000_000, creator: CREATOR, creatorFee: 5n * LAMPORTS,
        });
        expect(decodeCollectCreatorFeeEvent(collectCreatorFeeEvent(CREATOR, 7_000_000n, USDC))!.quoteMint).toBe(USDC);
    });

    it('reads SocialFeePdaClaimed lifetime in IDL order, old and new', () => {
        const fields = {
            userId: '1234567',
            socialFeePda: key(32),
            recipient: key(33),
            amountClaimed: 2n * LAMPORTS,
            claimableBefore: 2n * LAMPORTS,
            lifetimeClaimed: 9n * LAMPORTS,
        };
        const old = decodeSocialFeePdaClaimed(socialFeePdaClaimed(fields, false))!;
        expect(old.userId).toBe('1234567');
        expect(old.platform).toBe(2);
        expect(old.socialFeePda).toBe(key(32));
        expect(old.amountClaimed).toBe(2n * LAMPORTS);
        expect(old.lifetimeClaimed).toBe(9n * LAMPORTS);
        expect(old.quoteMint).toBeUndefined();
        const neu = decodeSocialFeePdaClaimed(socialFeePdaClaimed({ ...fields, quoteMint: USDC, lifetimeStableClaimed: 40_000_000n }, true))!;
        expect(neu.quoteMint).toBe(USDC);
        expect(neu.lifetimeStableClaimed).toBe(40_000_000n);
    });

    it('decodes sweep events with their bucket', () => {
        const curve = decodeFeeSweepEvent(sweepBondingCurveFeeEvent(MINT, key(34), 4n * LAMPORTS, SWEEP_BUCKET_CREATOR))!;
        expect(curve).toMatchObject({ program: 'pump', mint: MINT, recipient: key(34), amount: 4n * LAMPORTS, bucket: 1 });
        const pool = decodeFeeSweepEvent(sweepPoolFeeEvent(MINT, key(35), 6n, 0))!;
        expect(pool).toMatchObject({ program: 'pump_amm', mint: MINT, recipient: key(35), amount: 6n, bucket: 0 });
    });
});

describe('completing buy (synthetic migration)', () => {
    const trade = {
        mint: MINT,
        solAmount: 4n * LAMPORTS,
        tokenAmount: 100_000_000_000n,
        isBuy: true,
        user: USER,
        timestamp: 1_790_000_000,
        creator: CREATOR,
        fee: 38_000_000n,
        creatorFee: 12_000_000n,
        ixName: 'buy_v3',
        realSolReserves: 85n * LAMPORTS,
    };
    const logs = [
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
        'Program log: Instruction: BuyV3',
        programData(tradeEventV3(trade)),
        programData(completeEvent(USER, MINT, key(4), true)),
        programData(postCompleteBuyEvent({ user: USER, mint: MINT, baseOut: 50_000_000_000n, quoteIn: 3n * LAMPORTS, fee: 28_000_000n, creatorFee: 9_000_000n })),
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
    ];

    it('adds the PostCompleteBuyEvent amounts to the buyer total', () => {
        const [buyer] = buyerTradesFromPayloads(programDataPayloads(logs));
        expect(buyer!.completedCurve).toBe(true);
        expect(buyer!.totalQuote).toBe(7n * LAMPORTS);
        expect(buyer!.totalTokens).toBe(150_000_000_000n);
    });

    it('raises a whale alert that only the combined total crosses', () => {
        const alerts = tradeAlertsFromLogs(logs, 'sig', 5);
        expect(alerts).toHaveLength(1);
        const alert = alerts[0]!;
        expect(alert.solAmount).toBe(7);
        expect(alert.curveSolAmount).toBe(4);
        expect(alert.postCompleteSolAmount).toBe(3);
        expect(alert.tokenAmount).toBe(150_000_000_000);
        expect(alert.fee).toBeCloseTo(0.066);
        expect(alert.creatorFee).toBeCloseTo(0.021);
        expect(alert.ixName).toBe('buy_v3');
        expect(alert.bondingCurveProgress).toBe(100);
        expect(formatWhaleFeed(alert, null)).toContain('Completed the bonding curve (4.00 SOL on the curve + 3.00 SOL after it)');
    });

    it('does not attach a pool part to another user or a sell', () => {
        const other = [
            programData(tradeEventV3({ ...trade, isBuy: false, ixName: 'sell_v3' })),
            programData(postCompleteBuyEvent({ user: key(99), mint: MINT, baseOut: 1n, quoteIn: 1n })),
        ];
        const [sell] = buyerTradesFromPayloads(programDataPayloads(other));
        expect(sell!.postComplete).toBeUndefined();
        expect(sell!.totalQuote).toBe(4n * LAMPORTS);
    });

    it('skips non-SOL-quoted trades for the SOL whale threshold', () => {
        const usdcLogs = [programData(tradeEventV3({ ...trade, solAmount: 50_000_000_000n, quoteMint: USDC }))];
        expect(tradeAlertsFromLogs(usdcLogs, 'sig', 5)).toEqual([]);
    });
});
