---
name: pumpfun-token-research
description: Research a PumpFun token, its creator and GitHub social fee claims with the pumpfun-claims-bot MCP server. Use when a user asks about a pump.fun mint, holder concentration, bundled launches, creator history or whether a GitHub user claimed fees.
---

# PumpFun token research

The plugin starts the `pumpfun-claims-bot` npm package over stdio (`npx -y pumpfun-claims-bot`, bin `dist/mcp-stdio.js`). It is read-only: it fetches data and never signs or sends transactions.

## Environment (both optional)

- `GITHUB_TOKEN` raises the GitHub API limit from 60 to 5000 requests per hour. Export it in your shell before starting Claude Code.
- `SOLANA_RPC_URL` Solana HTTP RPC for on-chain queries. Defaults to the public mainnet endpoint, which rate limits quickly; set a dedicated RPC for heavy use.

Requires Node 20 or newer.

## Tools

- `get_token_info(mint)` metadata, market cap, bonding curve progress, flags.
- `get_token_holders(mint)` top holders with concentration metrics.
- `get_token_trades(mint)` recent trade activity: volume, buy and sell counts.
- `get_pool_liquidity(mint, usdMarketCap?)` PumpSwap AMM pool liquidity; only for graduated tokens.
- `get_bundle_info(mint)` detects whether the launch was bundled (a scam indicator).
- `get_creator_profile(wallet)` creator username, launch count, scam estimate, recent coins.
- `get_github_user(username | userId)` GitHub profile: repos, followers, bio, account age. Provide one of the two.
- `get_claim_history(githubUserId)` whether a GitHub user has claimed, claim count and the mints claimed from. This reads the claim tracker data the bot has recorded, so it only reflects claims the server has seen.
- `get_sol_price()` current SOL/USD price.

## Workflow

1. Start with `get_token_info` for the mint. A "Token not found" error means the mint is not a known PumpFun token.
2. Run `get_token_holders` and `get_bundle_info`. Heavy top-holder concentration or a bundled launch are risk signals.
3. Take the creator wallet from the token info and call `get_creator_profile`. Many past launches with a high scam estimate is a risk signal.
4. For a GitHub-linked creator, call `get_github_user` then `get_claim_history` with the numeric user ID.
5. If the token graduated, add `get_pool_liquidity`.

Report the raw numbers and say which signals are indicators, not proof. This server gives data, not financial advice.

## Example

User: "Is this mint safe: <mint>?" Call `get_token_info`, `get_token_holders`, `get_bundle_info`, then `get_creator_profile` on the creator wallet, and summarize holders, bundle result and creator history.

The repo also runs a Telegram claim feed bot (`npm start`, needs `TELEGRAM_BOT_TOKEN`, `CHANNEL_ID`); that is separate from this MCP server and is described in the repo README and `docs/`.
