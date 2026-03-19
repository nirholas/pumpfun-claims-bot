/**
 * PumpFun Channel Bot — Claim Tracker
 *
 * Tracks claim history per wallet+token to show "first claim"
 * vs "claim #N" and total claimed amounts in the channel feed.
 *
 * Persists wallet first-claim sets to disk so restarts don't
 * re-alert on already-seen wallets.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './logger.js';

export interface ClaimRecord {
    /** Total number of claims by this wallet for this token */
    claimCount: number;
    /** Total SOL claimed so far */
    totalClaimedSol: number;
    /** Timestamp of the first claim (unix seconds) */
    firstClaimTimestamp: number;
    /** Timestamp of the most recent claim (unix seconds) */
    lastClaimTimestamp: number;
    /** Price snapshot at claim time */
    claimPriceSol: number;
    claimPriceUsd: number;
    claimMcapUsd: number;
    claimCurveProgress: number;
}

/** Key: "wallet:mint" */
const claimHistory = new Map<string, ClaimRecord>();

/** Tracks which tokens have had ANY claim (key: mint) */
const tokenFirstClaim = new Set<string>();

/** Tracks which wallets have ever claimed (key: wallet address) */
const walletFirstClaim = new Set<string>();

/** Tracks which GitHub user IDs have ever claimed their social fee PDA */
const githubUserFirstClaim = new Set<string>();

/** Tracks which (githubUser, mint) pairs have been seen — key: "githubId:mint" */
const githubUserTokenClaims = new Set<string>();

/** Tracks how many times each GitHub user ID has claimed (persisted) */
const githubUserClaimCounts = new Map<string, number>();

/**
 * Tracks all PDA addresses ever seen for a GitHub user ID.
 * Key: githubUserId, Value: Set of PDA addresses.
 * Persisted so cross-PDA repeat detection survives restarts.
 */
const githubUserPdas = new Map<string, Set<string>>();

/** Max entries before eviction of oldest */
const MAX_ENTRIES = 50_000;

