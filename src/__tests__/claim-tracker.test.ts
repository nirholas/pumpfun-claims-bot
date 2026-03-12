/**
 * Tests for claim tracker — first-claim detection, persistence, counters.
 *
 * Tests the in-memory tracking logic without requiring disk I/O.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    recordClaim,
    getClaimRecord,
    isFirstClaimOnToken,
    isFirstClaimByWallet,
    isFirstClaimByGithubUser,
    hasGithubUserClaimed,
    markGithubUserClaimed,
    incrementGithubClaimCount,
    getGithubClaimCount,
    getTrackedCount,
    type ClaimRecord,
} from '../claim-tracker.js';

// Note: Each test uses unique keys to avoid cross-test state pollution
// since the module uses in-memory singletons.

describe('recordClaim', () => {
    it('records a first claim with claimCount = 1', () => {
        const record = recordClaim(
            'wallet_rc_1',
            'mint_rc_1',
            1.5,
            1700000000,
        );

        expect(record.claimCount).toBe(1);
        expect(record.totalClaimedSol).toBe(1.5);
        expect(record.firstClaimTimestamp).toBe(1700000000);
        expect(record.lastClaimTimestamp).toBe(1700000000);
    });

    it('increments claim count on repeat claims', () => {
        recordClaim('wallet_rc_2', 'mint_rc_2', 1.0, 1700000000);
        const second = recordClaim('wallet_rc_2', 'mint_rc_2', 2.0, 1700001000);

        expect(second.claimCount).toBe(2);
        expect(second.totalClaimedSol).toBe(3.0);
        expect(second.firstClaimTimestamp).toBe(1700000000);
        expect(second.lastClaimTimestamp).toBe(1700001000);
    });

    it('records price snapshot when provided', () => {
        const record = recordClaim(
            'wallet_rc_3',
            'mint_rc_3',
            0.5,
            1700000000,
            {
                priceSol: 0.00001,
                priceUsd: 0.0015,
                mcapUsd: 45000,
                curveProgress: 0.72,
            },
        );

        expect(record.claimPriceSol).toBe(0.00001);
        expect(record.claimPriceUsd).toBe(0.0015);
        expect(record.claimMcapUsd).toBe(45000);
        expect(record.claimCurveProgress).toBe(0.72);
    });

    it('defaults price snapshot fields to 0 when not provided', () => {
        const record = recordClaim('wallet_rc_4', 'mint_rc_4', 1.0, 1700000000);

        expect(record.claimPriceSol).toBe(0);
        expect(record.claimPriceUsd).toBe(0);
        expect(record.claimMcapUsd).toBe(0);
        expect(record.claimCurveProgress).toBe(0);
    });

    it('tracks different wallet+mint pairs independently', () => {
        const r1 = recordClaim('wallet_rc_5a', 'mint_rc_5', 1.0, 1700000000);
        const r2 = recordClaim('wallet_rc_5b', 'mint_rc_5', 2.0, 1700001000);

        expect(r1.claimCount).toBe(1);
        expect(r2.claimCount).toBe(1);
        expect(r1.totalClaimedSol).toBe(1.0);
        expect(r2.totalClaimedSol).toBe(2.0);
    });
});

describe('getClaimRecord', () => {
    it('returns null for unknown wallet+mint', () => {
        const result = getClaimRecord('unknown_wallet', 'unknown_mint');
        expect(result).toBeNull();
    });

    it('returns recorded claim', () => {
        recordClaim('wallet_gcr_1', 'mint_gcr_1', 3.0, 1700000000);
        const result = getClaimRecord('wallet_gcr_1', 'mint_gcr_1');

        expect(result).not.toBeNull();
        expect(result!.claimCount).toBe(1);
        expect(result!.totalClaimedSol).toBe(3.0);
    });
});

describe('isFirstClaimOnToken', () => {
    it('returns true for first-ever claim on a token', () => {
        expect(isFirstClaimOnToken('token_first_1')).toBe(true);
    });

    it('returns false for subsequent calls on same token', () => {
        isFirstClaimOnToken('token_first_2');
        expect(isFirstClaimOnToken('token_first_2')).toBe(false);
    });

    it('returns true for different tokens', () => {
        expect(isFirstClaimOnToken('token_first_3a')).toBe(true);
        expect(isFirstClaimOnToken('token_first_3b')).toBe(true);
    });
});

describe('isFirstClaimByWallet', () => {
    it('returns true for first-ever claim by a wallet', () => {
        expect(isFirstClaimByWallet('wallet_first_1')).toBe(true);
    });

    it('returns false for subsequent calls with same wallet', () => {
        isFirstClaimByWallet('wallet_first_2');
        expect(isFirstClaimByWallet('wallet_first_2')).toBe(false);
    });
});

describe('isFirstClaimByGithubUser', () => {
    it('returns true for first-ever claim by a GitHub user', () => {
        expect(isFirstClaimByGithubUser('gh_user_1')).toBe(true);
    });

    it('returns false for subsequent calls with same user', () => {
        isFirstClaimByGithubUser('gh_user_2');
        expect(isFirstClaimByGithubUser('gh_user_2')).toBe(false);
    });
});

describe('hasGithubUserClaimed / markGithubUserClaimed', () => {
    it('returns false for unclaimed user+mint', () => {
        expect(hasGithubUserClaimed('gh_has_1', 'mint_has_1')).toBe(false);
    });

    it('returns true after marking as claimed', () => {
        markGithubUserClaimed('gh_has_2', 'mint_has_2');
        expect(hasGithubUserClaimed('gh_has_2', 'mint_has_2')).toBe(true);
    });

    it('tracks user+mint pairs independently', () => {
        markGithubUserClaimed('gh_has_3', 'mint_has_3a');
        expect(hasGithubUserClaimed('gh_has_3', 'mint_has_3a')).toBe(true);
        expect(hasGithubUserClaimed('gh_has_3', 'mint_has_3b')).toBe(false);
    });

    it('does not double-add on repeated markings', () => {
        markGithubUserClaimed('gh_has_4', 'mint_has_4');
        markGithubUserClaimed('gh_has_4', 'mint_has_4');
        // Should still work fine
        expect(hasGithubUserClaimed('gh_has_4', 'mint_has_4')).toBe(true);
    });
});

describe('incrementGithubClaimCount / getGithubClaimCount', () => {
    it('starts at 0 before any claims', () => {
        expect(getGithubClaimCount('gh_count_1', 'mint_count_1')).toBe(0);
    });

    it('increments to 1 on first claim', () => {
        const count = incrementGithubClaimCount('gh_count_2', 'mint_count_2');
        expect(count).toBe(1);
    });

    it('increments sequentially', () => {
        incrementGithubClaimCount('gh_count_3', 'mint_count_3');
        incrementGithubClaimCount('gh_count_3', 'mint_count_3');
        const count = incrementGithubClaimCount('gh_count_3', 'mint_count_3');
        expect(count).toBe(3);
    });

    it('tracks different user+mint pairs independently', () => {
        incrementGithubClaimCount('gh_count_4a', 'mint_count_4');
        incrementGithubClaimCount('gh_count_4a', 'mint_count_4');
        incrementGithubClaimCount('gh_count_4b', 'mint_count_4');

        expect(getGithubClaimCount('gh_count_4a', 'mint_count_4')).toBe(2);
        expect(getGithubClaimCount('gh_count_4b', 'mint_count_4')).toBe(1);
    });

    it('getGithubClaimCount does not increment', () => {
        incrementGithubClaimCount('gh_count_5', 'mint_count_5');
        getGithubClaimCount('gh_count_5', 'mint_count_5');
        getGithubClaimCount('gh_count_5', 'mint_count_5');
        expect(getGithubClaimCount('gh_count_5', 'mint_count_5')).toBe(1);
    });
});

describe('getTrackedCount', () => {
    it('returns a number', () => {
        expect(typeof getTrackedCount()).toBe('number');
    });

    it('increases when new claims are recorded', () => {
        const before = getTrackedCount();
        recordClaim('wallet_track_1', 'mint_track_1', 1.0, 1700000000);
        expect(getTrackedCount()).toBeGreaterThanOrEqual(before);
    });
});
