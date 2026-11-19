# Environment Variables Reference

All configuration is done via environment variables. Copy `.env.example` to `.env` for local development, or set them in Railway / Docker.

---

## Required

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) → `/newbot`. Looks like `7123456789:AAH...` |
| `CHANNEL_ID` | Channel to post to. Use `@channelname` for public channels, or the numeric ID (`-100xxx`) for private ones. Find the numeric ID by forwarding a channel message to [@userinfobot](https://t.me/userinfobot) |
| `SOLANA_RPC_URL` | Primary Solana HTTP RPC endpoint. Free tiers at [Helius](https://helius.xyz), [QuickNode](https://quicknode.com), or [Alchemy](https://alchemy.com). Defaults to public mainnet if not set (may rate-limit) |

---

## Solana RPC

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | Primary HTTP RPC |
| `SOLANA_WS_URL` | Derived from `SOLANA_RPC_URL` | WebSocket RPC for live event subscriptions. Same provider as HTTP, replace `https://` with `wss://` |
| `SOLANA_RPC_URLS` | — | Comma-separated list of fallback RPC URLs. Automatically rotates on 429 / 5xx / timeout errors |

**Example:**
```
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=abc123
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=abc123
SOLANA_RPC_URLS=https://mainnet.helius-rpc.com/?api-key=abc123,https://your-backup-rpc.com
```

---

## Feed Toggles

All feeds default to `false` except `FEED_CLAIMS`.

| Variable | Default | Description |
|----------|---------|-------------|
| `FEED_CLAIMS` | `true` | GitHub social fee PDA claim cards |
| `FEED_GRADUATIONS` | `false` | Token graduation cards (bonding curve → PumpAMM) |
| `FEED_FEE_DISTRIBUTIONS` | `false` | Post `distribute_creator_fees` payouts (only when `REQUIRE_GITHUB=false`) |
| `REQUIRE_GITHUB` | `true` | When `true`, skip claims that have no GitHub social fee PDA (filters out non-GitHub claims) |

---

## Enrichment APIs

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Optional | GitHub Personal Access Token. Raises API rate limit from 60 → 5,000 req/hr. [Create one here](https://github.com/settings/tokens/new) — no scopes needed |
| `GROQ_API_KEY` | Optional | Groq API key for AI one-liner summaries on claim cards. [Free key at console.groq.com](https://console.groq.com/keys). See [add-ai-summaries.md](add-ai-summaries.md) |
| `X_AUTH_TOKEN` | Optional | X/Twitter `auth_token` cookie for follower counts and influencer tier detection. See [x-twitter-setup.md](x-twitter-setup.md) |
| `X_CT0_TOKEN` | Optional | X/Twitter `ct0` CSRF cookie. Required alongside `X_AUTH_TOKEN` |

---

## Affiliate Codes

Appended to Axiom, GMGN, and Padre trading links in every claim card. All optional.

| Variable | Description |
|----------|-------------|
| `AXIOM_REF` | Your Axiom referral code |
| `GMGN_REF` | Your GMGN referral code |
| `PADRE_REF` | Your Padre referral code |

See [add-affiliate-codes.md](add-affiliate-codes.md) for how to get your codes.

---

## MCP Server

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_ENABLED` | `false` | Enable the embedded MCP server alongside the Telegram bot |
| `MCP_PORT` | `3001` | HTTP port for the MCP Streamable HTTP transport |

---

## Health Check

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port for the health check server. Set automatically by Railway |
| `HEALTH_PORT` | Same as `PORT` | Override health check port separately from the main port |

---

## Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_SECONDS` | `30` | HTTP polling interval when WebSocket is unavailable |
| `LOG_LEVEL` | `info` | Log verbosity: `debug` \| `info` \| `warn` \| `error` |
| `DATA_DIR` | `./data` | Directory for persisted state files (e.g. first-claims JSON). Mount a persistent volume here on Railway |

---

## Full .env Example

```env
# ── Required ──────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=7123456789:AAHxxxx
CHANNEL_ID=@your_channel_name

# ── Solana RPC ────────────────────────────────────────────
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_RPC_URLS=https://mainnet.helius-rpc.com/?api-key=KEY1,https://backup-rpc.com

# ── Feed Toggles ──────────────────────────────────────────
FEED_CLAIMS=true
FEED_GRADUATIONS=false
FEED_FEE_DISTRIBUTIONS=false
REQUIRE_GITHUB=true

# ── Enrichment APIs ───────────────────────────────────────
GITHUB_TOKEN=ghp_your_token
GROQ_API_KEY=gsk_your_key
# X_AUTH_TOKEN=your_x_auth_token_cookie
# X_CT0_TOKEN=your_x_ct0_cookie

# ── Affiliate Ref Codes ───────────────────────────────────
# AXIOM_REF=your_ref
# GMGN_REF=your_ref
# PADRE_REF=your_ref

# ── Tuning ────────────────────────────────────────────────
POLL_INTERVAL_SECONDS=30
LOG_LEVEL=info
DATA_DIR=/app/data

# ── Health Check ──────────────────────────────────────────
# PORT=3000
```