// ── Persistence ──────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const FIRST_CLAIMS_FILE = join(DATA_DIR, 'first-claims.json');
const WALLET_FIRST_CLAIMS_FILE = join(DATA_DIR, 'wallet-first-claims.json');
const GITHUB_FIRST_CLAIMS_FILE = join(DATA_DIR, 'github-first-claims.json');
const GITHUB_USER_TOKEN_CLAIMS_FILE = join(DATA_DIR, 'github-user-token-claims.json');
const GITHUB_CLAIM_COUNTS_FILE = join(DATA_DIR, 'github-claim-counts.json');
const GITHUB_USER_PDAS_FILE = join(DATA_DIR, 'github-user-pdas.json');
const SAVE_DEBOUNCE_MS = 5_000;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Load persisted first-claim sets from disk on startup. */
export function loadPersistedClaims(): void {
    try {
        if (!existsSync(DATA_DIR)) {
            mkdirSync(DATA_DIR, { recursive: true });
        }
        if (existsSync(FIRST_CLAIMS_FILE)) {
            const raw = readFileSync(FIRST_CLAIMS_FILE, 'utf8');
            const mints: unknown = JSON.parse(raw);
            if (Array.isArray(mints)) {
                for (const m of mints) {
                    if (typeof m === 'string') tokenFirstClaim.add(m);
                }
                log.info('Loaded %d persisted first-claim tokens', tokenFirstClaim.size);
            }
        }
        if (existsSync(WALLET_FIRST_CLAIMS_FILE)) {
            const raw = readFileSync(WALLET_FIRST_CLAIMS_FILE, 'utf8');
            const wallets: unknown = JSON.parse(raw);
            if (Array.isArray(wallets)) {
                for (const w of wallets) {
                    if (typeof w === 'string') walletFirstClaim.add(w);
                }
                log.info('Loaded %d persisted first-claim wallets', walletFirstClaim.size);
            }
        }
        if (existsSync(GITHUB_FIRST_CLAIMS_FILE)) {
            const raw = readFileSync(GITHUB_FIRST_CLAIMS_FILE, 'utf8');
            const users: unknown = JSON.parse(raw);
            if (Array.isArray(users)) {
                for (const u of users) {
                    if (typeof u === 'string') githubUserFirstClaim.add(u);
                }
                log.info('Loaded %d persisted first-claim GitHub users', githubUserFirstClaim.size);
            }
        }
        if (existsSync(GITHUB_USER_TOKEN_CLAIMS_FILE)) {
            const raw = readFileSync(GITHUB_USER_TOKEN_CLAIMS_FILE, 'utf8');
            const pairs: unknown = JSON.parse(raw);
            if (Array.isArray(pairs)) {
                for (const p of pairs) {
                    if (typeof p === 'string') githubUserTokenClaims.add(p);
                }
                log.info('Loaded %d persisted GitHub user+token claim pairs', githubUserTokenClaims.size);
            }
        }
        if (existsSync(GITHUB_CLAIM_COUNTS_FILE)) {
            const raw = readFileSync(GITHUB_CLAIM_COUNTS_FILE, 'utf8');
            const counts: unknown = JSON.parse(raw);
            if (counts && typeof counts === 'object') {
                for (const [k, v] of Object.entries(counts)) {
                    if (typeof v === 'number') githubUserClaimCounts.set(k, v);
                }
                log.info('Loaded %d persisted GitHub claim counts', githubUserClaimCounts.size);
            }
        }
        if (existsSync(GITHUB_USER_PDAS_FILE)) {
            const raw = readFileSync(GITHUB_USER_PDAS_FILE, 'utf8');
            const pdaMap: unknown = JSON.parse(raw);
            if (pdaMap && typeof pdaMap === 'object') {
                for (const [userId, pdas] of Object.entries(pdaMap)) {
                    if (Array.isArray(pdas)) {
                        const set = new Set<string>();
                        for (const p of pdas) { if (typeof p === 'string') set.add(p); }
                        if (set.size > 0) githubUserPdas.set(userId, set);
                    }
                }
                log.info('Loaded PDA history for %d GitHub users', githubUserPdas.size);
            }
        }
    } catch (err) {
        log.warn('Failed to load persisted claims: %s', err);
    }
}

/** Write all claim state to disk synchronously (called by scheduleSave and flushPersistedClaims). */
function doSave(): void {
    try {
        if (!existsSync(DATA_DIR)) {
            mkdirSync(DATA_DIR, { recursive: true });
        }
        const arr = [...tokenFirstClaim];
        const toSave = arr.length > MAX_ENTRIES ? arr.slice(arr.length - MAX_ENTRIES) : arr;
        writeFileSync(FIRST_CLAIMS_FILE, JSON.stringify(toSave), 'utf8');

        const walletArr = [...walletFirstClaim];
        const walletToSave = walletArr.length > MAX_ENTRIES ? walletArr.slice(walletArr.length - MAX_ENTRIES) : walletArr;
        writeFileSync(WALLET_FIRST_CLAIMS_FILE, JSON.stringify(walletToSave), 'utf8');

        const ghArr = [...githubUserFirstClaim];
        const ghToSave = ghArr.length > MAX_ENTRIES ? ghArr.slice(ghArr.length - MAX_ENTRIES) : ghArr;
        writeFileSync(GITHUB_FIRST_CLAIMS_FILE, JSON.stringify(ghToSave), 'utf8');

        const gutArr = [...githubUserTokenClaims];
        const gutToSave = gutArr.length > MAX_ENTRIES ? gutArr.slice(gutArr.length - MAX_ENTRIES) : gutArr;
        writeFileSync(GITHUB_USER_TOKEN_CLAIMS_FILE, JSON.stringify(gutToSave), 'utf8');

        const countsObj: Record<string, number> = {};
        for (const [k, v] of githubUserClaimCounts) countsObj[k] = v;
        writeFileSync(GITHUB_CLAIM_COUNTS_FILE, JSON.stringify(countsObj), 'utf8');

        const pdasObj: Record<string, string[]> = {};
        for (const [userId, pdaSet] of githubUserPdas) pdasObj[userId] = [...pdaSet];
        writeFileSync(GITHUB_USER_PDAS_FILE, JSON.stringify(pdasObj), 'utf8');

        log.debug('Persisted %d first-claim tokens + %d wallets + %d GitHub users + %d user-token pairs + %d user-PDA mappings to disk', toSave.length, walletToSave.length, ghToSave.length, gutToSave.length, githubUserPdas.size);
    } catch (err) {
        log.warn('Failed to persist claims: %s', err);
    }
}

