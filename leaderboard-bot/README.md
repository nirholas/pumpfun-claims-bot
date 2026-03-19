# PumpFun GitHub Dev Leaderboard Bot

A Telegram bot that ranks GitHub developers by their PumpFun social fee earnings in real-time.

Monitors the PumpFees program on Solana, aggregates earnings per GitHub user, and posts ranked leaderboards to a Telegram channel on a configurable schedule.

## What it posts

```
🏆 PumpFun GitHub Dev Leaderboard
📅 Daily · Mar 19

🥇 alice ↑2
   12.450 SOL ($1,867) · 23 claims · 4.2K followers

🥈 bob 🆕
   8.100 SOL ($1,215) · 15 claims · 892 followers

🥉 charlie ↔
   6.750 SOL ($1,012) · 31 claims · 12.1K followers

...

Top 10 of 127 developers · tracking since Mar 1, 2026
SOL price: $150.00
```

Each entry shows:
- Rank with movement arrow (↑/↓/↔/🆕)
- GitHub profile link
- Total SOL earned and USD value
- Number of claims
- GitHub follower count

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/pumpfun-leaderboard-bot
cd pumpfun-leaderboard-bot
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `CHANNEL_ID` | Yes | Channel to post to (`@channel` or `-100...`) |
| `SOLANA_RPC_URL` | Yes | Solana HTTP RPC endpoint |
| `SOLANA_WS_URL` | No | WebSocket endpoint (auto-derived if omitted) |
| `SOLANA_RPC_URLS` | No | Comma-separated fallback RPC endpoints |
| `GITHUB_TOKEN` | No | Raises GitHub rate limit 60→5000 req/hr |
| `LEADERBOARD_SCHEDULE` | No | `daily`, `weekly`, or `both` (default: `daily`) |
| `LEADERBOARD_HOUR` | No | UTC hour to post (0–23, default: `12`) |
| `LEADERBOARD_TOP_N` | No | Developers to show (1–25, default: `10`) |
| `LEADERBOARD_MIN_SOL` | No | Min SOL to appear on board (default: `0`) |

### 3. Add bot to channel

Make your bot an **admin** of the target channel with permission to post messages.

### 4. Run

**Development:**
```bash
npm run dev
```

**Production (built):**
```bash
npm run build
npm start
```

**Docker:**
```bash
docker build -t pumpfun-leaderboard-bot .
docker run -d \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  pumpfun-leaderboard-bot
```

## How it works

1. **Monitoring** — Connects to Solana via WebSocket (falls back to HTTP polling). Watches the PumpFees program (`pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`) for `ClaimSocialFeePda` transactions.

2. **Parsing** — Each transaction is fetched and the `SocialFeePdaClaimed` CPI event is decoded (borsh). Extracts: GitHub user ID, SOL amount, timestamp.

3. **Aggregation** — Maintains all-time, daily, and weekly stats per GitHub user. Periods auto-reset at UTC midnight (daily) and Sunday midnight (weekly).

4. **Posting** — At the configured time, fetches GitHub profiles for top N users, gets current SOL price, builds a ranked HTML card, and posts to Telegram.

5. **Persistence** — All stats survive restarts (`data/leaderboard.json`). Poll cursor also persisted to avoid re-processing old transactions.

## Rank movement

Rank changes (↑/↓/↔/🆕) compare the current leaderboard against the snapshot taken at the previous scheduled post. First-time appearances are marked 🆕.

## Requirements

- Node.js >= 20
- A Solana RPC endpoint with WebSocket support (recommended: Helius, QuickNode, or Alchemy)
- A GitHub token for sustained GitHub API access (optional but recommended)
