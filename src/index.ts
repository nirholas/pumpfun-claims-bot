/**
 * PumpFun Channel Bot — Entry Point
 *
 * A read-only Telegram channel feed that broadcasts:
 *   - GitHub social fee PDA first-claims  (FEED_CLAIMS=true)
 *   - Token graduations                    (FEED_GRADUATIONS=true)
 *
 * Run:
 *   npm run dev          (hot reload)
 *   npm run build && npm start  (production)
 */

import { Bot, type BotError } from 'grammy';

import { loadConfig } from './config.js';
import { ClaimMonitor } from './claim-monitor.js';
import { EventMonitor } from './event-monitor.js';
import { hasGithubUserClaimed, markGithubUserClaimed, incrementGithubClaimCount, getGithubUserClaimedMints, loadPersistedClaims, flushPersistedClaims } from './claim-tracker.js';
import { fetchTokenInfo, fetchTopHolders, fetchTokenTrades, fetchDevWalletInfo, fetchSolUsdPrice, fetchPoolLiquidity, fetchBundleInfo, fetchCreatorProfile, fetchSameNameTokens } from './pump-client.js';
import { fetchGitHubUserById, fetchRepoFromUrls } from './github-client.js';
import { fetchXProfile } from './x-client.js';
import { formatGitHubClaimFeed, formatCreatorClaimFeed, formatGraduationFeed, sanitiseHtml } from './formatters.js';
import type { ClaimFeedContext, CreatorClaimContext } from './formatters.js';
import { log, setLogLevel } from './logger.js';
import { startHealthServer, stopHealthServer } from './health.js';
import { startMcpHttpServer } from './mcp-server.js';
import { maskUrl } from './rpc-fallback.js';
import type { FeeClaimEvent, GraduationEvent } from './types.js';