/** Save first-claim sets to disk (debounced). */
function scheduleSave(): void {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        doSave();
    }, SAVE_DEBOUNCE_MS);
}

/**
 * Flush all claim state to disk immediately, bypassing the debounce.
 * Call this after successfully posting a first-claim so state survives
 * a deployment restart or crash within the debounce window.
 */
export function flushPersistedClaims(): void {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    doSave();
}

// ── Public API ───────────────────────────────────────────────────────────────

function makeKey(wallet: string, mint: string): string {
    return `${wallet}:${mint}`;
}

export interface ClaimPriceSnapshot {
    priceSol: number;
    priceUsd: number;
    mcapUsd: number;
    curveProgress: number;
}

/**
 * Record a new claim and return the updated record.
 * Returns the state AFTER recording (so claimCount=1 means first-ever claim).
 */
export function recordClaim(
    wallet: string,
    mint: string,
    amountSol: number,
    timestamp: number,
    priceSnapshot?: ClaimPriceSnapshot,
): ClaimRecord {
    const key = makeKey(wallet, mint);
    const existing = claimHistory.get(key);

    if (existing) {
        existing.claimCount++;
        existing.totalClaimedSol += amountSol;
        existing.lastClaimTimestamp = timestamp;
        return { ...existing };
    }

    const record: ClaimRecord = {
        claimCount: 1,
        totalClaimedSol: amountSol,
        firstClaimTimestamp: timestamp,
        lastClaimTimestamp: timestamp,
        claimPriceSol: priceSnapshot?.priceSol ?? 0,
        claimPriceUsd: priceSnapshot?.priceUsd ?? 0,
        claimMcapUsd: priceSnapshot?.mcapUsd ?? 0,
        claimCurveProgress: priceSnapshot?.curveProgress ?? 0,
    };
    claimHistory.set(key, record);

    // Evict oldest entries if over limit
    if (claimHistory.size > MAX_ENTRIES) {
        let oldest = '';
        let oldestTime = Infinity;
        for (const [k, v] of claimHistory) {
            if (v.lastClaimTimestamp < oldestTime) {
                oldestTime = v.lastClaimTimestamp;
                oldest = k;
            }
        }
        if (oldest) claimHistory.delete(oldest);
    }

    return { ...record };
}

/** Get claim history for a wallet+token without recording. */
export function getClaimRecord(wallet: string, mint: string): ClaimRecord | null {
    return claimHistory.get(makeKey(wallet, mint)) ?? null;
}

/**
 * Returns true if this is the first-ever claim on this token (any wallet).
 * Marks the token as claimed so subsequent calls return false.
 */
export function isFirstClaimOnToken(mint: string): boolean {
    if (tokenFirstClaim.has(mint)) return false;
    tokenFirstClaim.add(mint);
    scheduleSave();
    // Evict oldest if over limit
    if (tokenFirstClaim.size > MAX_ENTRIES) {
        const first = tokenFirstClaim.values().next().value;
        if (first) tokenFirstClaim.delete(first);
    }
    return true;
}

/**
 * Returns true if this is the first-ever claim by this wallet (any token).
 * Marks the wallet as seen so subsequent calls return false.
 */
export function isFirstClaimByWallet(wallet: string): boolean {
    if (walletFirstClaim.has(wallet)) return false;
    walletFirstClaim.add(wallet);
    scheduleSave();
    if (walletFirstClaim.size > MAX_ENTRIES) {
        const first = walletFirstClaim.values().next().value;
        if (first) walletFirstClaim.delete(first);
    }
    return true;
}

