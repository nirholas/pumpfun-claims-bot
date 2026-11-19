/**
 * Dev reputation — a persistent track record per GitHub developer.
 *
 * The credibility score judges a single claim in isolation. This turns that
 * into memory: every score the bot assigns is recorded against the claiming
 * GitHub user id, so the next time that dev launches a token the card can show
 * "3 prior tokens · avg 🔴 24/100" — exposing a serial fee-farmer whose newest
 * coin looks clean on its own, and crediting a builder with a real history.
 *
 * Keyed by the stable numeric GitHub user id (the same key claim-tracker uses),
 * persisted to DATA_DIR/dev-reputation.json, and deduped by token mint so a
 * re-seen claim never double-counts.
 */

import { log } from './logger.js';
import { tierFor, type CredibilityTier } from './credibility.js';
import { dataFile, objectEntries, readJsonFile, writeJsonFileAtomic } from './persistence.js';

const REP_FILE = 'dev-reputation.json';
const SAVE_DEBOUNCE_MS = 3_000;

interface DevRecord {
    /** Unix ms of the first claim we recorded for this dev. */
    firstSeen: number;
    /** Distinct token mints announced for this dev. */
    mints: string[];
    /** Credibility score per mint — index-aligned with `mints`. */
    scores: number[];
}

/** githubUserId (string) → record. */
const reps = new Map<string, DevRecord>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export interface DevReputation {
    /** Number of distinct prior tokens (excludes the current one). */
    priorTokens: number;
    /** Mean credibility across prior tokens, rounded. */
    avgScore: number;
    /** Tier of the average, for a colour/label. */
    tier: CredibilityTier;
    best: number;
    worst: number;
}

export function loadDevReputation(): void {
    let raw: unknown;
    try {
        raw = readJsonFile(dataFile(REP_FILE));
    } catch (err) {
        log.error('dev-reputation: %s — starting empty', err instanceof Error ? err.message : err);
        return;
    }
    for (const [userId, value] of objectEntries(raw)) {
        const fields = new Map(objectEntries(value));
        const mints = fields.get('mints');
        const scores = fields.get('scores');
        if (!Array.isArray(mints) || !Array.isArray(scores)) continue;
        reps.set(userId, {
            firstSeen: Number(fields.get('firstSeen')) || 0,
            mints: mints.map(String),
            scores: scores.map(Number),
        });
    }
    if (reps.size > 0) log.info('Loaded dev-reputation for %d devs', reps.size);
}

function scheduleFlush(): void {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        flushDevReputation();
    }, SAVE_DEBOUNCE_MS);
}

export function flushDevReputation(): void {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    try {
        writeJsonFileAtomic(dataFile(REP_FILE), Object.fromEntries(reps));
    } catch (err) {
        log.warn('dev-reputation flush failed: %s', err);
    }
}

/**
 * The dev's track record BEFORE the current claim (currentMint excluded), or
 * null if this is the first token we've tracked from them.
 */
export function getReputation(
    userId: string | number | null | undefined,
    currentMint: string,
): DevReputation | null {
    if (userId == null) return null;
    const rec = reps.get(String(userId));
    if (!rec) return null;
    const priorScores: number[] = [];
    for (let i = 0; i < rec.mints.length; i++) {
        if (rec.mints[i] !== currentMint) priorScores.push(rec.scores[i] ?? 0);
    }
    if (priorScores.length === 0) return null;
    const avg = Math.round(priorScores.reduce((a, b) => a + b, 0) / priorScores.length);
    return {
        priorTokens: priorScores.length,
        avgScore: avg,
        tier: tierFor(avg),
        best: Math.max(...priorScores),
        worst: Math.min(...priorScores),
    };
}

/**
 * Record this claim's credibility score against the dev. Deduped by mint (a
 * re-seen mint updates its score rather than adding a duplicate).
 */
export function recordClaim(
    userId: string | number | null | undefined,
    mint: string,
    score: number,
): void {
    if (userId == null || !mint) return;
    const key = String(userId);
    let rec = reps.get(key);
    if (!rec) {
        rec = { firstSeen: Date.now(), mints: [], scores: [] };
        reps.set(key, rec);
    }
    const idx = rec.mints.indexOf(mint);
    if (idx >= 0) rec.scores[idx] = score;
    else {
        rec.mints.push(mint);
        rec.scores.push(score);
    }
    scheduleFlush();
}

/** Test-only: reset in-memory state and any pending flush. */
export function _resetDevReputation(): void {
    reps.clear();
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
}
