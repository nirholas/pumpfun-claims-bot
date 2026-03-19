/**
 * PumpFun Leaderboard Bot — Telegram Card Formatter
 *
 * Builds rich HTML-formatted leaderboard cards for Telegram.
 */

import type { GitHubUser } from './github-client.js';
import type { RankedEntry, LeaderboardPeriod, PeriodStats } from './types.js';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function fmtSol(sol: number): string {
    if (sol >= 1000) return `${(sol / 1000).toFixed(1)}K SOL`;
    if (sol >= 100) return `${sol.toFixed(1)} SOL`;
    return `${sol.toFixed(3)} SOL`;
}

function fmtUsd(sol: number, solUsd: number): string {
    const usd = sol * solUsd;
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
    if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
    return `$${usd.toFixed(0)}`;
}

function rankArrow(current: number, previous: number | null): string {
    if (previous === null) return '🆕';
    const diff = previous - current;
    if (diff > 0) return `↑${diff}`;
    if (diff < 0) return `↓${Math.abs(diff)}`;
    return '↔';
}

function periodLabel(period: LeaderboardPeriod, stats: PeriodStats): string {
    if (period === 'allTime') return 'All-Time';
    if (period === 'daily') {
        const d = new Date(stats.periodStart * 1000);
        return `Daily · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
    }
    // weekly
    const start = new Date(stats.periodStart * 1000);
    const end = new Date((stats.periodStart + 6 * 86400) * 1000);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `Weekly · ${fmt(start)}–${fmt(end)}`;
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface LeaderboardCardOptions {
    entries: RankedEntry[];
    profiles: Map<string, GitHubUser | null>;
    period: LeaderboardPeriod;
    solUsd: number;
    totalDevs: number;
    trackingSince: number;
}

export function buildLeaderboardCard(opts: LeaderboardCardOptions): string {
    const { entries, profiles, period, solUsd, totalDevs, trackingSince } = opts;
    if (!entries.length) {
        return '🏆 <b>PumpFun GitHub Dev Leaderboard</b>\n\nNo data yet — waiting for claims…';
    }

    const periodRef = entries[0]?.stats ?? entries[0]!.stats;
    const label = periodLabel(period, periodRef);

    const lines: string[] = [
        `🏆 <b>PumpFun GitHub Dev Leaderboard</b>`,
        `📅 <b>${label}</b>`,
        '',
    ];

    for (const entry of entries) {
        const profile = profiles.get(entry.githubUserId) ?? null;
        const username = profile?.login ?? entry.githubUsername;
        const profileUrl = profile?.htmlUrl ?? `https://github.com/${username}`;
        const displayName = escHtml(profile?.name || username || `ID:${entry.githubUserId}`);
        const medal = MEDAL[entry.rank] ?? `${entry.rank}.`;
        const arrow = rankArrow(entry.rank, entry.previousRank);
        const sol = fmtSol(entry.stats.totalSolEarned);
        const usd = solUsd > 0 ? ` (${fmtUsd(entry.stats.totalSolEarned, solUsd)})` : '';
        const claims = entry.stats.claimCount;
        const followers = profile ? ` · ${fmtFollowers(profile.followers)} followers` : '';

        lines.push(
            `${medal} <a href="${profileUrl}">${displayName}</a> ${arrow}`,
            `   <b>${sol}</b>${usd} · ${claims} claim${claims !== 1 ? 's' : ''}${followers}`,
        );
    }

    lines.push('');
    const since = new Date(trackingSince * 1000).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
    lines.push(
        `<i>Top ${entries.length} of ${totalDevs} developer${totalDevs !== 1 ? 's' : ''} · tracking since ${since}</i>`,
    );

    if (solUsd > 0) {
        lines.push(`<i>SOL price: $${solUsd.toFixed(2)}</i>`);
    }

    return lines.join('\n');
}

function fmtFollowers(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

/** Fetch current SOL/USD price from CoinGecko (free, no key needed). */
export async function fetchSolPrice(): Promise<number> {
    try {
        const resp = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
            { signal: AbortSignal.timeout(5_000) },
        );
        if (!resp.ok) return 0;
        const data = (await resp.json()) as { solana?: { usd?: number } };
        return data.solana?.usd ?? 0;
    } catch {
        return 0;
    }
}