/**
 * Returns true if this is the first-ever claim by this GitHub user ID.
 * Marks the user as seen so subsequent calls return false.
 */
export function isFirstClaimByGithubUser(githubUserId: string): boolean {
    if (githubUserFirstClaim.has(githubUserId)) return false;
    githubUserFirstClaim.add(githubUserId);
    scheduleSave();
    if (githubUserFirstClaim.size > MAX_ENTRIES) {
        const first = githubUserFirstClaim.values().next().value;
        if (first) githubUserFirstClaim.delete(first);
    }
    return true;
}

/**
 * Check if this GitHub user has already claimed any social fee.
 * Always checks the bare user-level key first so cross-mint repeat claims
 * are caught even after a container restart (when per-mint keys may be gone).
 */
export function hasGithubUserClaimed(githubUserId: string, mint?: string): boolean {
    // user-level key: once set, any claim by this user is a repeat
    if (githubUserFirstClaim.has(githubUserId)) return true;
    if (mint) return githubUserFirstClaim.has(`${githubUserId}:${mint}`);
    return false;
}

/** Mark a GitHub user as having claimed. Always sets the bare user-level key
 * (so cross-mint repeats are caught after restarts) plus the per-mint key. */
export function markGithubUserClaimed(githubUserId: string, mint?: string): void {
    // Always mark at user level
    if (!githubUserFirstClaim.has(githubUserId)) {
        githubUserFirstClaim.add(githubUserId);
        if (githubUserFirstClaim.size > MAX_ENTRIES) {
            const first = githubUserFirstClaim.values().next().value;
            if (first) githubUserFirstClaim.delete(first);
        }
    }
    // Also mark per-mint for finer-grained history
    if (mint) {
        const key = `${githubUserId}:${mint}`;
        if (!githubUserFirstClaim.has(key)) {
            githubUserFirstClaim.add(key);
            if (githubUserFirstClaim.size > MAX_ENTRIES) {
                const first = githubUserFirstClaim.values().next().value;
                if (first) githubUserFirstClaim.delete(first);
            }
        }
    }
    scheduleSave();
}

/** Total unique wallet+token pairs tracked. */
export function getTrackedCount(): number {
    return claimHistory.size;
}

/** Increment and return the claim count for a GitHub user on a specific token. */
export function incrementGithubClaimCount(githubUserId: string, mint?: string): number {
    const key = mint ? `${githubUserId}:${mint}` : githubUserId;
    const count = (githubUserClaimCounts.get(key) ?? 0) + 1;
    githubUserClaimCounts.set(key, count);
    scheduleSave();
    return count;
}

/** Get the claim count for a GitHub user on a specific token without incrementing. */
export function getGithubClaimCount(githubUserId: string, mint?: string): number {
    const key = mint ? `${githubUserId}:${mint}` : githubUserId;
    return githubUserClaimCounts.get(key) ?? 0;
}

/**
 * Record that a GitHub user has a social fee PDA address.
 * Call this for EVERY claim_social_fee_pda event (first or repeat) so the
 * mapping accumulates over time and survives across sessions when storage persists.
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

/** Return all PDA addresses ever seen for a GitHub user ID. */
export function getGithubUserPdas(githubUserId: string): string[] {
    return [...(githubUserPdas.get(githubUserId) ?? [])];
}

/** Return all mints that a GitHub user has previously claimed fees from. */
export function getGithubUserClaimedMints(githubUserId: string): string[] {
    const prefix = `${githubUserId}:`;
    const mints: string[] = [];
    for (const key of githubUserFirstClaim) {
        if (key.startsWith(prefix)) {
            const val = key.slice(prefix.length);
            // Exclude PDA-stability keys (pda:...) — those aren't mint addresses
            if (!val.startsWith('pda:')) {
                mints.push(val);
            }
        }
    }
    return mints;
}

