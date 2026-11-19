/**
 * PumpFun Channel Bot — Pump API Client
 *
 * Fetches token info, creator profiles, and past launches
 * from the PumpFun public HTTP API for rich channel feed messages.
 */

import { TtlCache } from './bounded.js';
import { asArray, asRecord, bool, num, optStr, str, type JsonRecord } from './json-fields.js';
import { log } from './logger.js';
import { WSOL_MINT } from './types.js';

const PUMPFUN_API = 'https://frontend-api-v3.pump.fun';
const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_DECIMALS = 6;
const ONE_TOKEN = 10 ** TOKEN_DECIMALS;

// ============================================================================
// Types
// ============================================================================

export interface TokenInfo {
    mint: string;
    name: string;
    symbol: string;
    description: string;
    imageUri: string;
    bannerUri: string;
    creator: string;
    createdTimestamp: number;
    complete: boolean;
    usdMarketCap: number;
    marketCapSol: number;
    priceSol: number;
    curveProgress: number;
    /** All-time high USD market cap */
    athMarketCap: number;
    /** Timestamp (seconds) when ATH was reached */
    athTimestamp: number;
    /** Timestamp (seconds) when token hit King of the Hill */
    kothTimestamp: number;
    /** Timestamp (seconds) of last trade */
    lastTradeTimestamp: number;
    /** Timestamp (seconds) of last community reply */
    lastReplyTimestamp: number;
    /** Number of community replies */
    replyCount: number;
    /** PumpSwap AMM pool address (if graduated) */
    pumpSwapPool: string;
    /** Which program: "pump" or "pumpswap" */
    program: string;
    /** Flags */
    isCashbackEnabled: boolean;
    isNsfw: boolean;
    isBanned: boolean;
    isHackathon: boolean;
    website?: string;
    twitter?: string;
    telegram?: string;
    githubUrls: string[];
}

export interface TokenTradeInfo {
    recentTradeCount: number;
    recentVolumeSol: number;
    buyCount: number;
    sellCount: number;
}

export interface CreatorProfile {
    wallet: string;
    /** PumpFun display username (from /users/ endpoint) */
    username: string;
    /** Profile image URL */
    profileImage: string;
    /** Number of followers */
    followers: number;
    /** Number of tokens this creator has launched */
    totalLaunches: number;
    /** Estimated scam/rug count — non-graduated coins with near-zero MC */
    scamEstimate: number;
    /** Names of recent coins created */
    recentCoins: Array<{ name: string; symbol: string; mint: string; complete: boolean; usdMarketCap: number }>;
}

// ============================================================================
// Cache
// ============================================================================

const tokenCache = new TtlCache<string, TokenInfo>(500, 30_000);
const creatorCache = new TtlCache<string, CreatorProfile>(500, 120_000);

// ============================================================================
// API Calls
// ============================================================================

/** Fetch token info: PumpFun API (primary) → DexScreener (fallback). */
export async function fetchTokenInfo(mint: string): Promise<TokenInfo | null> {
    const cached = tokenCache.get(mint);
    if (cached) return cached;

    const info = await fetchTokenInfoPump(mint) ?? await fetchTokenInfoDexScreener(mint);
    if (info) tokenCache.set(mint, info);
    return info;
}

