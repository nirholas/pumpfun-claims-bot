# Local Development

---

## Prerequisites

- **Node.js** >= 20.0.0 (`node --version` to check)
- A Solana RPC endpoint (public mainnet works for development, but may rate-limit)
- A Telegram bot token and channel (optional — the bot logs all events to stdout regardless)

---

## Setup

```bash
git clone https://github.com/nirholas/pumpfun-claims-bot.git
cd pumpfun-claims-bot
npm install
cp .env.example .env
```

Edit `.env` with at minimum:

```env
TELEGRAM_BOT_TOKEN=your-bot-token
CHANNEL_ID=@your_channel
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
FEED_CLAIMS=true
LOG_LEVEL=debug
```

If you don't have a Telegram channel yet, you can still run the bot — it logs all processed events to stdout. To disable Telegram posting entirely, you can temporarily stub out the `CHANNEL_ID` and the bot will error on post attempts but still process events.

---

## Running

```bash
# Development — hot reload via tsx (recommended)
npm run dev

# Type-check without emitting
npm run typecheck

# Build to dist/
npm run build

# Run compiled output
npm start
```

`LOG_LEVEL=debug` shows all events the bot processes, including events that are filtered out before posting. This is useful to confirm the bot is receiving blockchain data.

---

## MCP Server (development)

```bash
# Stdio MCP server (for Claude Desktop / Cursor)
npm run mcp:dev

# HTTP MCP server (alongside the main bot)
MCP_ENABLED=true MCP_PORT=3001 npm run dev
```

---

## Running Tests

The project uses **Vitest** with ~100+ test cases across 6 test suites.

```bash
# Run all tests once
npm test

# Watch mode — re-runs on file changes
npm run test:watch
```

### Test Suites

| Suite | File | What it covers |
|-------|------|----------------|
| Claim Tracker | `claim-tracker.test.ts` | First-claim detection, persistence, counters, lifetime totals |
| Formatters | `formatters.test.ts` | HTML card generation, escaping, null handling, edge cases |
| GitHub Client | `github-client.test.ts` | URL parsing, API response handling, cache behavior |
| Groq Client | `groq-client.test.ts` | AI summary generation, API key handling, HTML safety |
| X Client | `x-client.test.ts` | Influencer tier classification, follower formatting |
| E2E Pipeline | `e2e.test.ts` | End-to-end claim tracking, formatting, GitHub feed |

---

## Project Structure

```
src/
├── index.ts              # Entry point — wires monitors, enrichment, & Telegram posting
├── config.ts             # Environment variable loading & validation
├── mcp-server.ts         # MCP server — tools via Streamable HTTP or stdio
├── mcp-stdio.ts          # Standalone MCP entry point (stdio transport)
├── claim-monitor.ts      # PumpFees program monitor (WebSocket + HTTP polling)
├── claim-tracker.ts      # First-claim detection + claim counter (persisted to disk)
├── event-monitor.ts      # Pump program log decoder (graduations)
├── social-fee-index.ts   # SocialFeeIndex — maps SharingConfig PDAs → mints (~148K)
├── formatters.ts         # Rich HTML card builders for Telegram
├── pump-client.ts        # PumpFun HTTP API client
├── github-client.ts      # GitHub API client (user profiles, rate-limited cache)
├── x-client.ts           # X/Twitter profile fetcher + influencer tier logic
├── groq-client.ts        # Groq AI one-liner summaries
├── rpc-fallback.ts       # Multi-RPC failover with round-robin rotation
├── health.ts             # HTTP health check server
├── types.ts              # Program IDs, discriminators, event types
└── logger.ts             # Leveled console logger
```

---

## Common Development Tasks

### Adding a new enrichment field to claim cards

1. Add the field to `ClaimFeedContext` in `src/types.ts`
2. Populate it in the enrichment block in `src/index.ts`
3. Add it to the card formatter in `src/formatters.ts`
4. Add a test case in `src/formatters.test.ts`

### Adding a new feed type

1. Define the event type in `src/types.ts`
2. Decode the transaction in `src/event-monitor.ts` or `src/claim-monitor.ts`
3. Add a formatter in `src/formatters.ts`
4. Add a feed toggle env var in `src/config.ts`
5. Wire it in `src/index.ts`

### Changing how the bot detects first claims

See [first-github-claims.md](first-github-claims.md) for the logic. The implementation is in `src/claim-tracker.ts` and the verification step is in `src/index.ts`.

---

## Startup Sequence

When the bot starts, it:

1. Loads and validates config from environment
2. Bootstraps `SocialFeeIndex` — fetches all ~148K `SharingConfig` accounts from the PumpFees program (takes 30–60 seconds)
3. Loads `ClaimTracker` from `data/github-first-claims.json` (if it exists)
4. Connects to Solana via WebSocket
5. Starts HTTP polling fallback (if WebSocket is unavailable)
6. Starts the health check HTTP server
7. Starts the MCP server (if `MCP_ENABLED=true`)

Watch the logs for `SocialFeeIndex ready: N entries` to confirm startup is complete.
