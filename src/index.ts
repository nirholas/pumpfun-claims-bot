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

import { Bot } from 'grammy';

import { ChannelPublisher } from './channel-publisher.js';
import { ClaimMonitor } from './claim-monitor.js';
import { isCreatorClaimType, shouldPostCreatorClaim } from './claim-routing.js';
import {
    addGithubUserPda,
    flushPersistedClaims,
    getGithubUserClaimedMints,
    getGithubUserPdas,
    hasGithubUserClaimed,
    incrementGithubClaimCount,
    loadPersistedClaims,
    markGithubUserClaimed,
} from './claim-tracker.js';
import { ConfigError, loadConfig, type ChannelBotConfig } from './config.js';
import { scoreCredibility } from './credibility.js';
import { flushDevReputation, getReputation, loadDevReputation, recordClaim } from './dev-reputation.js';
import { EventMonitor } from './event-monitor.js';
import { decideFirstClaim } from './first-claim.js';
import { formatClaimAmount, formatCreatorClaimFeed, formatGitHubClaimFeed, formatGraduationFeed, type ClaimFeedContext } from './formatters.js';
import { fetchGitHubUserById, fetchRepoFromUrls } from './github-client.js';
import { startHealthServer, stopHealthServer } from './health.js';
import { log, setLogLevel } from './logger.js';
import { startMcpHttpServer } from './mcp-server.js';
import {
    fetchBundleInfo,
    fetchCreatorProfile,
    fetchDevWalletInfo,
    fetchPoolLiquidity,
    fetchSameNameTokens,
    fetchSolUsdPrice,
    fetchTokenInfo,
    fetchTokenTrades,
    fetchTopHolders,
    type TokenInfo,
} from './pump-client.js';
import { maskUrl } from './rpc-fallback.js';
import type { FeeClaimEvent, GraduationEvent } from './types.js';
import { fetchXProfile } from './x-client.js';

/** Longest a graceful shutdown may take before the process exits anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Wraps a promise so that an unexpected rejection becomes null instead of
 * failing the whole enrichment batch. The fetch helpers already return null
 * on expected failures; this is a last-resort safety net.
 */
function settle<T>(p: Promise<T>): Promise<T | null> {
    return p.catch((err: unknown) => {
        log.warn('Enrichment promise rejected: %s', err);
        return null;
    });
}