/** Primary: PumpFun public API. */
async function fetchTokenInfoPump(mint: string): Promise<TokenInfo | null> {
    try {
        const resp = await fetch(`${PUMPFUN_API}/coins/${encodeURIComponent(mint)}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
            if (resp.status === 404) return null;
            log.warn('PumpFun API %d for mint %s', resp.status, mint.slice(0, 8));
            return null;
        }

        const raw = asRecord(await resp.json());

        const virtualSolReserves = num(raw.virtual_sol_reserves);
        const virtualTokenReserves = num(raw.virtual_token_reserves);
        const totalSupply = num(raw.total_supply);
        const complete = bool(raw.complete);

        const priceSol =
            virtualTokenReserves > 0 ? virtualSolReserves / virtualTokenReserves : 0;
        const marketCapSol =
            virtualTokenReserves > 0
                ? (virtualSolReserves * totalSupply) / (virtualTokenReserves * LAMPORTS_PER_SOL)
                : 0;

        // Bonding curve progress: realSolReserves / ~85 SOL threshold
        const realSolReserves = num(raw.real_sol_reserves) / LAMPORTS_PER_SOL;
        const curveProgress = complete ? 100 : Math.min(99, (realSolReserves / 85) * 100);

        const description = str(raw.description);
        const website = str(raw.website);
        const twitter = str(raw.twitter);
        const telegram = str(raw.telegram);
        const metadataUri = str(raw.metadata_uri ?? raw.uri);

        // Extract GitHub URLs from ALL fields: description, website, socials, metadata
        const githubUrls = extractGithubUrls(
            [description, website, twitter, telegram, metadataUri].join(' '),
        );
        // A website on github.com (www. or no scheme) that the text scan did not catch
        const websiteRepo = githubUrlFromWebsite(website);
        if (websiteRepo && !githubUrls.includes(websiteRepo)) githubUrls.push(websiteRepo);

        return {
            mint: str(raw.mint, mint),
            name: str(raw.name, 'Unknown'),
            symbol: str(raw.symbol, '???'),
            description,
            imageUri: str(raw.image_uri),
            bannerUri: str(raw.banner_uri),
            creator: str(raw.creator),
            // Timestamps from the API are ms; normalised to seconds.
            createdTimestamp: toSeconds(raw.created_timestamp),
            complete,
            usdMarketCap: num(raw.usd_market_cap),
            marketCapSol: num(raw.market_cap, marketCapSol),
            priceSol,
            curveProgress,
            athMarketCap: num(raw.ath_market_cap),
            athTimestamp: toSeconds(raw.ath_market_cap_timestamp),
            kothTimestamp: toSeconds(raw.king_of_the_hill_timestamp),
            lastTradeTimestamp: toSeconds(raw.last_trade_timestamp),
            lastReplyTimestamp: toSeconds(raw.last_reply),
            replyCount: num(raw.reply_count),
            pumpSwapPool: str(raw.pump_swap_pool),
            program: str(raw.program, 'pump'),
            isCashbackEnabled: bool(raw.is_cashback_enabled),
            isNsfw: bool(raw.nsfw),
            isBanned: bool(raw.is_banned),
            isHackathon: bool(raw.is_hackathon),
            website: website || undefined,
            twitter: twitter || undefined,
            telegram: telegram || undefined,
            githubUrls,
        };
    } catch (err) {
        log.warn('PumpFun fetch failed for %s: %s', mint.slice(0, 8), err);
        return null;
    }
}

/** Fallback: DexScreener API (partial data — no description/creator/GitHub URLs). */
async function fetchTokenInfoDexScreener(mint: string): Promise<TokenInfo | null> {
    try {
        const resp = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`,
            { signal: AbortSignal.timeout(8_000) },
        );
        if (!resp.ok) return null;

        const pairs = asArray(asRecord(await resp.json()).pairs);
        if (pairs.length === 0) return null;
        const pair = asRecord(pairs[0]);
        const base = asRecord(pair.baseToken);
        const info = asRecord(pair.info);
        const socials = asArray(info.socials).map(asRecord);
        const socialUrl = (type: string) => optStr(socials.find((s) => s.type === type)?.url);

        log.debug('DexScreener fallback used for %s', mint.slice(0, 8));

        return {
            mint,
            name: str(base.name, 'Unknown'),
            symbol: str(base.symbol, '???'),
            description: '',
            imageUri: str(info.imageUrl),
            bannerUri: '',
            creator: '',
            createdTimestamp: toSeconds(pair.pairCreatedAt),
            complete: true,
            usdMarketCap: num(pair.marketCap ?? pair.fdv),
            marketCapSol: 0,
            priceSol: num(pair.priceNative),
            curveProgress: 100,
            athMarketCap: 0,
            athTimestamp: 0,
            kothTimestamp: 0,
            lastTradeTimestamp: 0,
            lastReplyTimestamp: 0,
            replyCount: 0,
            pumpSwapPool: '',
            program: 'pump',
            isCashbackEnabled: false,
            isNsfw: false,
            isBanned: false,
            isHackathon: false,
            website: optStr(asRecord(asArray(info.websites)[0]).url),
            twitter: socialUrl('twitter'),
            telegram: socialUrl('telegram'),
            githubUrls: [],
        };
    } catch (err) {
        log.debug('DexScreener fallback failed for %s: %s', mint.slice(0, 8), err);
        return null;
    }
}

