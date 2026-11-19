# Feed Types

The bot posts two kinds of card, each toggled by an environment variable. Creator-fee claims can also be posted on a channel that is not GitHub-only.

---

## GitHub Social Fee Claims (`FEED_CLAIMS`)

**Default: `true`**

Posts a card every time a GitHub developer claims their PumpFun social fee PDA rewards.

Each card includes:

| Element | Description |
|---------|-------------|
| 🚨 First-time banner | Shown when the GitHub user has never claimed before (on-chain verified) |
| ⚠️ Fake claim warning | When `claim_social_fee_pda` was called but no fees were paid out |
| Claim counter | Sequential claim number per user, tracked across restarts |
| SOL amount + lifetime total | How much was claimed this time vs. all time |
| GitHub profile | Username, bio, repos, followers, account age, location |
| X/Twitter profile | Follower count and influencer tier badge (if `X_AUTH_TOKEN` is set) |
| Token info | Graduated/bonding curve status, curve %, created age, reply count |
| Token socials | Twitter, Telegram, website from token metadata |
| Trust signals | Warnings for new GitHub accounts (< 30 days), zero repos, fake claims |
| Trading links | Axiom, GMGN, Padre — with affiliate codes if configured |

**Filter:** Set `REQUIRE_GITHUB=true` (default) to only post claims from GitHub social fee PDAs, skipping other claim types.

See [first-github-claims.md](first-github-claims.md) for how first-claim detection works.

---

## Token Graduations (`FEED_GRADUATIONS`)

**Default: `false`**

Posts a card when a token graduates from the PumpFun bonding curve to PumpAMM.

Each card includes:
- Creator profile and launch history
- Top holders analysis and concentration metrics
- 24h trading volume and buy/sell ratio
- Dev wallet activity (sold, held, transferred)
- Pool liquidity on PumpSwap
- Bundle detection (scam indicator)

Enable: `FEED_GRADUATIONS=true`

---

## Creator Fee Claims (`REQUIRE_GITHUB=false`)

**Default: off**

With `REQUIRE_GITHUB=false`, ordinary creator-fee collections (`collect_creator_fee`, `collect_coin_creator_fee`) are posted as well as GitHub social fee claims. `distribute_creator_fees` payouts are posted only when `FEED_FEE_DISTRIBUTIONS=true` is also set. On a GitHub-only channel (the default) none of these are ever posted.

---

## Enabling Multiple Feeds

Set any combination:

```env
FEED_CLAIMS=true
FEED_GRADUATIONS=true
REQUIRE_GITHUB=false
FEED_FEE_DISTRIBUTIONS=false
```

All feeds post to the same `CHANNEL_ID`. If you want separate channels per feed type, run multiple bot instances with different `CHANNEL_ID` and feed toggle values.

---

## Pipeline Stats

The bot logs pipeline counters every 60 seconds:

```
Pipeline: 15 total → 8 social → 3 first / 5 repeat → 8 posted (skip: 7 cashback)
```

| Counter | Meaning |
|---------|---------|
| `total` | All claim events received from the chain |
| `social` | GitHub social fee PDA claims |
| `first / repeat` | First-time vs. returning claimers |
| `posted` | Successfully posted to Telegram |
| `skip cashback` | Cashback claims (user refunds, not creator activity — always skipped) |
