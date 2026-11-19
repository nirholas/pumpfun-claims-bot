# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - Pump October 2026 upgrade

### Added

- **`LOG_FORMAT=json`** writes one JSON object per line (`time`, `level`, `msg`) for log aggregators. The default text format is unchanged.

### Removed

- **`GROQ_API_KEY` and AI claim summaries.** The Groq client was never called, so no card ever carried an AI summary. The client, its guide and its configuration are removed.
- **`FEED_LAUNCHES`, `FEED_WHALES` and `WHALE_THRESHOLD_SOL`.** These were documented and parsed, but the bot never wired the launch, whale or fee-distribution cards to the channel, so setting them did nothing. The unreachable card builders and their decoders are gone. `FEED_FEE_DISTRIBUTIONS` stays: it gates `distribute_creator_fees` payouts on a channel with `REQUIRE_GITHUB=false`.

### Security

- **Telegram HTML injection.** Coin names, links, pool and mint fields from the pump.fun and DexScreener APIs, and GitHub blog URLs were interpolated into cards without escaping, so a coin creator could add their own links or markup to a card or make the send fail. Every value is now escaped, links and card images must be http(s), and unsafe links are left out.

### Fixed

- **Affiliate codes.** `AXIOM_REF`, `GMGN_REF` and `PADRE_REF` were parsed but never reached the card, which always used the built-in codes. They are now applied; unset, they still default to the built-in codes.
- **Telegram retries.** Retries were decided by searching the error text for "429", "500", "502" or "503", so any error mentioning those digits was retried and a real 429 without the exact phrase was not. They now use the Bot API error code and `retry_after`, and network errors are retried too.
- **Graceful shutdown.** SIGTERM now flushes claim state (it only flushed reputation, so a pending repeat-claim record could be lost), waits for the health and MCP servers to close, and exits within 10 seconds. With the claims feed off it no longer overwrites `dev-reputation.json` with empty state. Unhandled rejections are logged and trigger the same shutdown.
- **Configuration is validated at startup.** A non-numeric `POLL_INTERVAL_SECONDS` used to become `NaN`, a poll loop with no delay; an unreadable boolean such as `FEED_CLAIMS=ture` was treated as `false`; an unknown `LOG_LEVEL` was ignored. All of these now stop the bot with a message that lists every problem, and invalid RPC URLs are reported without their API keys. `HEALTH_PORT` now overrides `PORT`, as documented.
- **MCP over HTTP (`MCP_ENABLED=true`).** One MCP server instance was shared by every HTTP session, but an MCP server serves only one transport, so every session after the first failed with a 500; the session was also registered before it had an id, so even the first session's follow-up requests got "Invalid or missing session ID". Each session now gets its own server, with at most 100 concurrent sessions and a 30-minute idle timeout.
- **MCP tool input.** Mint and wallet arguments must be base58 Solana addresses, GitHub logins and numeric ids are checked, and a negative market cap is refused, before any upstream request is made.
- **`get_claim_history` total.** `totalClaimCount` was always 0 because counts are stored per coin; it is now the sum across coins. The stdio server loads the bot's DATA_DIR state when present, and the MCP server reports the version from `package.json`.
- **State files survive a crash mid-write.** Claim, reputation and poll-cursor files are written to a temporary file and renamed into place. Before, a truncated `github-first-claims.json` failed to parse and every later file was skipped too, resetting first-claim detection.
- **Cards over Telegram's length limit.** A text card longer than 4,096 characters failed to send and the claim was lost; cards are now trimmed at a line boundary. Caption length is measured in visible characters, not HTML bytes.
- **Claims after the October 2026 Pump/PumpSwap upgrade.** The claim tables now include `collect_creator_fee_v2`, `distribute_creator_fees_v2`, `transfer_creator_fees_to_pump_v2`, `claim_cashback_v2` and `claim_social_fee_pda_v2`. A claim transaction that sweeps first (`sweep_creator_fee`) reports only the claim; a sweep-only transaction is not a claim, and every claim is paid by its own event so two claims in one transaction are never double counted. V2 claims paid in a quote mint such as USDC show in that currency and are kept out of SOL totals.
- **Length-tolerant event decoding.** Completion, migration, distribution and fee events are decoded in the new IDL field order from the known prefix, ignoring trailing bytes, so both old and new layouts decode.
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