/**
 * Fetch creator profile — how many coins they've launched and recent ones.
 * Uses the PumpFun coins endpoint filtered by creator address.
 */
export async function fetchCreatorProfile(wallet: string): Promise<CreatorProfile> {
    const cached = creatorCache.get(wallet);
    if (cached) return cached;

    const profile: CreatorProfile = {
        wallet,
        username: '',
        profileImage: '',
        followers: 0,
        totalLaunches: 0,
        scamEstimate: 0,
        recentCoins: [],
    };

    // Fetch user profile (username, avatar, followers)
    try {
        const userResp = await fetch(
            `${PUMPFUN_API}/users/${encodeURIComponent(wallet)}`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) },
        );
        if (userResp.ok) {
            const user = asRecord(await userResp.json());
            profile.username = str(user.username);
            profile.profileImage = str(user.profile_image);
            profile.followers = num(user.followers);
        }
    } catch (err) {
        log.debug('User profile fetch failed for %s: %s', wallet.slice(0, 8), err);
    }

    // Fetch coins created by this wallet
    try {
        const coinsResp = await fetch(
            `${PUMPFUN_API}/coins?creator=${encodeURIComponent(wallet)}&limit=50&offset=0&includeNsfw=true`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
        );
        if (coinsResp.ok) {
            const coins = asArray(await coinsResp.json()).map(asRecord);
            profile.totalLaunches = coins.length;
            // Estimate scams/rugs: non-graduated coins with very low market cap
            profile.scamEstimate = coins.filter((c) => !bool(c.complete) && num(c.usd_market_cap) < 500).length;
            profile.recentCoins = coins.slice(0, 5).map((c) => ({
                mint: str(c.mint),
                name: str(c.name, 'Unknown'),
                symbol: str(c.symbol, '???'),
                complete: bool(c.complete),
                usdMarketCap: num(c.usd_market_cap),
            }));
        }
    } catch (err) {
        log.debug('Creator coins fetch failed for %s: %s', wallet.slice(0, 8), err);
    }

    creatorCache.set(wallet, profile);
    return profile;
}

// ============================================================================
// Helpers
// ============================================================================

/** A unix timestamp in seconds, from seconds or milliseconds; 0 when absent. */
function toSeconds(value: unknown): number {
    const ts = num(value);
    return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

export function formatSol(lamports: number): string {
    const val = lamports / LAMPORTS_PER_SOL;
    if (val >= 1000) return val.toFixed(0);
    if (val >= 1) return val.toFixed(4);
    if (val >= 0.001) return val.toFixed(6);
    return val.toFixed(9);
}

export function formatTokenAmount(raw: number): string {
    const val = raw / ONE_TOKEN;
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
    if (val >= 1) return val.toFixed(2);
    return val.toFixed(6);
}

// ============================================================================
// GitHub URL Extraction
// ============================================================================

const GITHUB_RE = /https?:\/\/github\.com\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?/gi;

/**
 * The website as a canonical https://github.com/<owner>[/<repo>] URL when it
 * is hosted on github.com (with or without www. or a scheme), else null.
 * A website that merely mentions github.com somewhere is not a GitHub link.
 */
export function githubUrlFromWebsite(website: string): string | null {
    const value = website.trim();
    if (!value) return null;
    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
        return null;
    }
    if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) return null;
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    if (!owner || !/^[A-Za-z0-9_.-]+$/.test(owner)) return null;
    return repo && /^[A-Za-z0-9_.-]+$/.test(repo) ? `https://github.com/${owner}/${repo}` : `https://github.com/${owner}`;
}

/** Extract GitHub URLs from token description or metadata. */
export function extractGithubUrls(text: string): string[] {
    if (!text) return [];
    const matches = text.match(GITHUB_RE);
    if (!matches) return [];
    // Deduplicate
    return [...new Set(matches)];
}

// ============================================================================
// Recent Trades / Volume
// ============================================================================