async function main(): Promise<void> {
    const config = loadConfig();
    setLogLevel(config.logLevel);

    log.info('PumpFun Channel Bot starting...');
    log.info('  Channel: %s', config.channelId);
    log.info('  RPC: %s', maskUrl(config.solanaRpcUrl));
    const feeds: string[] = [];
    if (config.feed.claims) feeds.push(config.requireGithub ? 'github-social-claims (first-only)' : 'claims (github + creator)');
    if (config.feed.graduations) feeds.push('graduations');
    log.info('  Feeds: %s', feeds.join(', ') || 'none');
    if (config.feed.claims && config.requireGithub) {
        log.info('  GitHub-only mode: creator-fee claims are suppressed (REQUIRE_GITHUB=true).');
    }

    // Load persisted first-claim state to survive restarts
    if (config.feed.claims) {
        loadPersistedClaims();
        loadDevReputation();
    }

    // Fail fast on a bad token before any RPC subscription is opened.
    const bot = new Bot(config.telegramToken);
    await bot.init();
    log.info('Bot initialized: @%s', bot.botInfo.username);
    const publisher = new ChannelPublisher(bot.api, config.channelId);

    // ── Pipeline Counters ─────────────────────────────────────────────
    const pipeline = { total: 0, socialClaims: 0, creatorClaims: 0, firstClaim: 0, posted: 0, skippedCashback: 0, repeatClaim: 0, suppressedCreator: 0 };
    const pipelineTimer = setInterval(() => {
        log.info('Pipeline: %d total → %d social + %d creator → %d first / %d repeat → %d posted (skip: %d cashback, %d creator-suppressed)',
            pipeline.total, pipeline.socialClaims, pipeline.creatorClaims, pipeline.firstClaim, pipeline.repeatClaim, pipeline.posted, pipeline.skippedCashback, pipeline.suppressedCreator);
    }, 60_000);
    pipelineTimer.unref();

    // ── Claim Monitor ────────────────────────────────────────────────
    const claimMonitor = config.feed.claims
        ? new ClaimMonitor(config, (event: FeeClaimEvent) => {
            if (!claimMonitor) return;
            void handleClaim(event, claimMonitor).catch((err: unknown) => log.error('Claim handler error: %s', err));
        })
        : null;

    async function handleClaim(event: FeeClaimEvent, monitor: ClaimMonitor): Promise<void> {
        pipeline.total++;

        // Cashback claims are trader refunds, not creator activity.
        if (event.isCashback) {
            pipeline.skippedCashback++;
            return;
        }
        if (event.claimType === 'claim_social_fee_pda' && event.socialPlatform === 2 && event.githubUserId) {
            pipeline.socialClaims++;
            await handleGithubClaim(event, event.githubUserId, monitor);
        } else if (isCreatorClaimType(event.claimType)) {
            pipeline.creatorClaims++;
            await handleCreatorClaim(event);
        }
    }

    // ── Path A: GitHub social fee PDA claim ──────────────────────────
    async function handleGithubClaim(event: FeeClaimEvent, githubUserId: string, monitor: ClaimMonitor): Promise<void> {
        let mint = event.tokenMint?.trim() || '';

        // A shared social-fee PDA does not reveal which token funded a
        // withdrawal. Fetch candidates for context, but never guess a CA.
        let allLinkedTokens: TokenInfo[] = [];
        if (event.allCandidateMints && event.allCandidateMints.length > 1) {
            log.info('PDA %s maps to %d tokens — fetching all',
                event.socialFeePda?.slice(0, 8) ?? '?', event.allCandidateMints.length);
            const infos = (await Promise.all(event.allCandidateMints.map((m) => fetchTokenInfo(m))))
                .filter((i): i is TokenInfo => i != null);
            infos.sort((a, b) => b.usdMarketCap - a.usdMarketCap);
            allLinkedTokens = infos;
            mint = '';
            event.tokenMint = '';
            log.warn('PDA maps to multiple tokens — leaving attribution unresolved');
        }

        const allMints = event.allCandidateMints?.length ? event.allCandidateMints : (mint ? [mint] : []);
        // Stable PDA key — survives mint resolution changes across restarts
        const pdaKey = event.socialFeePda ? `pda:${event.socialFeePda}` : '';
        const recordUserClaimed = () => {
            markGithubUserClaimed(githubUserId);
            if (pdaKey) markGithubUserClaimed(githubUserId, pdaKey);
            if (mint) markGithubUserClaimed(githubUserId, mint);
            for (const m of allMints) markGithubUserClaimed(githubUserId, m);
        };

        const verdict = await decideFirstClaim({ ...event, githubUserId }, {
            hasGithubUserClaimed: (id) => hasGithubUserClaimed(id),
            getGithubUserPdas,
            pdaHasPriorTransactions: (pda, before) => monitor.pdaHasPriorTransactions(pda, before),
            pdaHasAnyTransactions: (pda) => monitor.pdaHasAnyTransactions(pda),
            walletHasPriorSocialFeeClaims: (wallet, before) => monitor.walletHasPriorSocialFeeClaims(wallet, before),
        });
        if (!verdict.isFirstClaim && verdict.provenRepeat) recordUserClaimed();

        // Always record this user's PDA so later restarts can run cross-PDA checks.
        if (event.socialFeePda) addGithubUserPda(githubUserId, event.socialFeePda);

        log.info('Claim check: user=%s mint=%s first=%s%s lifetime=%s claim=%s',
            githubUserId, mint.slice(0, 8), verdict.isFirstClaim,
            verdict.isFirstClaim ? '' : ` (${verdict.reason})`,
            event.lifetimeClaimedLamports ?? 'null', event.amountLamports);
        if (verdict.isFirstClaim) pipeline.firstClaim++;
        else pipeline.repeatClaim++;

        // Only post FIRST claims — skip fake and repeat claims entirely
        if (event.isFake === true || !verdict.isFirstClaim) return;

        const [githubUser, tokenInfo, solUsdPrice] = await Promise.all([
            fetchGitHubUserById(githubUserId),
            mint ? fetchTokenInfo(mint) : Promise.resolve(null),
            fetchSolUsdPrice(),
        ]);

        // A GitHub account that does not resolve or has no public repo is not a verifiable developer.
        if (!githubUser || githubUser.publicRepos === 0) {
            log.warn('Skipping FIRST claim by GitHub user %s — account unverifiable (%s repos, login=%s)',
                githubUserId, githubUser?.publicRepos ?? 'null', githubUser?.login ?? 'lookup-failed');
            markGithubUserClaimed(githubUserId);
            return;
        }

        // Second wave: depends on first-wave results.
        const [xProfile, repoInfo, creatorProfile, holders, trades, liquidity, bundle, sameNameTokens] = await Promise.all([
            settle(githubUser.twitterUsername ? fetchXProfile(githubUser.twitterUsername) : Promise.resolve(null)),
            settle(tokenInfo?.githubUrls?.length ? fetchRepoFromUrls(tokenInfo.githubUrls) : Promise.resolve(null)),
            settle(tokenInfo?.creator ? fetchCreatorProfile(tokenInfo.creator) : Promise.resolve(null)),
            settle(mint ? fetchTopHolders(mint) : Promise.resolve(null)),
            settle(mint ? fetchTokenTrades(mint) : Promise.resolve(null)),
            settle(mint && tokenInfo ? fetchPoolLiquidity(mint, tokenInfo.usdMarketCap) : Promise.resolve(null)),
            settle(mint ? fetchBundleInfo(mint) : Promise.resolve(null)),
            settle(tokenInfo ? fetchSameNameTokens(tokenInfo.name, tokenInfo.symbol, mint) : Promise.resolve([])),
        ]);
        // Third wave: dev wallet needs RPC + creator address
        const devWallet = tokenInfo?.creator
            ? await settle(fetchDevWalletInfo(tokenInfo.creator, mint, config.solanaRpcUrl))
            : null;

        const claimNumber = incrementGithubClaimCount(githubUserId, mint);
        const claimedMints = getGithubUserClaimedMints(githubUserId);

        // Credibility is computed once here so it can be both displayed and
        // recorded; the dev's track record is read before this claim joins it.
        const credibility = scoreCredibility({ githubUser, repoInfo, creatorProfile, holders, bundle, sameNameTokens, tokenInfo });
        const reputation = getReputation(githubUserId, mint);
        log.info('GitHub social fee FIRST claim by %s (%s): %s', githubUserId, githubUser.login, formatClaimAmount(event, 0));

        const ctx: ClaimFeedContext = {
            event,
            solUsdPrice,
            githubUser,
            xProfile,
            tokenInfo,
            affiliates: config.affiliates,
            isFirstClaim: true,
            isFake: false,
            claimNumber,
            lifetimeClaimedSol: event.lifetimeClaimedLamports != null && !event.quoteMint
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
            credibility,
            reputation,
        };

        try {
            await publisher.postCard(formatGitHubClaimFeed(ctx));
        } catch (postErr) {
            // The claim is lost: a later claim by this user carries a lifetime
            // above its amount, so it can never be announced as a first claim.
            log.error('Failed to post first claim by %s (%s) to %s: %s', githubUserId, githubUser.login, config.channelId, postErr);
            return;
        }
        recordUserClaimed();
        // Flush now, not after the debounce: a restart must not re-post this user.
        flushPersistedClaims();
        // Fold this claim's score into the dev's track record for their next token.
        recordClaim(githubUserId, mint, credibility.score);
        flushDevReputation();
        pipeline.posted++;
        log.info('Posted GitHub claim by %s (%s) — credibility %d/100 to %s',
            githubUserId, githubUser.login, credibility.score, config.channelId);
    }

    // ── Path B: Creator fee claims ────────────────────────────────────
    // Ordinary creator-fee collections are not GitHub-linked. On a GitHub-only
    // channel (REQUIRE_GITHUB, the default) they are counted but never posted;
    // REQUIRE_GITHUB=false runs a general creator-fee feed on another channel.
    async function handleCreatorClaim(event: FeeClaimEvent): Promise<void> {
        if (!shouldPostCreatorClaim(event.claimType, {
            requireGithub: config.requireGithub,
            feeDistributions: config.feed.feeDistributions,
        })) {
            if (config.requireGithub) pipeline.suppressedCreator++;
            return;
        }

        const [solUsdPrice, creator] = await Promise.all([
            fetchSolUsdPrice(),
            fetchCreatorProfile(event.claimerWallet),
        ]);
        log.info('Creator fee claim by %s: %s (%s)',
            event.claimerWallet.slice(0, 8), formatClaimAmount(event, 0), event.claimLabel);

        try {
            await publisher.postCard(formatCreatorClaimFeed({ event, solUsdPrice, creator }));
        } catch (postErr) {
            log.error('Failed to post creator claim by %s: %s', event.claimerWallet.slice(0, 8), postErr);
            return;
        }
        pipeline.posted++;
        log.info('Posted creator claim by %s to %s', event.claimerWallet.slice(0, 8), config.channelId);
    }

    // ── Graduation Monitor ─────────────────────────────────────────────
    const eventMonitor = config.feed.graduations
        ? new EventMonitor(config, (event: GraduationEvent) => {
            void handleGraduation(event, config).catch((err: unknown) => log.error('Graduation handler error: %s', err));
        })
        : null;

    async function handleGraduation(event: GraduationEvent, cfg: ChannelBotConfig): Promise<void> {
        log.info('Graduation detected: %s (migration=%s)', event.mintAddress, event.isMigration);

        const [token, solUsdPrice] = await Promise.all([
            fetchTokenInfo(event.mintAddress),
            fetchSolUsdPrice(),
        ]);

        const [creator, holders, trades, devWallet, liquidity, bundle, xProfile] = await Promise.all([
            settle(token?.creator ? fetchCreatorProfile(token.creator) : Promise.resolve(null)),
            settle(fetchTopHolders(event.mintAddress)),
            settle(fetchTokenTrades(event.mintAddress)),
            settle(token?.creator ? fetchDevWalletInfo(token.creator, event.mintAddress, cfg.solanaRpcUrl) : Promise.resolve(null)),
            settle(fetchPoolLiquidity(event.mintAddress, token?.usdMarketCap ?? 0)),
            settle(fetchBundleInfo(event.mintAddress)),
            // X profile for the token's own X link (null when it is not a profile link)
            settle(token?.twitter ? fetchXProfile(token.twitter) : Promise.resolve(null)),
        ]);

        await publisher.postCard(formatGraduationFeed(
            event, token, creator, solUsdPrice,
            { holders, trades, devWallet, xProfile, liquidity, bundle },
        ));
        pipeline.posted++;
        log.info('Posted graduation for %s to %s', event.mintAddress.slice(0, 8), cfg.channelId);
    }

    // ── Graceful shutdown ────────────────────────────────────────────
    let mcpClose: (() => Promise<void>) | null = null;
    let shuttingDown = false;
    const shutdown = async (reason: string, exitCode: number): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        log.info('Shutting down (%s)...', reason);
        setTimeout(() => {
            log.error('Shutdown did not finish within %ds, exiting', SHUTDOWN_TIMEOUT_MS / 1000);
            process.exit(exitCode || 1);
        }, SHUTDOWN_TIMEOUT_MS).unref();

        clearInterval(pipelineTimer);
        claimMonitor?.stop();
        eventMonitor?.stop();
        // Only the claims feed loads this state; flushing it otherwise would
        // overwrite the files on disk with empty state.
        if (config.feed.claims) {
            flushPersistedClaims();
            flushDevReputation();
        }
        const closing = await Promise.allSettled([stopHealthServer(), mcpClose?.()]);
        for (const result of closing) {
            if (result.status === 'rejected') log.warn('Shutdown step failed: %s', result.reason);
        }
        process.exit(exitCode);
    };
    process.once('SIGINT', () => void shutdown('SIGINT', 0));
    process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
    process.on('unhandledRejection', (reason) => {
        log.error('Unhandled promise rejection: %s', reason instanceof Error ? reason.stack ?? reason.message : reason);
        void shutdown('unhandledRejection', 1);
    });
    process.on('uncaughtException', (err) => {
        log.error('Uncaught exception: %s', err.stack ?? err.message);
        void shutdown('uncaughtException', 1);
    });

    // ── Start ─────────────────────────────────────────────────────────
    if (claimMonitor) {
        await claimMonitor.start();
        log.info('Claim monitor started');
    }
    if (eventMonitor) {
        await eventMonitor.start();
        log.info('Graduation monitor started');
    }
    log.info('Channel feed is live → %s', config.channelId);

    // ── Health check server ──────────────────────────────────────────
    startHealthServer({
        port: config.healthPort,
        startedAt: Date.now(),
        getStats: () => ({
            channel: config.channelId,
            messagesPosted: pipeline.posted,
            ...(claimMonitor ? { claimMonitor: claimMonitor.getMetrics() } : {}),
        }),
    });

    // ── MCP server ──────────────────────────────────────────────────
    if (config.mcp.enabled) {
        mcpClose = startMcpHttpServer(config.mcp.port).close;
    }
}

main().catch((err: unknown) => {
    if (err instanceof ConfigError) {
        log.error('%s', err.message);
    } else {
        log.error('Fatal error: %s', err instanceof Error ? err.stack ?? err.message : err);
    }
    process.exit(1);
});
