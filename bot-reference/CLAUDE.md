# CLAUDE.md

Context file for Claude Code (or any future AI assistant) picking up work on this project. Read this before making changes — several design decisions here look like bugs but are intentional fixes for real problems hit during development. See `docs/GOTCHAS.md` before "fixing" anything that looks odd.

## What this is

A single-file Node.js Discord bot (`index.js`) for the **GT3FORC3** racing community, serving two Discord servers:

- **GT3FORC3** (main server) — the primary deployment, with racing utility commands and live server-status monitoring.
- **FORC3MOD** (second server) — added later, currently only gets welcome messages. Intended to grow independently; do not assume FORC3MOD wants the same features as GT3FORC3 unless told so.

The bot monitors **Assetto Corsa EVO** dedicated game servers hosted by a third-party provider (AssettoHosting) and posts live status (player count, recent joins) into a Discord channel, plus a grab-bag of admin/utility commands.

## Tech stack

- **discord.js v14** — Discord bot framework
- **Puppeteer** — headless Chromium, used to scrape data from AssettoHosting's web dashboards (see "Why Puppeteer" below — this is not incidental, it's the only viable option available)
- **Node.js**, single `index.js` file, no build step, no framework beyond discord.js
- `.env` file (via `dotenv`) for all secrets and channel/server IDs — nothing sensitive is hardcoded

## Why Puppeteer instead of a real API

**This is important context, not a leftover hack.** Assetto Corsa EVO's multiplayer/dedicated-server ecosystem is very new (2025-era), and AssettoHosting (the hosting provider) has not shipped a stable, documented API for **live server status** (current player count, who's connected right now). They confirmed via their own site that a results API is still "finishing" and is scoped to **post-session results**, not live state.

Because of this, the bot logs into AssettoHosting's own admin web panel (`/login`, `/server-control`) using real admin credentials, exactly as a human would in a browser, and reads the live console log text with regex. This is inherently fragile — any change to AssettoHosting's page structure, login flow, or log wording can silently break it. It is the best option currently available, not a design mistake.

**If AssettoHosting ever ships a live-status API,** this scraping approach in `getServerPlayerCount()` should be replaced with a real HTTP call. Watch for that — see `docs/ROADMAP.md`.

There IS a real, documented, authenticated results API already available (`GET /api/v1/results`, `Bearer <key>` auth) — but it's scoped to post-session result files, not live player counts, so it hasn't been wired into this bot. It's currently used by a separate Cloudflare Worker that powers the GT3FORC3 website (see `docs/ARCHITECTURE.md`).

## Key files

- `index.js` — the entire bot. Yes, it's one big file. That's intentional so far given the project's size; if it keeps growing, splitting into modules (commands/, services/) would be a reasonable next step — ask before doing this, since the user has been building this interactively and may prefer to keep things simple.
- `.env` — all secrets, channel IDs, credentials. Never commit this. See `.env.example` for the full variable list with explanations.
- `docs/ARCHITECTURE.md` — how the pieces fit together, including the separate Cloudflare Worker that powers the website (not part of this repo, but reads this bot's Discord messages).
- `docs/GOTCHAS.md` — hard-won lessons from development. Read before touching scraping logic, category renaming, or the refresh loop.
- `docs/ROADMAP.md` — known pending work and things explicitly deferred.

## Environment / secrets discipline

Multiple credentials were accidentally pasted into a chat conversation during development and had to be treated as compromised and rotated. **Never suggest logging, printing, or displaying `.env` values, tokens, or passwords in chat, commit messages, or code comments.** If a user pastes a live token/password anywhere, flag it and tell them to rotate it — don't just proceed silently.

## Running it

```bash
npm install
cp .env.example .env   # then fill in real values
node index.js
```

On Windows, use `node index.js` directly rather than `npm start` — the `npm` wrapper process was found to make `Ctrl+C` shutdown unreliable (see GOTCHAS.md).

## Current command list

| Command | Access | Purpose |
|---|---|---|
| `!say <msg>` | Everyone | Bot deletes your message, reposts as itself |
| `!edit <new text>` (reply to a bot message) | Admin only | Edits a message the bot previously sent |
| `!invite` | Everyone | Bot-generated permanent invite link, per-guild aware via `INVITE_CHANNELS_BY_GUILD` |
| `!reply <userID> <msg>` | Fixed admin user ID only | Sends a DM to a specific user on the bot's behalf |
| `!testwelcome` | Everyone | Fires the welcome message using yourself, for previewing |
| `!serverstatus` | Everyone | Manually triggers a check of all active `GAME_SERVERS` |
| `!bestlap` / `!bl` | Everyone | Best lap from a **live-timing page** — NOTE: currently points at a server unrelated to `GAME_SERVERS` / EVO. See Gotchas. |
| `!top5` / `!top10` | Everyone | Same live-timing source as `!bestlap` |
| `!online` | Everyone | Same live-timing source, lists currently connected drivers |
| `!joined [minutes]` | Everyone | On-demand: lists everyone who joined any active EVO server within a custom time window (default 15 min) |

## Automated behavior

- **Auto-refreshing server status** — every `STATUS_REFRESH_INTERVAL_MS` (currently 5 minutes), checks each enabled server in `GAME_SERVERS` and updates one persistent Discord message per server in `STATUS_CHANNEL_ID`.
- **Category player-count display** — the Discord category containing the EVO status channel gets renamed to show total player count, e.g. `ASSETTO CORSA EVO  ( 🟢 6 )`. A second, separate mechanism does the same for the "Assetto Corsa" (AC1) category by reading *another bot's* messages (see ARCHITECTURE.md).
- **Welcome messages** — per-guild, via `WELCOME_CHANNELS_BY_GUILD` map (GT3FORC3 and FORC3MOD each have their own channel configured).
- **Leave notifications** — posted to a fixed private channel, includes original join date if cached.
- **DM forwarding** — any DM to the bot from someone other than the fixed admin user gets forwarded to that admin's DMs.

## Things NOT to "fix" without checking GOTCHAS.md first

- The two-pass timestamp scanning in `getServerPlayerCount()`
- The "stale reading" fallback logic (`STALE_THRESHOLD_MS`, `lastKnownGood`)
- Why `recentlyJoined` is always taken fresh even when player count falls back to cache
- The per-server try/catch inside `getServerPlayerCount` (isolates one server's failure from the others)
- The self-rescheduling `setTimeout` loop instead of `setInterval`
- The category-rename regex and the 2-renames-per-10-minutes Discord limit
