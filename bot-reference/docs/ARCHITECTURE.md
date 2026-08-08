# Architecture

## Overview

```
┌─────────────────────┐
│   Discord servers    │
│  (GT3FORC3, FORC3MOD)│
└──────────┬───────────┘
           │ discord.js gateway
           ▼
┌───────────────────────────────────────┐
│   index.js  (single Node.js process)   │
│                                         │
│  - messageCreate handler (commands)    │
│  - guildMemberAdd / Remove (welcome)   │
│  - interactionCreate (buttons, if any) │
│  - scheduled refresh loop              │
└───────┬─────────────────────┬─────────┘
        │ Puppeteer            │ Puppeteer
        ▼                       ▼
┌──────────────────┐   ┌──────────────────┐
│ AssettoHosting     │   │ AssettoHosting     │
│ /login + /server-  │   │ live-timing page   │
│ control (admin      │   │ (different, older  │
│ console scraping)   │   │ URL — see Gotchas) │
└──────────────────┘   └──────────────────┘
```

There is also a **separate Cloudflare Worker** (its own repo, not part of this bot) that powers the GT3FORC3 website. It is documented here because it has real dependencies on this bot's behavior — changes to this bot can silently break the website.

## The Cloudflare Worker (separate system)

Not part of this repository, but relevant:

- Proxies `/server1/` through `/server5/` routes to AssettoHosting's real, documented, authenticated **results API** (`GET /api/v1/results`, `Bearer <key>` auth) for each configured server, keeping the API keys server-side.
- Has a `TRACK_KEYWORDS` map (`nordschleife`, `spa`, `redbullring`, `lagunaseca`, `nurburgringtour`) used to match against **this bot's own embed titles** posted in the status channel, to extract a player count for the website's own stats display.
- Has `/discord/verify-request` and `/discord/notify-verified` routes for a member-verification flow, protected by an admin secret, using the bot's token server-side to DM users.

**Important coupling:** the worker's `/discord/stats` endpoint currently gets live player counts by **regex-scraping this bot's own posted Discord embeds**, not by calling AssettoHosting's API directly. If this bot's embed title format or the "X Players Online" wording changes, the website's stats can silently break. If you rename tracks, add servers, or change wording, check whether the worker's `TRACK_KEYWORDS` / regex needs a matching update (coordinate with whoever maintains that repo).

## Data flow: server status monitoring

1. `GAME_SERVERS` array defines each monitored server: track name, login URL, control-panel URL, credentials (from `.env`), image URL, subtitle text, and an `enabled` flag.
2. `scheduleNextStatusUpdate()` self-reschedules via `setTimeout` (not `setInterval` — see Gotchas) every `STATUS_REFRESH_INTERVAL_MS`.
3. For each **enabled** server, `getServerPlayerCount(server)`:
   - Launches a headless Chromium instance
   - Logs into `/login` (tries a few likely selector patterns for the username field, since the exact HTML isn't documented)
   - Navigates to `/server-control`
   - Waits ~4s for the live console log to populate
   - Reads the console's raw text and regex-parses two things:
     - `"Server updated: X players"` lines → current player count
     - `"connecting gamecar ... (Name | steamID)"` lines → join events
   - Applies staleness/cutoff logic (see Gotchas) before returning
4. `buildStatusEmbeds()` turns each result into a Discord embed (ansi color-block tricks for colored text, `-#` markdown for small subtext — see Gotchas for what Discord actually supports here).
5. `updateStatusMessage()` finds-or-creates one persistent message per server in the status channel, editing in place rather than spamming new messages.
6. `updateCategoryPlayerCount()` renames the parent category to show total player count (rate-limited awareness built in).

## Data flow: AC1 (original Assetto Corsa) category count

A **different, simpler** mechanism — no Puppeteer involved:

- Another bot (not this one) already posts its own status embeds for the original Assetto Corsa servers into a known channel.
- `getAC1TotalPlayerCount()` just reads that channel's recent messages via normal discord.js message fetching, regex-matches `"X Player(s) Online"` out of them (content or embed JSON), sums across distinct server titles, and renames the "Assetto Corsa" category the same way.
- This only works because the bot has read access to that channel — no login/scraping needed since it's reading Discord's own API, not a website.

## The `!bestlap` / `!top5` / `!top10` / `!online` command family

**These use a separate, older code path (`getLapTimes()`) pointed at a *different* live-timing URL than `GAME_SERVERS`.** This was identified mid-project as likely leftover from early development, scraping an unrelated/unconfirmed server. It has not been fixed or repointed at the real EVO servers — command output currently shown as "AC1" in the headers to at least signal it's a different data source. See `docs/ROADMAP.md`.

## Multi-guild support

- `WELCOME_CHANNELS_BY_GUILD` maps `guildId -> channelId`. `sendWelcomeMessage()` looks up the right channel based on `member.guild.id`.
- `INVITE_CHANNELS_BY_GUILD` maps `guildId -> channelId` the same way — `!invite` looks up the right channel based on `message.guild.id` and replies with a warning if the guild it's run in isn't configured.
- Generic commands (`!say`, `!edit`) work in any server the bot is in automatically, since they use `message.channel` / `message.guild` dynamically.
- Server-status monitoring, AC1 category tracking, and leave notifications are all currently GT3FORC3-specific (hardcoded channel/category IDs).
