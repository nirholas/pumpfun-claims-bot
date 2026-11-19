/**
 * Tests for claim tracker — repeat detection, counters and persistence.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
    hasGithubUserClaimed,
    markGithubUserClaimed,
    incrementGithubClaimCount,
    getGithubClaimCount,
    getGithubTotalClaimCount,
    getGithubUserClaimedMints,
} from '../claim-tracker.js';

// Note: Each test uses unique keys to avoid cross-test state pollution
// since the module uses in-memory singletons.

describe('hasGithubUserClaimed / markGithubUserClaimed', () => {
    it('returns false for unclaimed user+mint', () => {
        expect(hasGithubUserClaimed('gh_has_1', 'mint_has_1')).toBe(false);
    });

    it('returns true after marking as claimed', () => {
        markGithubUserClaimed('gh_has_2', 'mint_has_2');
        expect(hasGithubUserClaimed('gh_has_2', 'mint_has_2')).toBe(true);
    });

    it('claiming one mint marks user as claimed for ALL mints (cross-mint repeat detection)', () => {
        markGithubUserClaimed('gh_has_3', 'mint_has_3a');
        expect(hasGithubUserClaimed('gh_has_3', 'mint_has_3a')).toBe(true);
        // Claiming mint_3a should also flag mint_3b as repeat via user-level key
        expect(hasGithubUserClaimed('gh_has_3', 'mint_has_3b')).toBe(true);
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

describe('getGithubTotalClaimCount', () => {
    it('sums the per-coin counts of one user only', () => {
        incrementGithubClaimCount('77', 'mintA');
        incrementGithubClaimCount('77', 'mintA');
        incrementGithubClaimCount('77', 'mintB');
        incrementGithubClaimCount('770', 'mintA');
        expect(getGithubTotalClaimCount('77')).toBe(3);
        expect(getGithubClaimCount('77')).toBe(0);
    });
});

describe('getGithubUserClaimedMints', () => {
    it('lists claimed coins and skips PDA keys', () => {
        markGithubUserClaimed('gh_mints_1', 'mintX');
        markGithubUserClaimed('gh_mints_1', 'pda:SomePda');
        markGithubUserClaimed('gh_mints_1', 'mintY');
        expect(getGithubUserClaimedMints('gh_mints_1')).toEqual(['mintX', 'mintY']);
    });
});

describe('persistence', () => {
    let dir: string;
    const previousDataDir = process.env.DATA_DIR;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'claim-tracker-'));
        process.env.DATA_DIR = dir;
        vi.resetModules();
    });

    afterEach(() => {
        if (previousDataDir === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = previousDataDir;
        rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips claim state through DATA_DIR', async () => {
        const first = await import('../claim-tracker.js');
        first.markGithubUserClaimed('4242', 'mintP');
        first.incrementGithubClaimCount('4242', 'mintP');
        first.addGithubUserPda('4242', 'PdaOne');
        first.flushPersistedClaims();

        vi.resetModules();
        const second = await import('../claim-tracker.js');
        expect(second.hasGithubUserClaimed('4242')).toBe(false);
        second.loadPersistedClaims();
        expect(second.hasGithubUserClaimed('4242')).toBe(true);
        expect(second.getGithubClaimCount('4242', 'mintP')).toBe(1);
        expect(second.getGithubUserPdas('4242')).toEqual(['PdaOne']);
        expect(JSON.parse(readFileSync(join(dir, 'github-first-claims.json'), 'utf8'))).toEqual(['4242', '4242:mintP']);
    });

    it('still loads the other files when one is corrupt', async () => {
        writeFileSync(join(dir, 'github-first-claims.json'), '["5151"]');
        writeFileSync(join(dir, 'github-claim-counts.json'), '{"5151:mint": 2'); // truncated write
        const tracker = await import('../claim-tracker.js');
        tracker.loadPersistedClaims();
        expect(tracker.hasGithubUserClaimed('5151')).toBe(true);
        expect(tracker.getGithubClaimCount('5151', 'mint')).toBe(0);
    });
});
