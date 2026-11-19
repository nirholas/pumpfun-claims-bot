/**
 * Event decoders against IDL-built byte buffers: each event is decoded from an
 * older, shorter layout and from the October 2026 longer one (with extra bytes
 * appended), and neither may require an exact length.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
    decodeCollectCreatorFeeEvent,
    decodeCompleteEvent,
    decodeDistributeCreatorFeesEvent,
    decodeMigrationEvent,
    decodeSocialFeePdaClaimed,
} from '../pump-events.js';
import {
    BorshWriter,
    collectCreatorFeeEvent,
    completeEvent,
    distributeCreatorFeesEvent,
    FUTURE_TAIL,
    key,
    socialFeePdaClaimed,
    USDC,
    ZERO_KEY,
} from './pump-event-bytes.js';

const MINT = key(1);
const USER = key(2);
const CREATOR = key(3);
const LAMPORTS = 1_000_000_000n;

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
});
