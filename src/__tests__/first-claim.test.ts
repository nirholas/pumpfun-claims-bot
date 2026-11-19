import { describe, expect, it, vi } from 'vitest';

import { decideFirstClaim, type FirstClaimChecks } from '../first-claim.js';

const PDA = 'PdaCurrent1111111111111111111111111111111';
const OTHER_PDA = 'PdaOther111111111111111111111111111111111';
const WALLET = 'Wallet11111111111111111111111111111111111';

function claim(overrides: Partial<Parameters<typeof decideFirstClaim>[0]> = {}) {
    return {
        githubUserId: '4242',
        txSignature: 'sig-now',
        amountLamports: 2_000_000_000,
        lifetimeClaimedLamports: 2_000_000_000,
        socialFeePda: PDA,
        recipientWallet: WALLET,
        ...overrides,
    };
}

function checks(overrides: Partial<FirstClaimChecks> = {}): FirstClaimChecks {
    return {
        hasGithubUserClaimed: vi.fn(() => false),
        getGithubUserPdas: vi.fn(() => []),
        pdaHasPriorTransactions: vi.fn(async () => false),
        pdaHasAnyTransactions: vi.fn(async () => false),
        walletHasPriorSocialFeeClaims: vi.fn(async () => false),
        ...overrides,
    };
}

describe('decideFirstClaim', () => {
    it('accepts a claim whose lifetime equals the amount and that has no prior history', async () => {
        const c = checks({ getGithubUserPdas: vi.fn(() => [PDA]) });
        await expect(decideFirstClaim(claim(), c)).resolves.toEqual({ isFirstClaim: true });
        expect(c.pdaHasPriorTransactions).toHaveBeenCalledWith(PDA, 'sig-now');
        expect(c.pdaHasAnyTransactions).not.toHaveBeenCalled(); // the current PDA is skipped
        expect(c.walletHasPriorSocialFeeClaims).toHaveBeenCalledWith(WALLET, 'sig-now');
    });

    it('treats a user this bot already posted as a repeat without any RPC lookup', async () => {
        const c = checks({ hasGithubUserClaimed: vi.fn(() => true) });
        await expect(decideFirstClaim(claim(), c)).resolves.toEqual({ isFirstClaim: false, reason: 'already-posted', provenRepeat: false });
        expect(c.pdaHasPriorTransactions).not.toHaveBeenCalled();
    });

    it.each([
        ['missing lifetime', { lifetimeClaimedLamports: undefined }],
        ['zero amount (no payout event)', { amountLamports: 0 }],
    ])('skips a claim it cannot verify: %s', async (_label, overrides) => {
        await expect(decideFirstClaim(claim(overrides), checks()))
            .resolves.toEqual({ isFirstClaim: false, reason: 'no-lifetime-data', provenRepeat: false });
    });

    it('treats lifetime above the amount as a proven repeat', async () => {
        const c = checks();
        await expect(decideFirstClaim(claim({ lifetimeClaimedLamports: 5_000_000_000 }), c))
            .resolves.toEqual({ isFirstClaim: false, reason: 'lifetime-exceeds-amount', provenRepeat: true });
        expect(c.pdaHasPriorTransactions).not.toHaveBeenCalled();
    });

    it('accepts on lifetime alone when the event names no PDA', async () => {
        const c = checks();
        await expect(decideFirstClaim(claim({ socialFeePda: undefined }), c)).resolves.toEqual({ isFirstClaim: true });
        expect(c.walletHasPriorSocialFeeClaims).not.toHaveBeenCalled();
    });

    it('treats an earlier claim on the same PDA as a repeat', async () => {
        await expect(decideFirstClaim(claim(), checks({ pdaHasPriorTransactions: vi.fn(async () => true) })))
            .resolves.toMatchObject({ isFirstClaim: false, reason: 'pda-has-prior-claim', provenRepeat: true });
    });

    it('treats history on another known PDA of the user as a repeat', async () => {
        const pdaHasAnyTransactions = vi.fn(async (pda: string) => pda === OTHER_PDA);
        const c = checks({ getGithubUserPdas: vi.fn(() => [PDA, OTHER_PDA]), pdaHasAnyTransactions });
        await expect(decideFirstClaim(claim(), c)).resolves.toMatchObject({ reason: 'other-pda-has-history' });
        expect(pdaHasAnyTransactions).toHaveBeenCalledWith(OTHER_PDA);
        expect(c.walletHasPriorSocialFeeClaims).not.toHaveBeenCalled();
    });

    it('treats an earlier social claim by the recipient wallet as a repeat', async () => {
        await expect(decideFirstClaim(claim(), checks({ walletHasPriorSocialFeeClaims: vi.fn(async () => true) })))
            .resolves.toMatchObject({ reason: 'wallet-has-prior-claim', provenRepeat: true });
    });

    it('skips the wallet check when the event has no recipient', async () => {
        const c = checks();
        await expect(decideFirstClaim(claim({ recipientWallet: undefined }), c)).resolves.toEqual({ isFirstClaim: true });
        expect(c.walletHasPriorSocialFeeClaims).not.toHaveBeenCalled();
    });
});