/** Fetch recent trade activity for a token. */
export async function fetchTokenTrades(mint: string): Promise<TokenTradeInfo> {
    const result: TokenTradeInfo = { recentTradeCount: 0, recentVolumeSol: 0, buyCount: 0, sellCount: 0 };
    try {
        const resp = await fetch(
            `${PUMPFUN_API}/coins/${encodeURIComponent(mint)}/trades?limit=50&offset=0`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) },
        );
        if (resp.ok) {
            const trades = asArray(await resp.json()).map(asRecord);
            result.recentTradeCount = trades.length;
            for (const t of trades) {
                result.recentVolumeSol += num(t.sol_amount) / LAMPORTS_PER_SOL;
                if (bool(t.is_buy)) result.buyCount++;
                else result.sellCount++;
            }
        }
    } catch (err) {
        log.debug('Trades fetch failed for %s: %s', mint.slice(0, 8), err);
    }
    return result;
}

// ============================================================================
// SOL/USD Price
// ============================================================================

let cachedSolPrice = 0;
let solPriceExpiresAt = 0;

/** Fetch SOL/USD price: Jupiter (primary) → CoinGecko → Binance. */
export async function fetchSolUsdPrice(): Promise<number> {
    if (cachedSolPrice > 0 && Date.now() < solPriceExpiresAt) return cachedSolPrice;

    const price =
        (await fetchSolPriceJupiter()) ||
        (await fetchSolPriceCoinGecko()) ||
        (await fetchSolPriceBinance());

    if (price > 0) {
        cachedSolPrice = price;
        solPriceExpiresAt = Date.now() + 60_000;
    }
    return cachedSolPrice;
}

/** Jupiter Price API v2 — primary SOL/USD source. */
async function fetchSolPriceJupiter(): Promise<number> {
    try {
        const resp = await fetch(
            `https://api.jup.ag/price/v2?ids=${WSOL_MINT}`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) },
        );
        if (!resp.ok) return 0;
        return num(asRecord(asRecord(asRecord(await resp.json()).data)[WSOL_MINT]).price);
    } catch {
        return 0;
    }
}

/** CoinGecko free API — first SOL/USD fallback. */
async function fetchSolPriceCoinGecko(): Promise<number> {
    try {
        const resp = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
            { signal: AbortSignal.timeout(5_000) },
        );
        if (!resp.ok) return 0;
        const price = num(asRecord(asRecord(await resp.json()).solana).usd);
        if (price > 0) log.debug('SOL price from CoinGecko fallback: $%d', price);
        return price;
    } catch {
        return 0;
    }
}

/** Binance public API — second SOL/USD fallback. */
async function fetchSolPriceBinance(): Promise<number> {
    try {
        const resp = await fetch(
            'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
            { signal: AbortSignal.timeout(5_000) },
        );
        if (!resp.ok) return 0;
        const price = num(asRecord(await resp.json()).price);
        if (price > 0) log.debug('SOL price from Binance fallback: $%d', price);
        return price;
    } catch {
        return 0;
    }
}

// ============================================================================
// Top Holders
// ============================================================================

export interface TopHolder {
    address: string;
    /** Percentage of supply held (0-100) */
    pct: number;
    /** Whether this is the bonding curve / pool address */
    isPool: boolean;
}

export interface HolderDetails {
    totalHolders: number;
    topHolders: TopHolder[];
    /** Sum of top 10 holders' pct (excluding pool) */
    top10Pct: number;
}

/** Fetch top holders for a token from the PumpFun API. */
export async function fetchTopHolders(mint: string): Promise<HolderDetails> {
    const result: HolderDetails = { totalHolders: 0, topHolders: [], top10Pct: 0 };
    try {
        const resp = await fetch(
            `${PUMPFUN_API}/coins/${encodeURIComponent(mint)}/holders?limit=20&offset=0`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) },
        );
        if (!resp.ok) return result;

        const data: unknown = await resp.json();
        const holders = Array.isArray(data) ? data : asRecord(data).holders;
        if (!Array.isArray(holders)) return result;
        result.totalHolders = num(asRecord(data).total, holders.length);

        for (const h of holders.slice(0, 20)) {
            const raw = asRecord(h);
            result.topHolders.push({
                address: str(raw.address ?? raw.owner),
                pct: num(raw.percentage ?? raw.pct),
                isPool: bool(raw.is_bonding_curve ?? raw.isPool),
            });
        }

        // top10 excluding pool
        const nonPool = result.topHolders.filter(h => !h.isPool);
        result.top10Pct = nonPool.slice(0, 10).reduce((sum, h) => sum + h.pct, 0);
    } catch (err) {
        log.debug('Top holders fetch failed for %s: %s', mint.slice(0, 8), err);
    }
    return result;
}

