/**
 * PumpFun Leaderboard Bot — Leaderboard Aggregation Engine
 *
 * Maintains per-user all-time, daily, and weekly SOL earnings.
 * Persists state to disk and resets period stats on schedule.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { log } from './logger.js';
import type {
    SocialFeeClaimEvent,
    UserStats,
    PeriodStats,
    PersistedLeaderboard,
    LeaderboardPeriod,
} from './types.js';

const SAVE_DEBOUNCE_MS = 5_000;
const FILE_VERSION = 1;

function emptyPeriod(periodStart: number): PeriodStats {
    return { totalSolEarned: 0, claimCount: 0, firstClaimAt: 0, lastClaimAt: 0, periodStart };
}

/** UTC midnight timestamp for a given date */
function utcDayStart(ts: number): number {
    const d = new Date(ts * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
}

/** Most recent Sunday UTC midnight */
function utcWeekStart(ts: number): number {
    const d = new Date(ts * 1000);
    const dayOfWeek = d.getUTCDay(); // 0=Sun
    const sunday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dayOfWeek) / 1000;
    return sunday;
}

export class Leaderboard {
    private users = new Map<string, UserStats>();
    private previousRanks: {
        allTime: Map<string, number>;
        daily: Map<string, number>;
        weekly: Map<string, number>;
    } = {
        allTime: new Map(),
        daily: new Map(),
        weekly: new Map(),
    };
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly dataFile: string;

    constructor(private dataDir: string) {
        this.dataFile = join(dataDir, 'leaderboard.json');
    }

    load(): void {
        try {
            if (!existsSync(this.dataFile)) return;
            const raw = JSON.parse(readFileSync(this.dataFile, 'utf8')) as PersistedLeaderboard;
            if (raw.version !== FILE_VERSION) {
                log.warn('Leaderboard: version mismatch, starting fresh');
                return;
            }
            for (const [id, stats] of Object.entries(raw.users)) {
                this.users.set(id, stats);
            }
            for (const [id, rank] of Object.entries(raw.previousRanks.allTime)) {
                this.previousRanks.allTime.set(id, rank);
            }
            for (const [id, rank] of Object.entries(raw.previousRanks.daily)) {
                this.previousRanks.daily.set(id, rank);
            }
            for (const [id, rank] of Object.entries(raw.previousRanks.weekly)) {
                this.previousRanks.weekly.set(id, rank);
            }
            log.info('Leaderboard: loaded %d users from disk', this.users.size);
        } catch (err) {
            log.warn('Leaderboard: failed to load state: %s', err);
        }
    }

    recordClaim(event: SocialFeeClaimEvent): void {
        if (event.isFake) return;

        const now = event.timestamp;
        const dayStart = utcDayStart(now);
        const weekStart = utcWeekStart(now);

        let user = this.users.get(event.githubUserId);
        if (!user) {
            user = {
                githubUserId: event.githubUserId,
                allTime: emptyPeriod(now),
                daily: emptyPeriod(dayStart),
                weekly: emptyPeriod(weekStart),
                lastUpdated: now,
            };
            this.users.set(event.githubUserId, user);
        }

        // Reset daily if period has rolled over
        if (user.daily.periodStart < dayStart) {
            user.daily = emptyPeriod(dayStart);
        }
        // Reset weekly if period has rolled over
        if (user.weekly.periodStart < weekStart) {
            user.weekly = emptyPeriod(weekStart);
        }

        const sol = event.amountSol;
        this.updatePeriod(user.allTime, sol, now);
        this.updatePeriod(user.daily, sol, now);
        this.updatePeriod(user.weekly, sol, now);
        user.lastUpdated = now;

        this.scheduleSave();
    }

    private updatePeriod(p: PeriodStats, sol: number, ts: number): void {
        p.totalSolEarned += sol;
        p.claimCount++;
        if (!p.firstClaimAt || ts < p.firstClaimAt) p.firstClaimAt = ts;
        if (ts > p.lastClaimAt) p.lastClaimAt = ts;
    }

    /**
     * Snapshot current ranks as "previous" before posting a new leaderboard.
     * Call this immediately before posting so the NEXT post can show rank changes.
     */
    snapshotRanks(period: LeaderboardPeriod): void {
        const sorted = this.getSortedUsers(period);
        const map = this.previousRanks[period];
        map.clear();
        sorted.forEach((u, i) => map.set(u.githubUserId, i + 1));
        this.saveSync(); // flush immediately
    }

    getSortedUsers(period: LeaderboardPeriod, minSol = 0): UserStats[] {
        return [...this.users.values()]
            .filter((u) => u.allTime.totalSolEarned >= minSol)
            .sort((a, b) => b[period].totalSolEarned - a[period].totalSolEarned)
            .filter((u) => u[period].totalSolEarned > 0);
    }

    getPreviousRank(userId: string, period: LeaderboardPeriod): number | null {
        return this.previousRanks[period].get(userId) ?? null;
    }

    get userCount(): number { return this.users.size; }

    // ── Persistence ───────────────────────────────────────────────────────────

    private scheduleSave(): void {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveSync();
        }, SAVE_DEBOUNCE_MS);
    }

    saveSync(): void {
        try {
            if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
            const payload: PersistedLeaderboard = {
                version: FILE_VERSION,
                users: Object.fromEntries(this.users.entries()),
                previousRanks: {
                    allTime: Object.fromEntries(this.previousRanks.allTime.entries()),
                    daily: Object.fromEntries(this.previousRanks.daily.entries()),
                    weekly: Object.fromEntries(this.previousRanks.weekly.entries()),
                },
                savedAt: Math.floor(Date.now() / 1000),
            };
            writeFileSync(this.dataFile, JSON.stringify(payload), 'utf8');
        } catch (err) {
            log.warn('Leaderboard: failed to save: %s', err);
        }
    }
}
