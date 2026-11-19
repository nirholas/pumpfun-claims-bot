/**
 * PumpFun Channel Bot — Claim Tracker
 *
 * Remembers which GitHub users this bot has already seen claim, so a repeat
 * claim is never announced as a first one, plus per-coin claim counts and every
 * social fee PDA seen for a user (for cross-PDA repeat detection).
 *
 * State is persisted to DATA_DIR so a restart does not re-alert on users who
 * were already posted. Each structure keeps its most recent MAX_ENTRIES keys.
 */

import { BoundedMap, BoundedSet } from './bounded.js';
import { log } from './logger.js';
import { asStringArray, dataFile, objectEntries, readJsonFile, writeJsonFileAtomic } from './persistence.js';

/** Max keys kept per structure (in memory and on disk). */
const MAX_ENTRIES = 50_000;
const SAVE_DEBOUNCE_MS = 5_000;

const FILES = {
    githubFirstClaims: 'github-first-claims.json',
    githubClaimCounts: 'github-claim-counts.json',
    githubUserPdas: 'github-user-pdas.json',
} as const;

/**
 * GitHub user ids that have claimed (key: "<id>"), plus finer keys for the
 * coins ("<id>:<mint>") and fee PDAs ("<id>:pda:<address>") they claimed from.
 */
const githubUserFirstClaim = new BoundedSet<string>(MAX_ENTRIES);

/** Claims seen per GitHub user and coin (key: "<id>:<mint>", or "<id>" when the coin is unknown). */
const githubUserClaimCounts = new BoundedMap<string, number>(MAX_ENTRIES);

/** Every social fee PDA seen for a GitHub user id. */
const githubUserPdas = new BoundedMap<string, Set<string>>(MAX_ENTRIES);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ── Persistence ──────────────────────────────────────────────────────────────

/** Read one state file, logging (not throwing) when it is unreadable so the other files still load. */
function readStateFile(name: string): unknown {
    try {
        return readJsonFile(dataFile(name));
    } catch (err) {
        log.error('Claim tracker: %s — starting this file empty', err instanceof Error ? err.message : err);
        return undefined;
    }
}

/** Load persisted claim state from DATA_DIR. Missing files are not an error. */
export function loadPersistedClaims(): void {
    for (const key of asStringArray(readStateFile(FILES.githubFirstClaims))) {
        githubUserFirstClaim.add(key);
    }
    for (const [key, count] of objectEntries(readStateFile(FILES.githubClaimCounts))) {
        if (typeof count === 'number' && Number.isFinite(count)) githubUserClaimCounts.set(key, count);
    }
    for (const [userId, pdas] of objectEntries(readStateFile(FILES.githubUserPdas))) {
        const set = new Set(asStringArray(pdas));
        if (set.size > 0) githubUserPdas.set(userId, set);
    }
    log.info('Loaded claim state: %d GitHub claim keys, %d claim counts, PDA history for %d users',
        githubUserFirstClaim.size, githubUserClaimCounts.size, githubUserPdas.size);
}

function doSave(): void {
    try {
        writeJsonFileAtomic(dataFile(FILES.githubFirstClaims), [...githubUserFirstClaim.values()]);
        writeJsonFileAtomic(dataFile(FILES.githubClaimCounts), Object.fromEntries(githubUserClaimCounts));
        const pdas: Record<string, string[]> = {};
        for (const [userId, set] of githubUserPdas) pdas[userId] = [...set];
        writeJsonFileAtomic(dataFile(FILES.githubUserPdas), pdas);
    } catch (err) {
        log.error('Claim tracker: failed to persist claim state: %s', err);
    }
}

function scheduleSave(): void {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        doSave();
    }, SAVE_DEBOUNCE_MS);
}

/**
 * Write all claim state to disk now, bypassing the debounce. Called after a
 * first claim is posted and on shutdown, so a restart cannot re-post it.
 */
export function flushPersistedClaims(): void {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    doSave();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * True when this GitHub user has been recorded as claiming. The bare user key
 * is checked first, so a claim on any coin makes every later claim a repeat.
 */
export function hasGithubUserClaimed(githubUserId: string, mint?: string): boolean {
    if (githubUserFirstClaim.has(githubUserId)) return true;
    if (mint) return githubUserFirstClaim.has(`${githubUserId}:${mint}`);
    return false;
}

/** Record that a GitHub user has claimed: always the user key, plus `<id>:<mint>` when a mint is given. */
export function markGithubUserClaimed(githubUserId: string, mint?: string): void {
    githubUserFirstClaim.add(githubUserId);
    if (mint) githubUserFirstClaim.add(`${githubUserId}:${mint}`);
    scheduleSave();
}

/** Increment and return the claim count for a GitHub user on a coin. */
export function incrementGithubClaimCount(githubUserId: string, mint?: string): number {
    const key = mint ? `${githubUserId}:${mint}` : githubUserId;
    const count = (githubUserClaimCounts.get(key) ?? 0) + 1;
    githubUserClaimCounts.set(key, count);
    scheduleSave();
    return count;
}

/** The claim count for a GitHub user on one coin (or with no coin), without incrementing. */
export function getGithubClaimCount(githubUserId: string, mint?: string): number {
    return githubUserClaimCounts.get(mint ? `${githubUserId}:${mint}` : githubUserId) ?? 0;
}

/** Claims recorded for a GitHub user across every coin. */
export function getGithubTotalClaimCount(githubUserId: string): number {
    const prefix = `${githubUserId}:`;
    let total = 0;
    for (const [key, count] of githubUserClaimCounts) {
        if (key === githubUserId || key.startsWith(prefix)) total += count;
    }
    return total;
}

/**
 * Record a social fee PDA for a GitHub user. Called for every social claim
 * (first or repeat) so cross-PDA repeat detection survives restarts.
 */
export function addGithubUserPda(githubUserId: string, pdaAddress: string): void {
    let set = githubUserPdas.get(githubUserId);
    if (!set) {
        set = new Set();
        githubUserPdas.set(githubUserId, set);
    }
    if (!set.has(pdaAddress)) {
        set.add(pdaAddress);
        scheduleSave();
    }
}

/** Every social fee PDA seen for a GitHub user id. */
export function getGithubUserPdas(githubUserId: string): string[] {
    return [...(githubUserPdas.get(githubUserId) ?? [])];
}

/** Every coin a GitHub user has been recorded claiming from. */
export function getGithubUserClaimedMints(githubUserId: string): string[] {
    const prefix = `${githubUserId}:`;
    const mints: string[] = [];
    for (const key of githubUserFirstClaim.values()) {
        if (!key.startsWith(prefix)) continue;
        const value = key.slice(prefix.length);
        // PDA-stability keys ("<id>:pda:<address>") are not coins.
        if (value && !value.startsWith('pda:')) mints.push(value);
    }
    return mints;
}
