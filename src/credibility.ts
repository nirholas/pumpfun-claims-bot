/**
 * Credibility scoring — turns the scattered trust signals the bot already
 * fetches (GitHub identity, claimed repo, creator history, holder spread,
 * copycats, bundling) into one deterministic 0-100 verdict with a visible
 * factor breakdown.
 *
 * Design goals:
 *  - Deterministic: same inputs → same score. No AI, no network, no clock
 *    dependence beyond account-age math. Reproducible and testable.
 *  - Transparent: every point is attributed to a named factor, so a reader
 *    can see *why* a token scored the way it did rather than trusting a
 *    black box.
 *  - Conservative: the baseline is a neutral 50. Legitimacy has to be earned
 *    (verified claim, aged account, real starred repo) and risk is penalised
 *    hard (fresh account, copycat, bundle, rug history).
 */

import type { GitHubUserInfo, GitHubRepoInfo } from './github-client.js';
import type {
    CreatorProfile,
    HolderDetails,
    BundleInfo,
    SameNameToken,
    TokenInfo,
} from './pump-client.js';

export type CredibilityTier = 'strong' | 'moderate' | 'caution' | 'high-risk';

export interface CredibilityFactor {
    /** Short human-readable reason, e.g. "GitHub 12y" or "copycat at $4M". */
    label: string;
    /** Signed point contribution. Positive = trust, negative = risk. */
    delta: number;
}

export interface CredibilityResult {
    /** Final score clamped to [0, 100]. */
    score: number;
    tier: CredibilityTier;
    /** All contributing factors, sorted by magnitude (largest first). */
    factors: CredibilityFactor[];
}

export interface CredibilityInput {
    githubUser?: GitHubUserInfo | null;
    repoInfo?: GitHubRepoInfo | null;
    creatorProfile?: CreatorProfile | null;
    holders?: HolderDetails | null;
    bundle?: BundleInfo | null;
    sameNameTokens?: SameNameToken[] | null;
    tokenInfo?: TokenInfo | null;
    /**
     * Injectable clock for deterministic tests. Milliseconds since epoch.
     * Defaults to Date.now().
     */
    now?: number;
}

export const TIER_META: Record<CredibilityTier, { emoji: string; label: string }> = {
    strong: { emoji: '🟢', label: 'Strong' },
    moderate: { emoji: '🟡', label: 'Moderate' },
    caution: { emoji: '🟠', label: 'Caution' },
    'high-risk': { emoji: '🔴', label: 'High Risk' },
};

const BASELINE = 50;

export function tierFor(score: number): CredibilityTier {
    if (score >= 75) return 'strong';
    if (score >= 55) return 'moderate';
    if (score >= 35) return 'caution';
    return 'high-risk';
}

/** Compact number for factor labels: 1200 → "1.2k", 3_400_000 → "3.4M". */
function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(Math.round(n));
}