async function main(): Promise<void> {
    const config = loadConfig();
    setLogLevel(config.logLevel);

    // Load persisted first-claim set to survive restarts
    if (config.feed.claims) loadPersistedClaims();

    log.info('PumpFun Channel Bot starting...');
    log.info('  Channel: %s', config.channelId);
    log.info('  RPC: %s', maskUrl(config.solanaRpcUrl));
    const feeds: string[] = [];
    if (config.feed.claims) feeds.push('claims');
    if (config.feed.graduations) feeds.push('graduations');
    log.info('  Feeds: %s', feeds.join(', ') || 'none');

    const bot = new Bot(config.telegramToken);

    bot.catch((err: BotError) => {
        log.error('Bot error:', err.error);
    });

    /** Retry helper for transient Telegram errors (429, 5xx). */
    async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err: unknown) {
                const msg = String(err);
                const is429 = msg.includes('429') || msg.includes('Too Many Requests');
                const is5xx = msg.includes('500') || msg.includes('502') || msg.includes('503');
                if ((is429 || is5xx) && attempt < maxRetries) {
                    // Respect Telegram retry_after if present
                    let delay = (attempt + 1) * 2000;
                    const retryMatch = msg.match(/retry after (\d+)/i);
                    if (retryMatch) delay = (Number(retryMatch[1]) + 1) * 1000;
                    log.warn('Telegram %s — retry %d/%d in %dms', is429 ? '429' : '5xx', attempt + 1, maxRetries, delay);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                throw err;
            }
        }
        throw new Error('Unreachable');
    }

    /**
     * Wraps a promise so that an unexpected rejection becomes null instead of
     * crashing the entire enrichment batch. All fetch helpers already return
     * null on expected failures; this is a last-resort safety net.
     */
    function settle<T>(p: Promise<T>): Promise<T | null> {
        return p.catch((err: unknown) => {
            log.warn('Enrichment promise rejected: %s', err);
            return null;
        });
    }

    /** Send a message to the channel. Throws on failure. */
    async function postToChannel(message: string): Promise<void> {
        const safe = sanitiseHtml(message);
        try {
            await withRetry(() => bot.api.sendMessage(config.channelId, safe, {
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
            }));
        } catch (err) {
            log.error('Failed to post to channel %s: %s', config.channelId, err);
            throw err;
        }
    }

    /** Send a photo with caption to the channel. Falls back to text if photo fails. */
    async function postPhotoToChannel(imageUrl: string, caption: string): Promise<void> {
        const safe = sanitiseHtml(caption);
        // Telegram photo captions are limited to 1024 chars.
        // Use UTF-8 byte length (not JS string length) because Telegram counts bytes,
        // and emojis/Unicode take 3-4 bytes each.
        const byteLen = Buffer.byteLength(safe, 'utf8');
        if (byteLen > 1024) {
            log.warn('Caption too long for photo (%d bytes, %d chars), sending as text', byteLen, safe.length);
            await postToChannel(safe);
            return;
        }
        try {
            await withRetry(() => bot.api.sendPhoto(config.channelId, imageUrl, {
                caption: safe,
                parse_mode: 'HTML',
            }));
        } catch (err) {
            log.warn('Photo send failed, falling back to text: %s', err);
            await postToChannel(safe);
        }
    }

    // ── Pipeline Counters ─────────────────────────────────────────────
    const pipeline = { total: 0, socialClaims: 0, creatorClaims: 0, firstClaim: 0, posted: 0, skippedCashback: 0, repeatClaim: 0 };
    setInterval(() => {
        log.info('Pipeline: %d total → %d social + %d creator → %d first / %d repeat → %d posted (skip: %d cashback)',
            pipeline.total, pipeline.socialClaims, pipeline.creatorClaims, pipeline.firstClaim, pipeline.repeatClaim, pipeline.posted, pipeline.skippedCashback);
    }, 60_000);

    // ── Claim Monitor ────────────────────────────────────────────────
    let claimMonitor: ClaimMonitor | null = null;
    if (config.feed.claims) {
      claimMonitor = new ClaimMonitor(config, async (event: FeeClaimEvent) => {
      try {
        pipeline.total++;

        // Skip cashback claims (user refunds, not creator activity)
        if (event.isCashback) {
            pipeline.skippedCashback++;
            return;
        }

        // ── Path A: GitHub social fee PDA claim ──────────────────────
        if (event.claimType === 'claim_social_fee_pda' && event.socialPlatform === 2 && event.githubUserId) {
            pipeline.socialClaims++;

            let mint = event.tokenMint?.trim() || '';

            // When multiple tokens share the same social fee PDA,
            // fetch token info for ALL candidates and pick highest MC as primary.
            let allLinkedTokens: import('./pump-client.js').TokenInfo[] = [];
            if (event.allCandidateMints && event.allCandidateMints.length > 1) {
                log.info('PDA %s maps to %d tokens — fetching all',
                    event.socialFeePda?.slice(0, 8) ?? '?', event.allCandidateMints.length);
                const infos = (await Promise.all(
                    event.allCandidateMints.map((m) => fetchTokenInfo(m)),
                )).filter((i): i is import('./pump-client.js').TokenInfo => i != null);
                infos.sort((a, b) => b.usdMarketCap - a.usdMarketCap);
                allLinkedTokens = infos;
                const best = infos[0];
                if (best && best.usdMarketCap > 0) {
                    mint = best.mint;
                    event.tokenMint = mint;
                    log.info('Resolved PDA to highest-MC token: %s ($%s)',
                        mint.slice(0, 8), best.usdMarketCap.toFixed(0));
                }
            }

            // Use on-chain lifetime data as ground truth: if lifetime lamports
            // significantly exceed this claim, the user has claimed before —
            // regardless of what our local persistence says (it resets on redeploy).
            // A GitHub user's VERY FIRST claim ever (any token) is considered "first".
            // Subsequent claims on new tokens are repeats.
            const allMints = event.allCandidateMints?.length
                ? event.allCandidateMints
                : (mint ? [mint] : []);
            // Stable PDA key — survives mint resolution changes across restarts
            const pdaKey = event.socialFeePda ? `pda:${event.socialFeePda}` : '';

            // PRIMARY truth: on-chain lifetime data.
            //   lifetime == amountLamports → definitively the FIRST EVER claim from this PDA on-chain.
            //   lifetime >  amountLamports → they have claimed before; skip.
            // FALLBACK (no on-chain data): local persistence.
            // LOCAL DEDUP: local keys prevent double-posting if the same event replays.

            // Step 1: Local dedup — never re-post for a user we already posted
            const localKnown = hasGithubUserClaimed(event.githubUserId!);

            let isFirstClaim: boolean;
            if (localKnown) {
                // We already posted for this user before — always a repeat
                isFirstClaim = false;
            } else if (event.lifetimeClaimedLamports != null && event.amountLamports > 0) {
                // Step 2: On-chain verification — lifetime must equal current claim amount.
                // This catches the common repeat-claim case when lifetime data is correctly parsed.
                const lifetimeMatchesAmount = event.lifetimeClaimedLamports <= event.amountLamports;
                if (!lifetimeMatchesAmount) {
                    isFirstClaim = false;
                    // Backfill local keys so future repeat events are rejected without on-chain lookup
                    markGithubUserClaimed(event.githubUserId!);
                    if (pdaKey) markGithubUserClaimed(event.githubUserId!, pdaKey);
                    for (const m of allMints) markGithubUserClaimed(event.githubUserId!, m);
                } else if (event.socialFeePda && claimMonitor) {
                    // Step 3: PDA history check — even when lifetime==amount looks correct,
                    // verify the PDA itself has no prior transactions. This guards against:
                    //   a) lifetime field parsing bugs returning wrong values
                    //   b) cross-program history (user claimed via old program, new PDA is fresh)
                    const pdaHasPrior = await claimMonitor.pdaHasPriorTransactions(
                        event.socialFeePda, event.txSignature,
                    );
                    if (pdaHasPrior) {
                        isFirstClaim = false;
                        log.warn('Claim by %s on %s: lifetime==amount but PDA %s has prior txs — treating as repeat',
                            event.githubUserId, mint.slice(0, 8), event.socialFeePda.slice(0, 8));
                        markGithubUserClaimed(event.githubUserId!);
                        if (pdaKey) markGithubUserClaimed(event.githubUserId!, pdaKey);
                        for (const m of allMints) markGithubUserClaimed(event.githubUserId!, m);
                    } else {
                        isFirstClaim = true;
                    }
                } else {
                    isFirstClaim = lifetimeMatchesAmount;
                }
            } else {
                // No on-chain lifetime data → cannot verify this is a first claim.
                // Policy: ONLY post when on-chain data confirms lifetime == amount.
                // Skipping prevents false "FIRST CLAIM" posts after redeployment.
                isFirstClaim = false;
                log.warn('Skipping claim by %s on %s — no on-chain lifetime data (amount=%d), cannot verify first-claim', event.githubUserId, mint.slice(0, 8), event.amountLamports);
            }

            log.info('Claim check: user=%s mint=%s first=%s lifetime=%s claim=%s localKnown=%s',
                event.githubUserId, mint.slice(0, 8),
                isFirstClaim,
                event.lifetimeClaimedLamports ?? 'null',
                event.amountLamports,
                localKnown);
            const isFake = event.isFake === true;
            if (isFirstClaim) pipeline.firstClaim++;
            else pipeline.repeatClaim++;

            // Only post FIRST claims — skip fake and repeat claims entirely
            if (isFake || !isFirstClaim) {
                log.debug('Skipping %s claim by %s on %s',
                    isFake ? 'fake' : 'repeat', event.githubUserId, mint.slice(0, 8));
                return;
            }

            const [githubUser, tokenInfo, solUsdPrice] = await Promise.all([
                fetchGitHubUserById(event.githubUserId),
                mint ? fetchTokenInfo(mint) : Promise.resolve(null),
                fetchSolUsdPrice(),
            ]);

            // "Other places" gate: GitHub account must exist and have at least 1 public repo.
            // A 0-repo account is not a verifiable developer, regardless of on-chain data.
            if (!githubUser || githubUser.publicRepos === 0) {
                log.warn('Skipping FIRST claim by GitHub user %s — account unverifiable (%s repos, login=%s)',
                    event.githubUserId, githubUser?.publicRepos ?? 'null', githubUser?.login ?? 'lookup-failed');
                markGithubUserClaimed(event.githubUserId!);
                return;
            }

            // Second wave: depends on first-wave results.
            // settle() ensures one failing enrichment doesn't drop the whole batch.
            const [xProfile, repoInfo, creatorProfile, holders, trades, liquidity, bundle, sameNameTokens] = await Promise.all([
                settle(githubUser?.twitterUsername
                    ? fetchXProfile(githubUser.twitterUsername)
                    : Promise.resolve(null)),
                settle(tokenInfo?.githubUrls?.length
                    ? fetchRepoFromUrls(tokenInfo.githubUrls)
                    : Promise.resolve(null)),
                settle(tokenInfo?.creator
                    ? fetchCreatorProfile(tokenInfo.creator)
                    : Promise.resolve(null)),
                settle(mint ? fetchTopHolders(mint) : Promise.resolve(null)),
                settle(mint ? fetchTokenTrades(mint) : Promise.resolve(null)),
                settle(mint && tokenInfo ? fetchPoolLiquidity(mint, tokenInfo.usdMarketCap) : Promise.resolve(null)),
                settle(mint ? fetchBundleInfo(mint) : Promise.resolve(null)),
                settle(tokenInfo ? fetchSameNameTokens(tokenInfo.name, tokenInfo.symbol, mint) : Promise.resolve([])),
            ]);
            // Third wave: dev wallet needs RPC + creator address
            const devWallet = tokenInfo?.creator
                ? await fetchDevWalletInfo(tokenInfo.creator, mint, config.solanaRpcUrl)
                : null;

            const claimNumber = incrementGithubClaimCount(event.githubUserId, mint);
            const claimedMints = getGithubUserClaimedMints(event.githubUserId);
            log.info('🚨 GitHub social fee FIRST claim by %s (%s) — %s SOL',
                event.githubUserId, githubUser?.login ?? '?', event.amountSol.toFixed(4));

            const ctx: ClaimFeedContext = {
                event,
                solUsdPrice,
                githubUser,
                xProfile,
                tokenInfo,
                isFirstClaim: true,
                isFake: false,
                claimNumber,
                lifetimeClaimedSol: event.lifetimeClaimedLamports != null
                    ? event.lifetimeClaimedLamports / 1e9
                    : undefined,
                repoInfo,
                creatorProfile,
                holders,
                trades,
                devWallet,
                liquidity,
                bundle,
                sameNameTokens,
                allLinkedTokens: allLinkedTokens.length > 0 ? allLinkedTokens : undefined,
                claimedMints: claimedMints.length > 0 ? claimedMints : undefined,
            };

            const { imageUrl, caption } = formatGitHubClaimFeed(ctx);
            try {
                if (imageUrl) {
                    await postPhotoToChannel(imageUrl, caption);
                } else {
                    await postToChannel(caption);
                }
                // Mark all three key types: user-global, PDA-stable, and per-mint
                markGithubUserClaimed(event.githubUserId!);
                if (pdaKey) markGithubUserClaimed(event.githubUserId!, pdaKey);
                markGithubUserClaimed(event.githubUserId!, mint);
                for (const m of allMints) markGithubUserClaimed(event.githubUserId!, m);
                // Flush to disk immediately — don't wait for the debounce.
                // If the process restarts within the debounce window the state
                // must already be persisted so we don't double-post.
                flushPersistedClaims();
                pipeline.posted++;
                log.info('✅ Posted GitHub claim by %s (%s) to %s',
                    event.githubUserId, githubUser?.login ?? '?', config.channelId);
            } catch (postErr) {
                log.error('Failed to post claim by %s — will retry on next claim event: %s',
                    event.githubUserId, postErr);
            }
        }

        // ── Path B: Creator fee claims (collect_creator_fee, collect_coin_creator_fee, distribute_creator_fees) ──
        else if (event.claimType === 'collect_creator_fee' ||
                 event.claimType === 'collect_coin_creator_fee' ||
                 (event.claimType === 'distribute_creator_fees' && config.feed.feeDistributions)) {
            pipeline.creatorClaims++;

            const mint = event.tokenMint?.trim() || '';
            const [tokenInfo, solUsdPrice, creator] = await Promise.all([
                mint ? fetchTokenInfo(mint) : Promise.resolve(null),
                fetchSolUsdPrice(),
                fetchCreatorProfile(event.claimerWallet),
            ]);

            log.info('💰 Creator fee claim by %s — %s SOL (%s)',
                event.claimerWallet.slice(0, 8), event.amountSol.toFixed(4), event.claimLabel);

            const ctx: CreatorClaimContext = {
                event,
                solUsdPrice,
                creator,
            };

            const { imageUrl, caption } = formatCreatorClaimFeed(ctx);
            try {
                if (imageUrl) {
                    await postPhotoToChannel(imageUrl, caption);
                } else {
                    await postToChannel(caption);
                }
                pipeline.posted++;
                log.info('✅ Posted creator claim by %s to %s', event.claimerWallet.slice(0, 8), config.channelId);
            } catch (postErr) {
                log.error('Failed to post creator claim by %s: %s', event.claimerWallet.slice(0, 8), postErr);
            }
        }
      } catch (err) {
        log.error('Claim handler error: %s', err);
      }
    });
    }

    // ── Graduation Monitor ─────────────────────────────────────────────
    let eventMonitor: EventMonitor | null = null;
    if (config.feed.graduations) {
        eventMonitor = new EventMonitor(
            config,
            () => {}, // launches — not used
            async (event: GraduationEvent) => {
                try {
                    log.info('🎓 Graduation detected: %s (migration=%s)', event.mintAddress, event.isMigration);

                    const [token, solUsdPrice] = await Promise.all([
                        fetchTokenInfo(event.mintAddress),
                        fetchSolUsdPrice(),
                    ]);

                    const [creator, holders, trades, devWallet, liquidity, bundle] = await Promise.all([
                        settle(token?.creator ? fetchCreatorProfile(token.creator) : Promise.resolve(null)),
                        settle(fetchTopHolders(event.mintAddress)),
                        settle(fetchTokenTrades(event.mintAddress)),
                        settle(token?.creator ? fetchDevWalletInfo(token.creator, event.mintAddress, config.solanaRpcUrl) : Promise.resolve(null)),
                        settle(fetchPoolLiquidity(event.mintAddress, token?.usdMarketCap ?? 0)),
                        settle(fetchBundleInfo(event.mintAddress)),
                    ]);

                    // Fetch X profile if token has a Twitter link
                    let xProfile = null;
                    if (token?.twitter) {
                        const handle = token.twitter.replace(/.*twitter\.com\/|.*x\.com\//, '').replace(/\/+$/, '');
                        if (handle) xProfile = await fetchXProfile(handle);
                    }

                    const { imageUrl, caption } = formatGraduationFeed(
                        event, token, creator, solUsdPrice,
                        { holders, trades, devWallet, xProfile, liquidity, bundle },
                    );

                    if (imageUrl) {
                        await postPhotoToChannel(imageUrl, caption);
                    } else {
                        await postToChannel(caption);
                    }
                    pipeline.posted++;
                    log.info('✅ Posted graduation for %s to %s', event.mintAddress.slice(0, 8), config.channelId);
                } catch (err) {
                    log.error('Graduation handler error: %s', err);
                }
            },
            () => {}, // whales — not used
            () => {}, // fee distributions — not used
        );
    }

    // ── Start ─────────────────────────────────────────────────────────
    if (config.feed.claims) {
        await claimMonitor!.start();
        log.info('Claim monitor started');
    }
    if (eventMonitor) {
        await eventMonitor.start();
        log.info('Graduation monitor started');
    }

    // Start bot (needed for the API, but no commands registered)
    await bot.init();
    log.info('Bot initialized: @%s', bot.botInfo.username);
    log.info('Channel feed is live → %s', config.channelId);

    // ── Health check server ──────────────────────────────────────────
    const startedAt = Date.now();

    startHealthServer({
        startedAt,
        getStats: () => ({
            channel: config.channelId,
            messagesPosted: pipeline.posted,
            ...(claimMonitor ? { claimMonitor: claimMonitor.getMetrics() } : {}),
        }),
    });

    // ── MCP server ──────────────────────────────────────────────────
    let mcpClose: (() => Promise<void>) | null = null;
    if (config.mcp.enabled) {
        const mcpServer = startMcpHttpServer(config.mcp.port);
        mcpClose = mcpServer.close;
    }

    // ── Graceful shutdown ────────────────────────────────────────────
    const shutdown = () => {
        log.info('Shutting down...');
        claimMonitor?.stop();
        eventMonitor?.stop();
        stopHealthServer();
        mcpClose?.();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});