// ============================================================================
// Dev Wallet Balance (SOL + token holdings)
// ============================================================================

export interface DevWalletInfo {
    /** SOL balance in SOL (not lamports) */
    solBalance: number;
    /** Percentage of token supply held by dev */
    tokenSupplyPct: number;
}

/**
 * Fetch dev wallet SOL balance and token holdings via RPC.
 * Accepts a Connection to avoid creating new connections.
 */
export async function fetchDevWalletInfo(
    devWallet: string,
    mint: string,
    rpcUrl: string,
): Promise<DevWalletInfo> {
    const result: DevWalletInfo = { solBalance: 0, tokenSupplyPct: 0 };
    try {
        // SOL balance via standard JSON-RPC
        const balResp = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'getBalance',
                params: [devWallet, { commitment: 'confirmed' }],
            }),
            signal: AbortSignal.timeout(8_000),
        });
        if (balResp.ok) {
            result.solBalance = num(asRecord(asRecord(await balResp.json()).result).value) / LAMPORTS_PER_SOL;
        }
    } catch (err) {
        log.debug('Dev SOL balance fetch failed for %s: %s', devWallet.slice(0, 8), err);
    }

    try {
        // Token holdings via getTokenAccountsByOwner
        const tokenResp = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
                params: [
                    devWallet,
                    { mint },
                    { encoding: 'jsonParsed', commitment: 'confirmed' },
                ],
            }),
            signal: AbortSignal.timeout(8_000),
        });
        if (tokenResp.ok) {
            const accounts = asArray(asRecord(asRecord(await tokenResp.json()).result).value);
            let totalTokens = 0;
            for (const acct of accounts) {
                const parsed = asRecord(asRecord(asRecord(asRecord(acct).account).data).parsed);
                totalTokens += num(asRecord(asRecord(parsed.info).tokenAmount).uiAmount);
            }
            // Total supply is 1B tokens (1_000_000_000)
            const TOTAL_SUPPLY = 1_000_000_000;
            result.tokenSupplyPct = (totalTokens / TOTAL_SUPPLY) * 100;
        }
    } catch (err) {
        log.debug('Dev token balance fetch failed for %s: %s', devWallet.slice(0, 8), err);
    }

    return result;
}

// ============================================================================
// Pool Liquidity (DexScreener)
// ============================================================================

export interface PoolLiquidityInfo {
    liquidityUsd: number;
    /** marketCap / liquidity multiplier */
    liquidityMultiplier: number;
}

