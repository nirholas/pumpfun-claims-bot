# PumpFun Claims Bot — Overview

A real-time Telegram channel bot that monitors the Solana blockchain for PumpFun on-chain events and posts rich, intelligence-enriched cards.

---

## What It Does

The bot connects to Solana via WebSocket and watches specific programs for transactions. When a matching event is detected, it enriches the data from multiple sources (GitHub, X/Twitter, PumpFun API) and posts a formatted card to a Telegram channel.

**Use cases:**
- Run a public Telegram channel covering PumpFun developer activity
- Track first-time GitHub developer claims for alpha signals
- Monitor token graduations and whale trades
- Query PumpFun on-chain data from Claude, Cursor, or VS Code via the MCP server

---

## Feed Types

| Feed | Env var | Default | Description |
|------|---------|---------|-------------|
| GitHub Social Fee Claims | `FEED_CLAIMS` | `true` | GitHub devs claiming PumpFun social fee rewards |
| Token Graduations | `FEED_GRADUATIONS` | `false` | Tokens graduating from bonding curve to PumpAMM |
| New Launches | `FEED_LAUNCHES` | `false` | New token launches on PumpFun |
| Whale Alerts | `FEED_WHALES` | `false` | Large buy/sell trades above `WHALE_THRESHOLD_SOL` |
| Fee Distributions | `FEED_FEE_DISTRIBUTIONS` | `false` | Creator fee distribution events |

Enable any feed by setting its variable to `true` in your environment.

---

## What the Bot Monitors

Three Solana programs are watched:

| Program | Purpose |
|---------|---------|
| PumpFees (`pfeeUxB...`) | Fee sharing — GitHub social fee PDA claims |
| Pump (`6EF8rre...`) | Bonding curve — graduation events |
| PumpAMM (`pAMMBay...`) | AMM — post-graduation pool events |

Both the original claim instructions and their V2 variants from the October 2026 upgrade are decoded. Fee sweeps (`sweep_creator_fee`, `sweep_protocol_fee`) only move fees into the creator vault, so they are never reported as a claim; the claim that follows them is. See the README's "Programs Monitored" section for the full list.

---

## Two Ways to Use This Project

### 1. Telegram Channel Bot

Run the full bot to post real-time cards to a Telegram channel. Requires:
- A Telegram bot token (from @BotFather)
- A Telegram channel with the bot as admin
- A Solana RPC endpoint

See [railway-github-claims.md](railway-github-claims.md) for a full deployment guide.

### 2. MCP Server (AI Assistant Tool)

Run the MCP server to let Claude, Cursor, or VS Code query PumpFun data conversationally. No Telegram required.

```bash
npx pumpfun-claims-bot
```

See [mcp-server.md](mcp-server.md) for setup instructions.

---

## Deployment Options

| Method | Best for |
|--------|---------|
| Railway (one-click) | Non-technical users, always-on, persistent storage |
| Docker | Self-hosted or VPS deployments |
| npm (`npx`) | MCP server / AI assistant use |
| Local (`npm run dev`) | Development and testing |

---

## Project Layout

```
pumpfun-claims-bot/
├── src/               # TypeScript source — monitors, enrichment, formatters
├── data/              # Persisted state (gitignored, Railway volume mount)
├── docs/              # This documentation
├── web/               # React web dashboard
├── Dockerfile
└── railway.json
```

Key source files:

| File | Role |
|------|------|
| `src/index.ts` | Entry point — wires everything together |
| `src/claim-monitor.ts` | PumpFees program watcher |
| `src/event-monitor.ts` | Pump/PumpAMM log decoder |
| `src/social-fee-index.ts` | Bootstrap ~148K PDA → mint mappings |
| `src/formatters.ts` | Telegram HTML card builders |
| `src/claim-tracker.ts` | First-claim detection, persistent counters |
| `src/mcp-server.ts` | MCP tool server |

---

## Next Steps

- **Deploy the bot** → [railway-github-claims.md](railway-github-claims.md)
- **Add AI summaries** → [add-ai-summaries.md](add-ai-summaries.md)
- **Add affiliate codes** → [add-affiliate-codes.md](add-affiliate-codes.md)
- **Set up X/Twitter influencer detection** → [x-twitter-setup.md](x-twitter-setup.md)
- **Use the MCP server** → [mcp-server.md](mcp-server.md)
- **Understand first-claim logic** → [first-github-claims.md](first-github-claims.md)
- **Run locally** → [local-development.md](local-development.md)
