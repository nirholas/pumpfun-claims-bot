# Set Up Your GitHub Claims Bot on Railway

> **No coding required.** Every step is explained in plain English. If you've never deployed software before, you're in the right place.

**What you're building:** A Telegram channel that posts an alert every time a GitHub developer collects their PumpFun rewards on Solana. It runs 24/7 in the cloud, and once it's set up, you never have to touch it again.

**Time needed:** About 20 minutes.

---

## Before You Start — What You'll Need

You need to collect 4 things before you begin. Think of these like ingredients before cooking — gather them all first, then follow the steps.

| # | What it is | Plain English | Where to get it |
|---|-----------|---------------|----------------|
| 1 | **Telegram Bot Token** | Like a password that lets your bot post messages | Free from [@BotFather](https://t.me/BotFather) on Telegram |
| 2 | **Telegram Channel** | The channel where claims will get posted | You create this yourself |
| 3 | **Solana RPC URL** | A connection to the Solana blockchain so the bot can watch for claims | Free from [Helius](https://helius.xyz) |
| 4 | **GitHub Token** | Lets the bot look up GitHub profiles without hitting a rate limit | Free from [github.com/settings/tokens](https://github.com/settings/tokens) |

Items 3 and 4 sound technical but both take under 2 minutes to get. The instructions below walk you through each one.

---

## Part 1 — Create Your Telegram Bot and Channel

The bot needs two things on Telegram: a **bot account** (what actually sends the messages) and a **channel** (where the messages go). These are separate — think of the bot as the delivery driver and the channel as the mailbox.

### Step 1.1 — Create your bot

1. Open Telegram on your phone or desktop
2. In the search bar, search for **BotFather** (the verified one with a blue checkmark)
3. Tap **Start** or send `/start`
4. Send the message: `/newbot`
5. BotFather asks for a **name** → type anything you like, e.g. `PumpFun Claims`
6. BotFather asks for a **username** → this must end in `bot`, e.g. `pumpfunclaims_bot`
7. BotFather replies with:
   ```
   Done! Congratulations on your new bot. You will find it at t.me/pumpfunclaims_bot.
   Use this token to access the HTTP API:
   7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
8. **Copy and save that token.** It looks like `7123456789:AAH...`. You'll need it later.

> ⚠️ Treat the bot token like a password. Never post it in public.

---

### Step 1.2 — Create your channel

1. In Telegram, tap the pencil/compose icon → **New Channel**
2. Give it a name, e.g. `PumpFun Claims Feed`
3. Set it to **Public** if you want other people to subscribe, **Private** if just for yourself
4. For the public link, choose a short username, e.g. `pumpfunclaims`
5. Skip adding members for now → tap **Done**

---

### Step 1.3 — Add your bot as an admin

The bot needs permission to post messages in the channel. Here's how to grant that:

1. Open your new channel
2. Tap the channel name at the top → **Administrators** → **Add Administrator**
3. Search for the bot username you just created (e.g. `pumpfunclaims_bot`)
4. Tap on it — you'll see a list of permissions
5. Make sure **"Post Messages"** is toggled ON
6. Tap the checkmark/Save

---

### Step 1.4 — Note your Channel ID

**If your channel is public** (has a `@username`): your Channel ID is just `@pumpfunclaims` (use the `@` and the username you chose).

**If your channel is private**: you need a numeric ID.
1. Forward any message from your channel to [@userinfobot](https://t.me/userinfobot)
2. It will reply with something like `Chat id: -1001234567890`
3. Save that number — it's your Channel ID

---

## Part 2 — Get a Free Solana RPC

The bot needs to watch the Solana blockchain for claim transactions. To do that, it needs a **Solana RPC** — basically a phone line to the blockchain.

We recommend **Helius** — it has a generous free tier and is reliable.

1. Go to [helius.xyz](https://helius.xyz) and sign up (Google login works)
2. Once inside, click **Create New API Key** or find your existing API key on the dashboard
3. Click **Copy** on your API key — it looks like `a1b2c3d4-5678-...`
4. Your two RPC URLs are:
   ```
   https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
   wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE
   ```
   Replace `YOUR_KEY_HERE` with the key you just copied.

> **Why two URLs?** The `https://` one is for regular requests. The `wss://` one is a live WebSocket connection — it lets the bot get notified the moment a claim happens, instead of checking every 30 seconds.

---

## Part 3 — Get a Free GitHub Token

Without this, the bot can only look up 60 GitHub profiles per hour. With it, the limit jumps to 5,000 per hour.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) (log in if needed)
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Give it a name like `pumpfun-claims-bot`
4. Set expiration to **"No expiration"**
5. **Don't check any boxes** — no scopes needed for reading public user profiles
6. Scroll down and click **"Generate token"**
7. GitHub shows you the token **once** — it starts with `ghp_`. Copy and save it immediately.

> ⚠️ You can't see this token again after you leave the page. If you lose it, just delete it and generate a new one.

---

## Part 4 — Fork the Bot on GitHub

"Forking" means making your own copy of the code. You need your own copy so Railway can deploy it.

1. Go to [github.com/nirholas/pumpfun-claims-bot](https://github.com/nirholas/pumpfun-claims-bot)
2. Click the **Fork** button (top right) → **Create fork**
3. That's it — you now have `github.com/YOUR_USERNAME/pumpfun-claims-bot`

---

## Part 5 — Deploy on Railway

Railway is a hosting platform that does all the technical heavy lifting. You give it your code and your settings, it runs the bot.

### Step 5.1 — Create a Railway account

1. Go to [railway.app](https://railway.app)
2. Click **Login** → **Login with GitHub** (use the same GitHub account where you forked the repo)
3. Authorize Railway when prompted

### Step 5.2 — Create a new project

1. Once logged in, click **New Project**
2. Click **Deploy from GitHub repo**
3. Find and click `pumpfun-claims-bot` (your fork)
4. Railway will start setting things up — you'll see a card appear titled `pumpfun-claims-bot`

> **Don't wait for it to finish building yet.** It may fail because we haven't given it the settings. That's expected — continue to the next step.

---

## Part 6 — Enter Your Settings (Environment Variables)

"Environment variables" just means settings. Instead of editing code files, you type your keys and settings into a form on Railway. This is how the bot knows your Telegram token, your channel, and your RPC URL.

1. In your Railway project, click on the **`pumpfun-claims-bot`** service card
2. Click the **"Variables"** tab
3. Click **"Raw Editor"** — this lets you paste all settings at once
4. Paste the following, replacing the placeholder values with your real ones:

```
TELEGRAM_BOT_TOKEN=paste-your-bot-token-here
CHANNEL_ID=@your_channel_username
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
GITHUB_TOKEN=paste-your-github-token-here
FEED_CLAIMS=true
FEED_GRADUATIONS=false
REQUIRE_GITHUB=true
LOG_LEVEL=info
DATA_DIR=/app/data
```

5. Click **"Update Variables"**

> **Double-check these common mistakes:**
> - `CHANNEL_ID` must start with `@` for public channels, or be the `-100...` number for private ones
> - The Helius URL must have your actual API key where it says `YOUR_HELIUS_KEY`
> - The bot token is the long string BotFather gave you — not the bot's username

---

## Part 7 — Add Persistent Storage

This is the most important optional step. Without it, **the bot forgets everything every time it restarts** — it would spam your channel with "first time claim" alerts for people who already claimed months ago.

1. In your Railway project, click **"New"** → **"Volume"**
2. Name it anything, e.g. `bot-data`
3. Set **Mount Path** to exactly: `/app/data`
4. It will ask which service to attach it to — select `pumpfun-claims-bot`
5. Click **"Create"**

That's it. The bot's memory now survives restarts forever.

---

## Part 8 — Deploy!

1. Go back to your `pumpfun-claims-bot` service
2. Click the **"Deploy"** tab → **"Deploy Now"**
3. Railway builds the bot (this takes 60–90 seconds the first time)
4. Once the build finishes, you'll see the service status turn **green**

---

## Part 9 — Check It's Working

### Check the logs

1. Click on your service → **"Logs"** tab
2. You should see output like this after about 30 seconds:

```
[INFO] Starting PumpFun Channel Bot
[INFO] Feeds enabled: claims=true, graduations=false
[INFO] Bootstrapping SocialFeeIndex...
[INFO] SocialFeeIndex ready: 148234 entries
[INFO] WS connected to pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ
[INFO] WS heartbeat: 0 events, 0 claims queued (uptime 0h1m)
```

If you see this — **you're done!** The bot is live and watching the blockchain.

### Wait for the first post

Claims happen throughout the day. Within a few minutes (usually less), a developer will claim their rewards and you'll see something like this in your Telegram channel:

```
🚨🚨🚨 FIRST TIME CLAIM
👤 @some_dev_name
💰 5.2 SOL claimed
🪙 Token: $MYTOKEN
```

---

## Something Went Wrong?

### The bot started but nothing posts to Telegram

- Make sure `FEED_CLAIMS=true` is set in Variables
- Make sure your bot is an admin in the channel with "Post Messages" enabled
- Re-check that `CHANNEL_ID` matches exactly (with `@` for public channels)

### "Unauthorized" error in the logs

Your `TELEGRAM_BOT_TOKEN` is incorrect. Go back to BotFather and copy the token again — make sure there are no extra spaces.

### Build failed on Railway

Check that you forked the repo (Part 4) and that Railway is deploying from **your fork**, not the original repo.

### Everything was fine, then the bot started posting duplicate "first claims"

The persistent volume isn't attached correctly. Go to the Volume you created and confirm the mount path is exactly `/app/data` (no trailing slash, no typos).

### GitHub API errors in the logs

Add your `GITHUB_TOKEN` to the Variables if you haven't already (see Part 3). Without it, you're limited to 60 GitHub lookups per hour.

### The logs say "WS disconnected" or "falling back to polling"

Your `SOLANA_WS_URL` is wrong. Double-check that the URL starts with `wss://` (not `https://`) and that your Helius API key is correct.

---

## Your Settings Cheat Sheet

Here's everything in one place once you have all your keys:

```
TELEGRAM_BOT_TOKEN=           ← from @BotFather
CHANNEL_ID=                   ← @channelname or -100xxx
SOLANA_RPC_URL=               ← https://mainnet.helius-rpc.com/?api-key=...
SOLANA_WS_URL=                ← wss://mainnet.helius-rpc.com/?api-key=...
GITHUB_TOKEN=                 ← ghp_...
FEED_CLAIMS=true
FEED_GRADUATIONS=false
REQUIRE_GITHUB=true
LOG_LEVEL=info
DATA_DIR=/app/data
```

Fill in the four blanks — everything else can stay exactly as written above.

---

## Want More Features?

Once the basic setup works, you can add these extras by adding more variables in Railway:

| Feature | Add this variable |
|---------|-------------------|
| Post AI-written summaries on each card | `GROQ_API_KEY=gsk_...` (free from [console.groq.com](https://console.groq.com)) |
| Earn affiliate commissions on Axiom links | `AXIOM_REF=your-ref-code` |
| Also post when tokens graduate | `FEED_GRADUATIONS=true` |
