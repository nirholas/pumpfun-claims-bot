/**
 * Tests for pump-client — PumpFun API client.
 *
 * Pure-function tests run without mocks.
 * API tests use vi.spyOn(global, 'fetch') to avoid real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    extractGithubUrls,
    formatSol,
    formatTokenAmount,
    fetchTokenInfo,
    fetchCreatorProfile,
    fetchSolUsdPrice,
    fetchTopHolders,
    fetchTokenTrades,
    fetchBundleInfo,
    fetchSameNameTokens,
} from '../pump-client.js';

// ── extractGithubUrls ────────────────────────────────────────────────────────

describe('extractGithubUrls', () => {
    it('extracts a single GitHub URL from text', () => {
        const result = extractGithubUrls('Check out https://github.com/owner/repo for code');
        expect(result).toEqual(['https://github.com/owner/repo']);
    });

    it('extracts multiple GitHub URLs and deduplicates', () => {
        const text = 'https://github.com/a/b and https://github.com/c/d and https://github.com/a/b again';
        const result = extractGithubUrls(text);
        expect(result).toEqual(['https://github.com/a/b', 'https://github.com/c/d']);
    });

    it('returns empty array for text with no GitHub URLs', () => {
        expect(extractGithubUrls('Visit https://gitlab.com/owner/repo')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
        expect(extractGithubUrls('')).toEqual([]);
    });

    it('extracts profile-only GitHub URLs (no repo)', () => {
        const result = extractGithubUrls('Follow https://github.com/someuser');
        expect(result).toEqual(['https://github.com/someuser']);
    });

    it('extracts GitHub URL with subdirectory path', () => {
        const result = extractGithubUrls('src: https://github.com/owner/repo/tree/main');
        // Regex stops at the repo segment
        expect(result[0]).toContain('github.com/owner/repo');
    });
});

// ── formatSol ────────────────────────────────────────────────────────────────

describe('formatSol', () => {
    it('formats >= 1000 SOL with no decimals', () => {
        expect(formatSol(1_500_000_000_000)).toBe('1500');
    });

    it('formats >= 1 SOL with 4 decimal places', () => {
        expect(formatSol(1_500_000_000)).toBe('1.5000');
    });

    it('formats >= 0.001 SOL with 6 decimal places', () => {
        expect(formatSol(5_000_000)).toBe('0.005000');
    });

    it('formats < 0.001 SOL with 9 decimal places', () => {
        expect(formatSol(1000)).toBe('0.000001000');
    });

    it('formats 0 lamports', () => {
        expect(formatSol(0)).toBe('0.000000000');
    });
});

// ── formatTokenAmount ────────────────────────────────────────────────────────

describe('formatTokenAmount', () => {
    it('formats millions', () => {
        // 5_000_000_000_000 raw / 10^6 decimals = 5_000_000 tokens → "5.00M"
        expect(formatTokenAmount(5_000_000_000_000)).toBe('5.00M');
    });

    it('formats thousands', () => {
        // 50_000_000_000 raw / 10^6 decimals = 50_000 tokens → "50.00K"
        expect(formatTokenAmount(50_000_000_000)).toBe('50.00K');
    });

    it('formats whole tokens', () => {
        expect(formatTokenAmount(5_000_000)).toBe('5.00');
    });

    it('formats fractional tokens', () => {
        expect(formatTokenAmount(500)).toBe('0.000500');
    });

    it('handles 1M token boundary', () => {
        const result = formatTokenAmount(1_000_000_000_000);
        expect(result).toContain('M');
    });
});

// ── fetchTokenInfo (mocked fetch) ────────────────────────────────────────────

describe('fetchTokenInfo', () => {
    beforeEach(() => { vi.spyOn(global, 'fetch'); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('returns token info on successful PumpFun response', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            mint: 'ABC123',
            name: 'TestToken',
            symbol: 'TT',
            description: 'A test token',
            image_uri: 'https://img.example.com/tt.png',
            banner_uri: '',
            creator: 'CreatorWallet',
            created_timestamp: 1_700_000_000_000,
            complete: false,
            usd_market_cap: 50_000,
            market_cap: 300,
            virtual_sol_reserves: 30_000_000_000,
            virtual_token_reserves: 500_000_000_000_000,
            total_supply: 1_000_000_000_000_000,
            real_sol_reserves: 25_000_000_000,
            reply_count: 10,
        }), { status: 200 }));

        const result = await fetchTokenInfo('ABC123');
        expect(result).not.toBeNull();
        expect(result?.name).toBe('TestToken');
        expect(result?.symbol).toBe('TT');
        expect(result?.mint).toBe('ABC123');
        expect(result?.usdMarketCap).toBe(50_000);
        expect(result?.complete).toBe(false);
    });

    it('returns null for 404', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
        // DexScreener fallback also returns null
        vi.mocked(fetch).mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

        const result = await fetchTokenInfo('NOTFOUND123');
        expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));
        vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

        const result = await fetchTokenInfo('ERR123');
        expect(result).toBeNull();
    });

    it('extracts GitHub URLs from token description', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            mint: 'GH123',
            name: 'GitHubToken',
            symbol: 'GHT',
            description: 'See https://github.com/owner/repo for details',
            image_uri: '',
            creator: 'Creator',
            created_timestamp: 0,
            complete: false,
            usd_market_cap: 0,
            virtual_sol_reserves: 0,
            virtual_token_reserves: 1,
            total_supply: 0,
            real_sol_reserves: 0,
        }), { status: 200 }));

        const result = await fetchTokenInfo('GH123');
        expect(result?.githubUrls).toContain('https://github.com/owner/repo');
    });

    it('normalises millisecond timestamps to seconds', async () => {
        const msTs = 1_700_000_000_000; // milliseconds
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            mint: 'TS123',
            name: 'TSToken',
            symbol: 'TS',
            description: '',
            created_timestamp: msTs,
            complete: false,
            usd_market_cap: 0,
            virtual_sol_reserves: 0,
            virtual_token_reserves: 1,
            total_supply: 0,
            real_sol_reserves: 0,
        }), { status: 200 }));

        const result = await fetchTokenInfo('TS123');
        // Should be in seconds (< 2e10), not milliseconds (> 1e12)
        expect(result?.createdTimestamp).toBeLessThan(2e10);
        expect(result?.createdTimestamp).toBe(Math.floor(msTs / 1000));
    });
});

// ── fetchCreatorProfile (mocked fetch) ───────────────────────────────────────

describe('fetchCreatorProfile', () => {
    beforeEach(() => { vi.spyOn(global, 'fetch'); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('returns profile with username and follower count', async () => {
        // First call: /users/ endpoint
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            username: 'cooldev',
            profile_image: 'https://img.pump.fun/avatar.png',
            followers: 1200,
        }), { status: 200 }));
        // Second call: /coins?creator= endpoint
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([
            { mint: 'M1', name: 'Coin1', symbol: 'C1', complete: true, usd_market_cap: 100_000 },
            { mint: 'M2', name: 'Coin2', symbol: 'C2', complete: false, usd_market_cap: 100 },
        ]), { status: 200 }));

        const result = await fetchCreatorProfile('WalletABC');
        expect(result.username).toBe('cooldev');
        expect(result.followers).toBe(1200);
        expect(result.totalLaunches).toBe(2);
        expect(result.recentCoins).toHaveLength(2);
    });

    it('estimates scam count for low-MC non-graduated coins', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            username: 'scammer',
            followers: 0,
        }), { status: 200 }));
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([
            { mint: 'S1', name: 'Scam1', symbol: 'SC1', complete: false, usd_market_cap: 100 },
            { mint: 'S2', name: 'Scam2', symbol: 'SC2', complete: false, usd_market_cap: 200 },
            { mint: 'OK', name: 'Legit', symbol: 'OK',  complete: true, usd_market_cap: 50_000 },
        ]), { status: 200 }));

        const result = await fetchCreatorProfile('ScammerWallet');
        // coins with !complete && mc < 500 → 2 scam estimates
        expect(result.scamEstimate).toBe(2);
        expect(result.totalLaunches).toBe(3);
    });

    it('returns default profile on API failure', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('timeout'));

        const result = await fetchCreatorProfile('BrokenWallet');
        expect(result.wallet).toBe('BrokenWallet');
        expect(result.username).toBe('');
        expect(result.totalLaunches).toBe(0);
    });
});

// ── fetchSolUsdPrice (mocked fetch) ──────────────────────────────────────────

describe('fetchSolUsdPrice', () => {
    beforeEach(() => { vi.spyOn(global, 'fetch'); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('returns price from Jupiter on success', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            data: {
                So11111111111111111111111111111111111111112: { price: '150.50' },
            },
        }), { status: 200 }));

        const price = await fetchSolUsdPrice();
        expect(price).toBeGreaterThan(0);
    });

    it('falls back to CoinGecko when Jupiter fails', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response('Error', { status: 500 }));
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            solana: { usd: 148.25 },
        }), { status: 200 }));

        const price = await fetchSolUsdPrice();
        expect(price).toBeGreaterThan(0);
    });

    it('falls back to Binance when Jupiter and CoinGecko fail', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response('Error', { status: 500 }));
        vi.mocked(fetch).mockResolvedValueOnce(new Response('Error', { status: 500 }));
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            price: '147.00',
        }), { status: 200 }));

        const price = await fetchSolUsdPrice();
        expect(price).toBeGreaterThan(0);
    });
});

// ── fetchTopHolders (mocked fetch) ───────────────────────────────────────────

describe('fetchTopHolders', () => {
    beforeEach(() => { vi.spyOn(global, 'fetch'); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('returns holder details on success', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            total: 500,
            holders: [
                { address: 'H1', percentage: 10.5, is_bonding_curve: false },
                { address: 'H2', percentage: 8.0, is_bonding_curve: false },
                { address: 'H3', percentage: 55.0, is_bonding_curve: true },
            ],
        }), { status: 200 }));

        const result = await fetchTopHolders('MINT123');
        expect(result.totalHolders).toBe(500);
        expect(result.topHolders).toHaveLength(3);
        // top10Pct excludes pool holder
        expect(result.top10Pct).toBeCloseTo(18.5);
    });

    it('returns empty result on API failure', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'));

        const result = await fetchTopHolders('MINT_ERR');
        expect(result.totalHolders).toBe(0);
        expect(result.topHolders).toHaveLength(0);
        expect(result.top10Pct).toBe(0);
    });
});

// ── fetchTokenTrades (mocked fetch) ──────────────────────────────────────────

describe('fetchTokenTrades', () => {
    beforeEach(() => { vi.spyOn(global, 'fetch'); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('aggregates buy/sell counts and volume', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([
            { is_buy: true,  sol_amount: 2_000_000_000 },
            { is_buy: true,  sol_amount: 1_000_000_000 },
            { is_buy: false, sol_amount: 500_000_000 },
        ]), { status: 200 }));

        const result = await fetchTokenTrades('MINT123');
        expect(result.recentTradeCount).toBe(3);
        expect(result.buyCount).toBe(2);
        expect(result.sellCount).toBe(1);
        expect(result.recentVolumeSol).toBeCloseTo(3.5);
    });

    it('returns zeros on API failure', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));

        const result = await fetchTokenTrades('MINT_ERR');
        expect(result.recentTradeCount).toBe(0);
        expect(result.buyCount).toBe(0);
    });
});

// ── fetchBundleInfo (mocked fetch) ───────────────────────────────────────────

describe('fetchBundleInfo', () => {
    beforeEach(() => { vi.spyOn(global, 'fetch'); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('detects a bundle when 2+ wallets buy in the first 2 seconds', async () => {
        const baseTs = 1_700_000_000;
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([
            { is_buy: true, timestamp: baseTs,     user: 'W1', token_amount: 10_000_000_000_000 },
            { is_buy: true, timestamp: baseTs + 1, user: 'W2', token_amount: 10_000_000_000_000 },
            { is_buy: true, timestamp: baseTs + 10, user: 'W3', token_amount: 5_000_000_000_000 },
        ]), { status: 200 }));

        const result = await fetchBundleInfo('BUNDLE_MINT');
        expect(result).not.toBeNull();
        expect(result?.bundleWallets).toBe(2);
        expect(result?.bundlePct).toBeGreaterThan(0);
    });

    it('returns null when only one wallet buys early', async () => {
        const baseTs = 1_700_000_000;
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([
            { is_buy: true, timestamp: baseTs,     user: 'W1', token_amount: 10_000_000_000_000 },
            { is_buy: true, timestamp: baseTs + 10, user: 'W2', token_amount: 5_000_000_000_000 },
        ]), { status: 200 }));

        const result = await fetchBundleInfo('NO_BUNDLE');
        expect(result).toBeNull();
    });

    it('returns null on API failure', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));
        const result = await fetchBundleInfo('ERR_MINT');
        expect(result).toBeNull();
    });
});

// ── fetchSameNameTokens (mocked fetch) ───────────────────────────────────────

describe('fetchSameNameTokens', () => {
    beforeEach(() => { vi.spyOn(global, 'fetch'); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('returns matching Solana tokens sorted by market cap', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            pairs: [
                {
                    chainId: 'solana',
                    baseToken: { address: 'OTHER1', name: 'PumpCoin', symbol: 'PUMP' },
                    marketCap: 200_000,
                    pairCreatedAt: Date.now() - 86400_000,
                    url: 'https://dexscreener.com/solana/OTHER1',
                },
                {
                    chainId: 'solana',
                    baseToken: { address: 'OTHER2', name: 'PumpCoin', symbol: 'PUMP' },
                    marketCap: 50_000,
                    pairCreatedAt: Date.now() - 3_600_000,
                    url: 'https://dexscreener.com/solana/OTHER2',
                },
                {
                    chainId: 'ethereum',
                    baseToken: { address: 'ETH1', name: 'PumpCoin', symbol: 'PUMP' },
                    marketCap: 1_000_000,
                    url: 'https://dexscreener.com/ethereum/ETH1',
                },
            ],
        }), { status: 200 }));

        const result = await fetchSameNameTokens('PumpCoin', 'PUMP', 'EXCLUDED_MINT');
        // Only Solana pairs, sorted by mc desc
        expect(result).toHaveLength(2);
        expect(result[0]!.usdMarketCap).toBe(200_000);
        expect(result[0]!.mint).toBe('OTHER1');
    });

    it('excludes the provided mint', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
            pairs: [
                {
                    chainId: 'solana',
                    baseToken: { address: 'SAME_MINT', name: 'PumpCoin', symbol: 'PUMP' },
                    marketCap: 100_000,
                    url: 'https://dexscreener.com/solana/SAME_MINT',
                },
            ],
        }), { status: 200 }));

        const result = await fetchSameNameTokens('PumpCoin', 'PUMP', 'SAME_MINT');
        expect(result).toHaveLength(0);
    });

    it('returns empty array on API failure', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));
        const result = await fetchSameNameTokens('Coin', 'COIN', 'SOME_MINT');
        expect(result).toEqual([]);
    });
});
