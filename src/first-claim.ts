/**
 * First-claim decision for GitHub social fee claims.
 *
 * The channel announces only a GitHub user's very first claim. Local state
 * resets on redeploy, so on-chain data is the primary evidence:
 *
 *   1. Already posted by this bot (local state)          → repeat
 *   2. No lifetime total in the event                    → cannot verify, skip
 *   3. Lifetime claimed exceeds this claim               → repeat
 *   4. This PDA has an earlier ClaimSocialFeePda tx      → repeat
 *   5. Another PDA known for the user has any tx         → repeat
 *   6. The recipient wallet has an earlier social claim  → repeat
 *   otherwise                                            → first claim
 *
 * Steps 4-6 need RPC lookups and run only when the cheaper checks pass.
 */

import type { FeeClaimEvent } from './types.js';

/** Lookups the decision needs; ClaimMonitor and the claim tracker provide them. */
export interface FirstClaimChecks {
    hasGithubUserClaimed(githubUserId: string): boolean;
    getGithubUserPdas(githubUserId: string): string[];
    pdaHasPriorTransactions(pda: string, beforeSignature: string): Promise<boolean>;
    pdaHasAnyTransactions(pda: string): Promise<boolean>;
    walletHasPriorSocialFeeClaims(wallet: string, beforeSignature: string): Promise<boolean>;
}

export type RepeatReason =
    | 'already-posted'
    | 'no-lifetime-data'
    | 'lifetime-exceeds-amount'
    | 'pda-has-prior-claim'
    | 'other-pda-has-history'
    | 'wallet-has-prior-claim';

export type FirstClaimVerdict =
    | { isFirstClaim: true }
    | {
        isFirstClaim: false;
        reason: RepeatReason;
        /** True when on-chain evidence proved a prior claim, so the user should be recorded as claimed. */
        provenRepeat: boolean;
    };

type SocialClaim = Pick<FeeClaimEvent,
    'txSignature' | 'amountLamports' | 'lifetimeClaimedLamports' | 'socialFeePda' | 'recipientWallet'>
    & { githubUserId: string };

function repeat(reason: RepeatReason, provenRepeat: boolean): FirstClaimVerdict {
    return { isFirstClaim: false, reason, provenRepeat };
}

export async function decideFirstClaim(event: SocialClaim, checks: FirstClaimChecks): Promise<FirstClaimVerdict> {
    const { githubUserId, txSignature, socialFeePda, recipientWallet } = event;

    if (checks.hasGithubUserClaimed(githubUserId)) return repeat('already-posted', false);

    if (event.lifetimeClaimedLamports == null || event.amountLamports <= 0) {
        return repeat('no-lifetime-data', false);
    }
    if (event.lifetimeClaimedLamports > event.amountLamports) return repeat('lifetime-exceeds-amount', true);

    if (!socialFeePda) return { isFirstClaim: true };

    if (await checks.pdaHasPriorTransactions(socialFeePda, txSignature)) return repeat('pda-has-prior-claim', true);

    for (const otherPda of checks.getGithubUserPdas(githubUserId)) {
        if (otherPda === socialFeePda) continue;
        if (await checks.pdaHasAnyTransactions(otherPda)) return repeat('other-pda-has-history', true);
    }

    if (recipientWallet && await checks.walletHasPriorSocialFeeClaims(recipientWallet, txSignature)) {
        return repeat('wallet-has-prior-claim', true);
    }

    return { isFirstClaim: true };
}