/** Fetch pool liquidity from DexScreener. */
export async function fetchPoolLiquidity(mint: string, usdMarketCap: number): Promise<PoolLiquidityInfo | null> {
    try {
        const resp = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`,
            { signal: AbortSignal.timeout(8_000) },
        );
        if (!resp.ok) return null;
        const pair = asRecord(asArray(asRecord(await resp.json()).pairs)[0]);
        const liquidityUsd = num(asRecord(pair.liquidity).usd);
        if (liquidityUsd <= 0) return null;
        const liquidityMultiplier = usdMarketCap > 0 ? Math.round(usdMarketCap / liquidityUsd) : 0;
        return { liquidityUsd, liquidityMultiplier };
    } catch (err) {
        log.debug('Pool liquidity fetch failed for %s: %s', mint.slice(0, 8), err);
        return null;
    }
}

// ============================================================================
// Bundle Detection
// ============================================================================

export interface BundleInfo {
    /** Approximate % of total supply bought in the first Solana slot */
    bundlePct: number;
    /** Number of distinct wallets in the bundle */
    bundleWallets: number;
}

/**
 * Detect coordinated early buys (bundles) by looking at trades within the
 * first ~2 seconds of the token's life. Works best for tokens with < 200
 * lifetime trades — accuracy degrades for high-volume tokens.
 */
export async function fetchBundleInfo(mint: string): Promise<BundleInfo | null> {
    try {
        const resp = await fetch(
            `${PUMPFUN_API}/coins/${encodeURIComponent(mint)}/trades?limit=200&offset=0`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
        );
        if (!resp.ok) return null;
        const raw: unknown = await resp.json();
        const trades = (Array.isArray(raw) ? raw : asArray(asRecord(raw).trades)).map(asRecord);
        if (!trades.length) return null;

        const ts = (t: JsonRecord) => toSeconds(t.timestamp);

        // Sort chronologically, buy-only
        const buys = trades
            .filter(t => bool(t.is_buy))
            .sort((a, b) => ts(a) - ts(b));
        if (buys.length < 2) return null;

        const firstTs = ts(buys[0]!);
        // One Solana slot ≈ 400ms; use a 2-second window to catch same-block bundles
        const slotBuys = buys.filter(t => ts(t) <= firstTs + 2);
        if (slotBuys.length < 2) return null;

        const wallets = new Set(slotBuys.map(t => str(t.user)));
        if (wallets.size < 2) return null;

        // 1B tokens × 10^6 decimals = total raw supply
        const TOTAL_SUPPLY_RAW = 1_000_000_000_000_000;
        const bundleTokens = slotBuys.reduce((sum, t) => sum + num(t.token_amount), 0);
        const bundlePct = Math.min(100, (bundleTokens / TOTAL_SUPPLY_RAW) * 100);

        return { bundlePct, bundleWallets: wallets.size };
    } catch (err) {
        log.debug('Bundle detection failed for %s: %s', mint.slice(0, 8), err);
        return null;
    }
}

// ============================================================================
// Same-Name Token Search (DexScreener)
// ============================================================================

export interface SameNameToken {
    /** Token mint / contract address */
    mint: string;
    name: string;
    symbol: string;
    usdMarketCap: number;
    /** Pair URL on DexScreener */
    url: string;
    /** Age label, e.g. "3d", "1mo" */
    age: string;
}

/**
 * Search DexScreener for other Solana tokens with the same name/symbol.
 * Returns up to 5 results sorted by market cap (descending), excluding
 * the provided `excludeMint`.
 */
export async function fetchSameNameTokens(
    name: string,
    symbol: string,
    excludeMint: string,
): Promise<SameNameToken[]> {
    const query = symbol || name;
    if (!query) return [];
    try {
        const resp = await fetch(
            `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
            { signal: AbortSignal.timeout(8_000) },
        );
        if (!resp.ok) return [];
        const pairs = asArray(asRecord(await resp.json()).pairs).map(asRecord);

        const nameLower = name.toLowerCase();
        const symbolLower = symbol.toLowerCase();
        const excludeLower = excludeMint.toLowerCase();

        const seen = new Set<string>();
        const results: SameNameToken[] = [];

        for (const pair of pairs) {
            if (pair.chainId !== 'solana') continue;
            const base = asRecord(pair.baseToken);
            const pairName = str(base.name).toLowerCase();
            const pairSymbol = str(base.symbol).toLowerCase();
            const pairMint = str(base.address);
            if (!pairMint) continue;
            if (pairMint.toLowerCase() === excludeLower) continue;
            if (seen.has(pairMint)) continue;

            // Match on exact name or symbol (case-insensitive)
            if (pairName !== nameLower && pairSymbol !== symbolLower) continue;

            const mc = num(pair.marketCap ?? pair.fdv);
            if (mc <= 0) continue;

            seen.add(pairMint);
            const createdAt = num(pair.pairCreatedAt);
            results.push({
                mint: pairMint,
                name: str(base.name),
                symbol: str(base.symbol),
                usdMarketCap: mc,
                url: str(pair.url),
                age: createdAt > 0 ? formatAge(createdAt) : '',
            });
        }

        results.sort((a, b) => b.usdMarketCap - a.usdMarketCap);
        return results.slice(0, 5);
    } catch (err) {
        log.debug('Same-name token search failed for %s: %s', query, err);
        return [];
    }
}

/** Format millisecond timestamp to compact age string. */
function formatAge(msTimestamp: number): string {
    const sec = (Date.now() - msTimestamp) / 1000;
    if (sec < 60) return `${Math.floor(sec)}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    if (sec < 2_592_000) return `${Math.floor(sec / 86400)}d`;
    return `${Math.floor(sec / 2_592_000)}mo`;
}

