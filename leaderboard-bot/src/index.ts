/**
 * PumpFun Leaderboard Bot — Entry Point
 *
 * Wires together: claim monitor → leaderboard aggregation → scheduled Telegram posts.
 */

import { Bot } from 'grammy';
import { loadConfig } from './config.js';
import { log, setLogLevel } from './logger.js';
import { ClaimMonitor } from './claim-monitor.js';
import { Leaderboard } from './leaderboard.js';
import { Scheduler } from './scheduler.js';
import { fetchGitHubUsersBatch } from './github-client.js';
import { buildLeaderboardCard, fetchSolPrice } from './formatter.js';
import type { LeaderboardPeriod, RankedEntry } from './types.js';

// ── Boot ──────────────────────────────────────────────────────────────────────

const config = loadConfig();
setLogLevel(config.logLevel);

log.info('PumpFun Leaderboard Bot starting…');
log.info('Schedule: %s at %02d:00 UTC | Top %d | Min %.3f SOL',
    config.schedule, config.postHour, config.topN, config.minSol);

// ── State ─────────────────────────────────────────────────────────────────────

const leaderboard = new Leaderboard(config.dataDir);
leaderboard.load();

const trackingSince = Math.floor(Date.now() / 1000);

// ── Telegram ──────────────────────────────────────────────────────────────────

const bot = new Bot(config.telegramToken);

async function postLeaderboard(period: LeaderboardPeriod): Promise<void> {
    log.info('Building leaderboard for period: %s', period);

    const sorted = leaderboard.getSortedUsers(period, config.minSol);
    const topUsers = sorted.slice(0, config.topN);

    // Fetch GitHub profiles for top users
    const userIds = topUsers.map((u) => u.githubUserId);
    const profiles = await fetchGitHubUsersBatch(userIds, 3);

    // Fetch current SOL price
    const solUsd = await fetchSolPrice();

    // Build ranked entries
    const entries: RankedEntry[] = topUsers.map((u, i) => ({
        rank: i + 1,
        previousRank: leaderboard.getPreviousRank(u.githubUserId, period),
        githubUserId: u.githubUserId,
        githubUsername: profiles.get(u.githubUserId)?.login ?? `id:${u.githubUserId}`,
        githubProfileUrl: profiles.get(u.githubUserId)?.htmlUrl ?? `https://github.com`,
        githubFollowers: profiles.get(u.githubUserId)?.followers ?? 0,
        stats: u[period],
    }));

    const text = buildLeaderboardCard({
        entries,
        profiles,
        period,
        solUsd,
        totalDevs: sorted.length,
        trackingSince,
    });

    try {
        await bot.api.sendMessage(config.channelId, text, { parse_mode: 'HTML' });
        log.info('Leaderboard posted (%s) — %d entries', period, entries.length);
    } catch (err) {
        log.error('Failed to post leaderboard: %s', err);
        throw err;
    }

    // Snapshot ranks AFTER posting so next post can show movement
    leaderboard.snapshotRanks(period);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

const scheduler = new Scheduler({
    schedule: config.schedule,
    postHour: config.postHour,
    onPost: postLeaderboard,
});

// ── Claim Monitor ─────────────────────────────────────────────────────────────

const monitor = new ClaimMonitor(config, (event) => {
    if (event.isFake) return;
    leaderboard.recordClaim(event);
    log.debug(
        'Claim recorded: GitHub ID %s earned %.4f SOL (tx %s)',
        event.githubUserId,
        event.amountSol,
        event.txSignature.slice(0, 8),
    );
});

// ── Start ─────────────────────────────────────────────────────────────────────

await monitor.start();
scheduler.start();

log.info('Bot running. Watching for PumpFun social fee claims…');

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

function shutdown(): void {
    log.info('Shutting down…');
    monitor.stop();
    scheduler.stop();
    leaderboard.saveSync();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
