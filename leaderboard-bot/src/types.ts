/**
 * PumpFun Leaderboard Bot — Types
 */

// ── Program IDs ───────────────────────────────────────────────────────────────

export const PUMP_FEE_PROGRAM_ID = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

// ── Discriminators ────────────────────────────────────────────────────────────

/** SocialFeePdaClaimed event (emitted as CPI log) */
export const SOCIAL_FEE_CLAIMED_DISC = '3212c141edd2eaec';
/** claim_social_fee_pda instruction discriminator */
export const CLAIM_SOCIAL_FEE_DISC = 'e115fb85a11ec7e2';

// ── Events ────────────────────────────────────────────────────────────────────

export interface SocialFeeClaimEvent {
    txSignature: string;
    slot: number;
    /** Unix seconds */
    timestamp: number;
    /** Wallet that signed the transaction */
    claimerWallet: string;
    /** GitHub numeric user ID (string for safety) */
    githubUserId: string;
    /** 2 = GitHub */
    socialPlatform: number;
    amountSol: number;
    amountLamports: number;
    /** Cumulative lifetime lamports from on-chain event */
    lifetimeClaimedLamports?: number;
    /** Social fee PDA account */
    socialFeePda?: string;
    /** True when instruction was called but no event emitted (fake/scam claim) */
    isFake: boolean;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export interface PeriodStats {
    totalSolEarned: number;
    claimCount: number;
    firstClaimAt: number;
    lastClaimAt: number;
    /** Unix seconds when this period started (for reset detection) */
    periodStart: number;
}

export interface UserStats {
    githubUserId: string;
    allTime: PeriodStats;
    daily: PeriodStats;
    weekly: PeriodStats;
    lastUpdated: number;
}

export interface RankedEntry {
    rank: number;
    previousRank: number | null;
    githubUserId: string;
    githubUsername: string;
    githubProfileUrl: string;
    githubFollowers: number;
    stats: PeriodStats;
}

export type LeaderboardPeriod = 'allTime' | 'daily' | 'weekly';

// ── Persistence ───────────────────────────────────────────────────────────────

export interface PersistedLeaderboard {
    version: number;
    users: Record<string, UserStats>;
    previousRanks: {
        allTime: Record<string, number>;
        daily: Record<string, number>;
        weekly: Record<string, number>;
    };
    savedAt: number;
}