/** Extract the owner login from the first GitHub URL on the token, if any. */
function tokenGithubOwner(tokenInfo: TokenInfo | null | undefined): string | null {
    const urls = tokenInfo?.githubUrls ?? [];
    if (urls.length === 0) return null;
    const owner = urls[0]!
        .replace(/^https?:\/\/github\.com\//i, '')
        .replace(/\/+$/, '')
        .split('/')[0]
        ?.toLowerCase();
    return owner || null;
}

/**
 * Compute a credibility verdict from the enrichment the bot already gathers.
 * Pure function — safe to call anywhere, trivially testable.
 */
export function scoreCredibility(input: CredibilityInput): CredibilityResult {
    const { githubUser, repoInfo, creatorProfile, holders, bundle, sameNameTokens, tokenInfo } = input;
    const now = input.now ?? Date.now();

    const factors: CredibilityFactor[] = [];
    const add = (label: string, delta: number): void => {
        if (delta !== 0) factors.push({ label, delta });
    };

    // ── 1. Claim verification: does the token's own GitHub link match the
    //       wallet that claimed the social fee? The single strongest legitimacy
    //       signal (or, when mismatched, the strongest red flag). ──
    if (githubUser) {
        const owner = tokenGithubOwner(tokenInfo);
        if (owner) {
            if (owner === githubUser.login.toLowerCase()) add('claim verified', +22);
            else add(`GitHub mismatch (${owner})`, -20);
        } else if (tokenInfo) {
            add('no GitHub link', -6);
        }
    }

    // ── 2. GitHub account age. Fresh accounts are the hallmark of throwaway
    //       fee-farming; multi-year accounts are expensive to fake. ──
    if (githubUser?.createdAt) {
        const ageMs = now - new Date(githubUser.createdAt).getTime();
        const ageDays = ageMs / 86_400_000;
        const years = Math.floor(ageDays / 365);
        if (ageDays < 30) add(`new account (${Math.max(0, Math.floor(ageDays))}d)`, -18);
        else if (years >= 5) add(`GitHub ${years}y`, +14);
        else if (years >= 2) add(`GitHub ${years}y`, +9);
        else if (years >= 1) add(`GitHub ${years}y`, +4);
    }

    // ── 3. Public repos — a real developer has a body of work. ──
    if (githubUser) {
        const r = githubUser.publicRepos;
        if (r === 0) add('0 repos', -12);
        else if (r >= 30) add(`${r} repos`, +8);
        else if (r >= 10) add(`${r} repos`, +5);
        else if (r >= 3) add(`${r} repos`, +2);
    }

    // ── 4. Followers — social proof, weighted lightly (easy to game). ──
    if (githubUser) {
        const f = githubUser.followers;
        if (f >= 1_000) add(`${compact(f)} followers`, +6);
        else if (f >= 100) add(`${f} followers`, +3);
        else if (f >= 20) add(`${f} followers`, +1);
    }

    // ── 5. Claimed repo quality — a starred, non-fork repo is real work;
    //       a fork of someone else's project is a common impersonation trick. ──
    if (repoInfo) {
        if (repoInfo.stars >= 500) add(`repo ${compact(repoInfo.stars)}★`, +12);
        else if (repoInfo.stars >= 50) add(`repo ${repoInfo.stars}★`, +7);
        else if (repoInfo.stars >= 5) add(`repo ${repoInfo.stars}★`, +3);
        if (repoInfo.isFork) add('repo is a fork', -8);
    }

    // ── 6. Profile completeness — bio/company/blog/hireable humanise a real
    //       account. Small weight; corroborating, not decisive. ──
    if (githubUser) {
        let human = 0;
        if (githubUser.bio) human++;
        if (githubUser.company) human++;
        if (githubUser.blog) human++;
        if (githubUser.hireable) human++;
        if (human >= 3) add('detailed profile', +3);
        else if (human >= 1) add('has profile', +1);
    }

    // ── 7. Copycat — a same-name token at a much higher market cap means this
    //       is likely a clone riding a known name. ──
    if (sameNameTokens && sameNameTokens.length > 0 && tokenInfo && tokenInfo.usdMarketCap > 0) {
        const top = sameNameTokens[0]!;
        if (top.usdMarketCap > tokenInfo.usdMarketCap * 20) {
            add(`copycat at $${compact(top.usdMarketCap)}`, -16);
        } else if (top.usdMarketCap > tokenInfo.usdMarketCap * 5) {
            add(`copycat at $${compact(top.usdMarketCap)}`, -10);
        }
    }

    // ── 8. Bundling — coordinated first-slot buys signal an insider setup. ──
    if (bundle && bundle.bundlePct > 0) {
        if (bundle.bundlePct >= 20) add(`bundled ${bundle.bundlePct.toFixed(0)}%`, -14);
        else if (bundle.bundlePct >= 5) add(`bundled ${bundle.bundlePct.toFixed(0)}%`, -7);
    }

    // ── 9. Holder concentration — a handful of wallets holding most of supply
    //       is dump risk. ──
    if (holders && holders.top10Pct > 0) {
        if (holders.top10Pct >= 60) add(`top10 ${holders.top10Pct.toFixed(0)}%`, -12);
        else if (holders.top10Pct >= 40) add(`top10 ${holders.top10Pct.toFixed(0)}%`, -6);
    }

    // ── 10. Creator rug history — prior near-zero-MC launches from the same
    //        wallet, and serial launching, both drag trust down. ──
    if (creatorProfile) {
        if (creatorProfile.scamEstimate >= 1) {
            const penalty = Math.min(creatorProfile.scamEstimate * 6, 24);
            add(`${creatorProfile.scamEstimate} prior rugs`, -penalty);
        }
        if (creatorProfile.totalLaunches >= 20) add(`${creatorProfile.totalLaunches} launches`, -4);
    }

    // ── 11. Hard flags. ──
    if (tokenInfo?.isBanned) add('BANNED', -35);
    if (tokenInfo?.isNsfw) add('NSFW', -4);

    const raw = BASELINE + factors.reduce((sum, f) => sum + f.delta, 0);
    const score = Math.max(0, Math.min(100, Math.round(raw)));
    factors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return { score, tier: tierFor(score), factors };
}
