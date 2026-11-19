# Troubleshooting

---

## Bot Not Posting to Telegram

**Check bot permissions**
- The bot must be an **admin** in the channel with "Post Messages" enabled
- Go to channel settings → Administrators → find your bot → confirm "Post Messages" is ON

**Verify `CHANNEL_ID`**
- Public channels: use `@channelname` (with the `@`)
- Private channels: use the numeric ID like `-1001234567890`
- To find the numeric ID, forward any channel message to [@userinfobot](https://t.me/userinfobot)

**403 Unauthorized from Telegram**
- The bot is not a member or admin of the channel
- Add it via channel settings → Administrators → Add Administrator

**Bot is running but no posts appear**
- Set `LOG_LEVEL=debug` and check that events are being received from the chain
- Confirm `FEED_CLAIMS=true` (or the relevant feed toggle) is set
- Check for errors in logs — rate limits or API errors may be silently failing

---

## No Events Received from Solana

**WebSocket disconnected**
- Your `SOLANA_WS_URL` must start with `wss://` (not `https://`)
- Verify your Helius / QuickNode API key is correct and the account is active
- The bot logs `WS connected` on successful connection and `WS disconnected` when it drops

**Falling back to HTTP polling**
- If WebSocket fails, the bot falls back to polling every `POLL_INTERVAL_SECONDS` (default 30s)
- You may see a delay between on-chain events and Telegram posts
- This is expected behavior — no action needed

**Rate limited on public RPC**
- Public mainnet RPC has strict rate limits — use a dedicated endpoint for production
- Set `SOLANA_RPC_URLS` with multiple endpoints to enable automatic failover

---

## SocialFeeIndex Slow to Start

On startup, the bot fetches ~148K `SharingConfig` accounts. This takes 30–60 seconds depending on RPC latency.

- Watch for: `SocialFeeIndex ready: 148234 entries` in the logs
- Claims received before the index is ready may be missed
- Using a dedicated, low-latency RPC reduces startup time

---

## Claims Missing or Skipped

**`REQUIRE_GITHUB=true` filtering**
- When set, claims without a GitHub social fee PDA are skipped silently
- Expected for most claims — the majority are creator fee claims, not GitHub social fee claims

**SocialFeeIndex not loaded yet**
- Claims during the 30–60 second startup window may be skipped
- This is expected — the bot needs the index to resolve PDAs to mints

**GitHub API rate limit**
- Without a `GITHUB_TOKEN`, you're limited to 60 requests/hr
- Set `GITHUB_TOKEN` to raise the limit to 5,000 req/hr
- Rate-limited GitHub lookups are logged as warnings

**Fake claims being detected correctly**
- Some users call `claim_social_fee_pda` with no fees to collect
- These are posted with a `⚠️ FAKE CLAIM` warning — this is correct behavior

---

## First-Claim Banner Appearing on Repeat Claimers

**Persistent volume not attached**
- After a redeploy without persistent storage, the bot's local `data/github-first-claims.json` is lost
- The bot falls back to on-chain verification, which should still catch repeat claimers
- But if the bot was offline during a user's first claim, it may incorrectly flag them as first-time

**Fix**: attach a persistent volume mounted at `/app/data` (see [railway-github-claims.md](railway-github-claims.md))

---

## GitHub API Errors

```
[WARN] GitHub API error: 403
```
- You've hit the unauthenticated rate limit (60 req/hr)
- Add `GITHUB_TOKEN` to your environment

```
[WARN] GitHub API error: 404
```
- The GitHub user ID from the transaction doesn't resolve to an active account
- Common for deleted or suspended accounts — expected behavior, no action needed

---

## X/Twitter Follower Counts Missing

- Confirm both `X_AUTH_TOKEN` and `X_CT0_TOKEN` are set
- X cookies expire periodically — refresh them by logging into x.com and re-copying the cookies
- Only GitHub users with an X/Twitter URL in their GitHub profile will have X data

---

## Railway-Specific Issues

**Build failed**
- Confirm you're deploying from **your fork**, not the original repo

**Bot restarts repeatedly**
- Check the logs for startup errors before the restart
- Common causes: missing required env vars (`TELEGRAM_BOT_TOKEN`, `CHANNEL_ID`), invalid RPC URL

**Duplicate "first claim" posts after redeploy**
- Persistent volume isn't attached or the mount path is wrong
- Volume must be mounted at exactly `/app/data` (no trailing slash)

**RPC WebSocket disconnects frequently**
- Railway's network can sometimes interrupt long-lived WebSocket connections
- The bot reconnects automatically — this is expected behavior
- For better reliability, use `SOLANA_RPC_URLS` with multiple fallback endpoints

---

## Debugging Tips

Set `LOG_LEVEL=debug` to see:
- Every transaction the bot inspects
- Why each claim is skipped or posted
- GitHub / X / PumpFun API request details
- RPC connection status and failover events
- Pipeline counters every 60 seconds

The pipeline counter log is the fastest way to understand what's happening:
```
Pipeline: 15 total → 8 social → 3 first / 5 repeat → 8 posted (skip: 7 cashback)
```
