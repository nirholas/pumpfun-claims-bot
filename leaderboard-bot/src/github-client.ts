/**
 * PumpFun Leaderboard Bot — GitHub API Client
 */

import { log } from './logger.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const CACHE_TTL = 600_000; // 10 minutes

export interface GitHubUser {
    id: number;
    login: string;
    name: string | null;
    bio: string | null;
    htmlUrl: string;
    avatarUrl: string;
    publicRepos: number;
    followers: number;
    following: number;
    location: string | null;
    blog: string | null;
    twitterUsername: string | null;
    createdAt: string;
}

interface CacheEntry<T> { data: T; expiresAt: number; }
const userByLogin = new Map<string, CacheEntry<GitHubUser | null>>();
const userById = new Map<string, CacheEntry<GitHubUser | null>>();

function authHeaders(): Record<string, string> {
    const h: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (GITHUB_TOKEN) h['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    return h;
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
    const e = cache.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) { cache.delete(key); return undefined; }
    return e.data;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T, ttl = CACHE_TTL): void {
    cache.set(key, { data, expiresAt: Date.now() + ttl });
    if (cache.size > 500) {
        const now = Date.now();
        for (const [k, v] of cache) { if (now > v.expiresAt) cache.delete(k); }
    }
}

function parseUser(raw: Record<string, unknown>): GitHubUser {
    return {
        id: Number(raw.id),
        login: String(raw.login ?? ''),
        name: raw.name ? String(raw.name) : null,
        bio: raw.bio ? String(raw.bio) : null,
        htmlUrl: String(raw.html_url ?? ''),
        avatarUrl: String(raw.avatar_url ?? ''),
        publicRepos: Number(raw.public_repos ?? 0),
        followers: Number(raw.followers ?? 0),
        following: Number(raw.following ?? 0),
        location: raw.location ? String(raw.location) : null,
        blog: raw.blog ? String(raw.blog) : null,
        twitterUsername: raw.twitter_username ? String(raw.twitter_username) : null,
        createdAt: String(raw.created_at ?? ''),
    };
}

export async function fetchGitHubUser(login: string): Promise<GitHubUser | null> {
    const key = login.toLowerCase();
    const cached = getCached(userByLogin, key);
    if (cached !== undefined) return cached;

    try {
        const resp = await fetch(`${GITHUB_API}/users/${encodeURIComponent(login)}`, {
            headers: authHeaders(),
            signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) {
            const ttl = resp.status === 404 ? CACHE_TTL : 30_000;
            if (resp.status === 403 || resp.status === 429) {
                log.warn('GitHub rate limited for user %s', login);
            }
            setCache(userByLogin, key, null, ttl);
            return null;
        }
        const user = parseUser((await resp.json()) as Record<string, unknown>);
        setCache(userByLogin, key, user);
        setCache(userById, String(user.id), user);
        return user;
    } catch (err) {
        log.error('GitHub user fetch failed for %s: %s', login, err);
        return null;
    }
}

/** Resolve a numeric GitHub user ID to a full profile. */
export async function fetchGitHubUserById(userId: string): Promise<GitHubUser | null> {
    const cached = getCached(userById, userId);
    if (cached !== undefined) return cached;

    const numId = Number(userId);
    if (!Number.isInteger(numId) || numId <= 0) return null;

    try {
        const since = Math.max(0, numId - 1);
        const resp = await fetch(`${GITHUB_API}/users?since=${since}&per_page=100`, {
            headers: authHeaders(),
            signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) { setCache(userById, userId, null, 30_000); return null; }

        const list = (await resp.json()) as Array<Record<string, unknown>>;
        const match = list.find((u) => Number(u.id) === numId);
        if (!match?.login) {
            log.warn('GitHub: user ID %s not found in list window', userId);
            setCache(userById, userId, null, 60_000);
            return null;
        }
        return await fetchGitHubUser(String(match.login));
    } catch (err) {
        log.error('GitHub ID lookup failed for %s: %s', userId, err);
        return null;
    }
}

/** Fetch multiple users by ID concurrently with a concurrency cap. */
export async function fetchGitHubUsersBatch(
    userIds: string[],
    concurrency = 3,
): Promise<Map<string, GitHubUser | null>> {
    const results = new Map<string, GitHubUser | null>();
    const chunks: string[][] = [];
    for (let i = 0; i < userIds.length; i += concurrency) {
        chunks.push(userIds.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
        const settled = await Promise.allSettled(chunk.map((id) => fetchGitHubUserById(id)));
        settled.forEach((result, idx) => {
            const id = chunk[idx]!;
            results.set(id, result.status === 'fulfilled' ? result.value : null);
        });
    }
    return results;
}
