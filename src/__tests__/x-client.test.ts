/**
 * Tests for X/Twitter client — influencer tiers, follower formatting, labels.
 *
 * These test the pure utility functions which don't require API access.
 */

import { describe, it, expect } from 'vitest';
import {
    getInfluencerTier,
    formatFollowerCount,
    influencerLabel,
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
