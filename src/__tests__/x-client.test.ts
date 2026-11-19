/**
 * Tests for X/Twitter client — influencer tiers, follower formatting, labels.
 *
 * Profile fetches run against a stubbed fetch; nothing reaches x.com.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
    getInfluencerTier,
    formatFollowerCount,
    influencerLabel,
    isXCommunityUrl,
    parseXHandle,
    type InfluencerTier,
} from '../x-client.js';

// ── getInfluencerTier ────────────────────────────────────────────────────────

describe('getInfluencerTier', () => {
    it('returns mega for X followers >= 100K', () => {
        expect(getInfluencerTier(0, 100_000)).toBe('mega');
        expect(getInfluencerTier(0, 500_000)).toBe('mega');
    });

    it('returns mega for GitHub followers >= 10K', () => {
        expect(getInfluencerTier(10_000, 0)).toBe('mega');
        expect(getInfluencerTier(50_000, null)).toBe('mega');
    });

    it('returns influencer for X followers >= 10K', () => {
        expect(getInfluencerTier(0, 10_000)).toBe('influencer');
        expect(getInfluencerTier(0, 50_000)).toBe('influencer');
    });

    it('returns influencer for GitHub followers >= 1K', () => {
        expect(getInfluencerTier(1_000, 0)).toBe('influencer');
        expect(getInfluencerTier(5_000, null)).toBe('influencer');
    });

    it('returns notable for X followers >= 1K', () => {
        expect(getInfluencerTier(0, 1_000)).toBe('notable');
        expect(getInfluencerTier(0, 5_000)).toBe('notable');
    });

    it('returns notable for GitHub followers >= 100', () => {
        expect(getInfluencerTier(100, 0)).toBe('notable');
        expect(getInfluencerTier(500, null)).toBe('notable');
    });

    it('returns null for below all thresholds', () => {
        expect(getInfluencerTier(0, 0)).toBeNull();
        expect(getInfluencerTier(50, 500)).toBeNull();
        expect(getInfluencerTier(99, 999)).toBeNull();
    });

    it('returns null when xFollowers is null and github is low', () => {
        expect(getInfluencerTier(50, null)).toBeNull();
    });

    it('picks highest tier when both signals qualify', () => {
        // GitHub = influencer (1K), X = mega (200K) → mega wins
        expect(getInfluencerTier(1_000, 200_000)).toBe('mega');
    });
});

// ── formatFollowerCount ──────────────────────────────────────────────────────

describe('formatFollowerCount', () => {
    it('formats millions', () => {
        expect(formatFollowerCount(1_000_000)).toBe('1.0M');
        expect(formatFollowerCount(2_500_000)).toBe('2.5M');
    });

    it('formats thousands', () => {
        expect(formatFollowerCount(1_000)).toBe('1.0K');
        expect(formatFollowerCount(12_345)).toBe('12.3K');
    });

    it('formats hundreds as plain numbers', () => {
        expect(formatFollowerCount(500)).toBe('500');
        expect(formatFollowerCount(0)).toBe('0');
        expect(formatFollowerCount(999)).toBe('999');
    });
});

// ── influencerLabel ──────────────────────────────────────────────────────────

describe('influencerLabel', () => {
    it('returns MEGA INFLUENCER label', () => {
        expect(influencerLabel('mega')).toContain('MEGA INFLUENCER');
    });

    it('returns Influencer label', () => {
        expect(influencerLabel('influencer')).toContain('Influencer');
    });

    it('returns Notable label', () => {
        expect(influencerLabel('notable')).toContain('Notable');
    });

    it('returns empty string for null tier', () => {
        expect(influencerLabel(null)).toBe('');
    });
});

// ── parseXHandle / fetchXProfile ─────────────────────────────────────────────

describe('parseXHandle', () => {
    it.each([
        ['https://x.com/pumpdev', 'pumpdev'],
        ['https://twitter.com/pump_dev/status/123', 'pump_dev'],
        ['https://www.x.com/PumpDev?s=20', 'PumpDev'],
        ['@pumpdev', 'pumpdev'],
        ['pumpdev', 'pumpdev'],
    ])('reads %s', (input, handle) => {
        expect(parseXHandle(input)).toBe(handle);
    });

    it.each([
        'https://evil.example/x.com/pumpdev',
        'https://x.com/i/communities/123',
        'https://x.com/home',
        'https://x.com/',
        'this_handle_is_far_too_long',
        'bad handle',
        '',
        null,
    ])('rejects %j', (input) => {
        expect(parseXHandle(input)).toBeNull();
    });

    it('recognises community links separately', () => {
        expect(isXCommunityUrl('https://x.com/i/communities/123')).toBe(true);
        expect(isXCommunityUrl('https://x.com/pumpdev')).toBe(false);
    });
});

describe('fetchXProfile', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('X_AUTH_TOKEN', 'test-cookie');
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.unstubAllEnvs();
    });

    it('parses the GraphQL profile and makes no request for a non-handle', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                data: { user: { result: { is_blue_verified: true, legacy: {
                    screen_name: 'PumpDev', name: 'Pump Dev', followers_count: 12_345, friends_count: '10', statuses_count: 'junk',
                } } } },
            }),
        });
        globalThis.fetch = fetchMock;
        const { fetchXProfile } = await import('../x-client.js');

        await expect(fetchXProfile('https://evil.example/x.com/a')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();

        const profile = await fetchXProfile('https://x.com/pumpdev/status/1');
        expect(profile).toMatchObject({
            username: 'PumpDev', name: 'Pump Dev', followers: 12_345, following: 10, tweetCount: 0,
            verified: true, url: 'https://x.com/PumpDev',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('treats an unavailable user as missing', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ data: { user: { result: { __typename: 'UserUnavailable' } } } }),
        });
        const { fetchXProfile } = await import('../x-client.js');
        await expect(fetchXProfile('gone_user')).resolves.toBeNull();
    });
});
