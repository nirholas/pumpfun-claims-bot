# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - Pump October 2026 upgrade

### Fixed

- **Claims after the October 2026 Pump/PumpSwap upgrade.** The claim tables now include `collect_creator_fee_v2`, `distribute_creator_fees_v2`, `transfer_creator_fees_to_pump_v2`, `claim_cashback_v2` and `claim_social_fee_pda_v2`. A claim transaction that sweeps first (`sweep_creator_fee`) reports only the claim; a sweep-only transaction is not a claim, and every claim is paid by its own event so two claims in one transaction are never double counted. V2 claims paid in a quote mint such as USDC show in that currency and are kept out of SOL totals.
- **Length-tolerant event decoding.** Trade, completion, migration, distribution and fee events are decoded in the new IDL field order from the known prefix, ignoring trailing bytes, so both old and new layouts decode. `buy_v3`, `sell_v3`, `buy_exact_quote_in_v3` and `multi_hop_swap` trades are recognised.
- **Whale buys that complete the curve.** A buy that completes the bonding curve and keeps buying on PumpSwap in the same instruction (synthetic migration) now counts its `PostCompleteBuyEvent` amount in the buyer total.
- **Social claim lifetime totals.** `SocialFeePdaClaimed.lifetime_claimed` is read in IDL order (after `claimable_before`) instead of being guessed; the leaderboard bot also accepts `claim_social_fee_pda_v2` and keeps non-SOL claims out of its SOL leaderboard.

## [1.0.5] - 2026-09-13

### Changed

- Link the focused `nirholas/pumpfun-github-claims` companion source from the README and explain how its scope relates to this broader toolkit.
- Align the MCP server's reported version and registry descriptor with the npm package version.
- Preserve the existing claim behavior; the per-coin attribution work remains tracked in the companion repository.

### Fixed

- Route diagnostics to stderr in MCP stdio mode so startup and enrichment logs cannot corrupt the JSON protocol stream. Add a CLI initialization and tool-list regression test.

## [Unreleased]

### Changed

- **Dedicated primary RPC.** A dedicated QuickNode endpoint is now the primary RPC (the former endpoints remain in the fallback chain), making the 30s poll cycle and per-claim enrichment far more reliable than the previous free/public RPCs. Endpoint config is env/secret only, never committed.
- **WebSocket silent-death guard.** A dead-but-connected socket (silently rate-limited) never throws, so the heartbeat would reconnect it forever. After `WS_MAX_SILENT_RECONNECTS` reconnects with zero events the monitor abandons the socket. In creator-inclusive mode it falls back to polling; in GitHub-only mode it keeps retrying the WebSocket (see the GitHub-only detection fix below — polling is not a usable fallback there).

### Fixed

- **GitHub-only channel now actually detects social-fee claims (nothing was posting).** The PumpFees program is a ~100 tx/s firehose that is almost entirely cashback claims; `claim_social_fee_pda` (the GitHub claim we exist to post) is a rare needle in it. Polling it with `getTransaction`-per-signature can't keep up — it 429-storms and drops the rare claim, so the channel went silent. In GitHub-only mode the monitor now (a) watches **only** the PumpFees program (Pump/PumpAMM carry only the suppressed creator claims and just add firehose load), and (b) uses the WebSocket (via the derived endpoint — no config change) so it inspects pushed log lines and fetches the full transaction **only** when `ClaimSocialFeePda` actually appears. If the socket drops it retries the WebSocket rather than degrading into the unusable polling path. This is the correct architecture for catching rare events in a high-volume stream.

- **GitHub-only channel no longer posts ordinary creator-fee claims.** `REQUIRE_GITHUB` was declared but never wired, so Path B (`collect_creator_fee` / `collect_coin_creator_fee` / `distribute_creator_fees`) posted generic PumpSwap "Creator Claimed Fees" cards to the GitHub-claims channel — unrelated devs and images the channel was never meant to show. Creator-fee routing is now gated on `REQUIRE_GITHUB` (default `true`): these claims are counted for diagnostics (`… creator-suppressed` in the pipeline line) but never posted. Decision extracted to a pure, tested `src/claim-routing.ts` (`isCreatorClaimType`, `shouldPostCreatorClaim`). Set `REQUIRE_GITHUB=false` to run a general creator-fee feed on a different channel.
- **State persistence on the container host.** The bot runs as non-root `bot` (uid 100); the mounted data volume was root-owned, so poll cursors, the first-claim dedup, and the dev-reputation store failed to write (`EACCES`) and reset on every restart. The deploy now `chown`s the data dir to the container user.

### Added

- **Credibility Score** — every claim card now leads with a deterministic 0-100 verdict (🟢 Strong / 🟡 Moderate / 🟠 Caution / 🔴 High Risk) synthesised from all trust signals (claim verification, GitHub account age/repos/followers, claimed-repo stars & fork status, copycats, bundling, holder concentration, creator rug history), with a transparent ±factor breakdown. Pure, fully-tested logic in `src/credibility.ts`.
- **Dev Track Record** — a persistent per-developer reputation store (`src/dev-reputation.ts`): every credibility score is recorded against the claiming GitHub user id, so a repeat dev's card shows their prior tokens and average credibility. A serial fee-farmer whose newest coin scores clean is exposed by their history; a proven builder is credited. Deduped by mint, persisted across restarts.

## [1.0.0] - 2025-01-01

### Added

- **GitHub Social Fee Claim monitoring** — real-time detection of `claim_social_fee_pda` transactions on the PumpFees program
- **First-time claim detection** — persistent tracking with `🚨 FIRST TIME CLAIM` banners
- **Fake claim detection** — identifies instructions called with no actual payout
- **SocialFeeIndex** — bootstraps ~148K SharingConfig → mint mappings for instant token resolution
- **GitHub enrichment** — user profiles, followers, repos, account age via GitHub API
- **X/Twitter enrichment** — follower counts and influencer tier badges
- **PumpFun enrichment** — token metadata, market cap, curve progress, creator profiles
- **Groq AI summaries** — one-liner token descriptions via Groq API
- **Token graduation cards** — rich cards for tokens graduating from bonding curve to PumpAMM
- **Rich HTML Telegram cards** — emoji-rich, section-based card formatting
- **Trading affiliate links** — Axiom, GMGN, Padre with configurable ref codes
- **Multi-RPC failover** — round-robin rotation with automatic fallback on 429/5xx/timeout
- **WebSocket + HTTP polling** — dual-mode transaction monitoring
- **Persistent claim tracking** — survives restarts via debounced disk persistence
- **Docker support** — multi-stage build with non-root user and volume mounts
- **Railway deployment** — one-click deploy with pre-configured `railway.json`
- **Health check endpoint** — HTTP server for container orchestration liveness probes
- **Configurable feeds** — toggle claims, graduations, launches, whales, fee distributions
- **Web dashboard** — React + Vite frontend with live event streaming
