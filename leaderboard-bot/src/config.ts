/**
 * PumpFun Leaderboard Bot — Configuration
 */

import 'dotenv/config';

export interface LeaderboardConfig {
    telegramToken: string;
    channelId: string;
    solanaRpcUrl: string;
    solanaRpcUrls: string[];
    solanaWsUrl?: string;
    pollIntervalSeconds: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** daily | weekly | both */
    schedule: 'daily' | 'weekly' | 'both';
    /** UTC hour (0-23) to post the leaderboard */
    postHour: number;
    /** Number of developers to display */
    topN: number;
    /** Minimum all-time SOL earned to appear on the board */
    minSol: number;
    dataDir: string;
}

export function loadConfig(): LeaderboardConfig {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!telegramToken) throw new Error('TELEGRAM_BOT_TOKEN is required');

    const channelId = process.env.CHANNEL_ID;
    if (!channelId) throw new Error('CHANNEL_ID is required');

    const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    try { new URL(solanaRpcUrl); } catch {
        throw new Error(`Invalid SOLANA_RPC_URL: ${solanaRpcUrl}`);
    }

    const extraUrls = process.env.SOLANA_RPC_URLS
        ? process.env.SOLANA_RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const solanaRpcUrls = [solanaRpcUrl, ...extraUrls.filter((u) => u !== solanaRpcUrl)];

    let solanaWsUrl = process.env.SOLANA_WS_URL;
    if (!solanaWsUrl) {
        try {
            const u = new URL(solanaRpcUrl);
            u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
            solanaWsUrl = u.toString();
        } catch { /* leave undefined */ }
    }

    const VALID_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
    const rawLevel = process.env.LOG_LEVEL || 'info';
    const logLevel = VALID_LEVELS.includes(rawLevel as typeof VALID_LEVELS[number])
        ? (rawLevel as LeaderboardConfig['logLevel'])
        : 'info';

    const rawSchedule = process.env.LEADERBOARD_SCHEDULE || 'daily';
    const schedule = (['daily', 'weekly', 'both'] as const).includes(rawSchedule as 'daily')
        ? (rawSchedule as LeaderboardConfig['schedule'])
        : 'daily';

    const postHour = Math.max(0, Math.min(23, Number.parseInt(process.env.LEADERBOARD_HOUR || '12', 10)));
    const topN = Math.max(1, Math.min(25, Number.parseInt(process.env.LEADERBOARD_TOP_N || '10', 10)));
    const minSol = Number.parseFloat(process.env.LEADERBOARD_MIN_SOL || '0');
    const pollIntervalSeconds = Math.max(10, Number.parseInt(process.env.POLL_INTERVAL_SECONDS || '30', 10));
    const dataDir = process.env.DATA_DIR || './data';

    return {
        telegramToken,
        channelId,
        solanaRpcUrl,
        solanaRpcUrls,
        solanaWsUrl,
        pollIntervalSeconds,
        logLevel,
        schedule,
        postHour,
        topN,
        minSol,
        dataDir,
    };
}
