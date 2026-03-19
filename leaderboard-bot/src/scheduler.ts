/**
 * PumpFun Leaderboard Bot — Scheduler
 *
 * Fires callbacks at configured UTC times:
 *   - daily: once per day at postHour UTC
 *   - weekly: every Sunday at postHour UTC
 *   - both: daily + weekly
 */

import { log } from './logger.js';
import type { LeaderboardPeriod } from './types.js';

export interface SchedulerOptions {
    schedule: 'daily' | 'weekly' | 'both';
    postHour: number; // 0-23 UTC
    onPost: (period: LeaderboardPeriod) => Promise<void>;
}

export class Scheduler {
    private timer?: ReturnType<typeof setInterval>;
    private lastDailyDay = -1;
    private lastWeeklyWeek = -1;

    constructor(private opts: SchedulerOptions) {}

    start(): void {
        log.info('Scheduler: %s at %02d:00 UTC', this.opts.schedule, this.opts.postHour);
        // Check every minute
        this.timer = setInterval(() => void this.tick(), 60_000);
        void this.tick(); // check immediately on start
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    }

    private async tick(): Promise<void> {
        const now = new Date();
        const hour = now.getUTCHours();
        const minute = now.getUTCMinutes();
        const dayOfYear = utcDayOfYear(now);
        const weekOfYear = utcWeekOfYear(now);
        const dayOfWeek = now.getUTCDay(); // 0 = Sunday

        if (hour !== this.opts.postHour || minute !== 0) return;

        const { schedule, onPost } = this.opts;

        if ((schedule === 'daily' || schedule === 'both') && dayOfYear !== this.lastDailyDay) {
            this.lastDailyDay = dayOfYear;
            log.info('Scheduler: firing daily leaderboard post');
            try { await onPost('daily'); } catch (e) { log.error('Daily post failed: %s', e); }
        }

        if ((schedule === 'weekly' || schedule === 'both') && dayOfWeek === 0 && weekOfYear !== this.lastWeeklyWeek) {
            this.lastWeeklyWeek = weekOfYear;
            log.info('Scheduler: firing weekly leaderboard post');
            try { await onPost('weekly'); } catch (e) { log.error('Weekly post failed: %s', e); }
        }
    }
}

function utcDayOfYear(d: Date): number {
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const diff = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start;
    return Math.floor(diff / 86_400_000);
}

function utcWeekOfYear(d: Date): number {
    const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const days = Math.floor((d.getTime() - jan1.getTime()) / 86_400_000);
    return Math.ceil((days + jan1.getUTCDay() + 1) / 7);
}
