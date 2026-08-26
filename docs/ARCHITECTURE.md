# Architecture

## Components

### 1. `index.html` — the website

A single static HTML file (~3700 lines) with inline `<style>` and
`<script>`, no build step, no framework. Deployable anywhere that serves
static files.

Major sections in the file, top to bottom:

1. `<style>` — all CSS, including CSS custom properties for the surface
   color scale (`--surface-1/2/3`) and per-widget theming variables.
2. Top Patreon promo bar (full-bleed, breaks out of the page's centered
   900px column via the `left: 50%; margin-left: -50vw` trick).
3. Header: site logo, Discord member/online-count widget (pulled from the
   Worker's `/discord/stats`), "Get Verified" button + modal.
4. Game logo + track tabs + server-name/online-status line + leaderboard
   toolbar (title, search) + rank/filter toggle rows + the "Allowed Cars"
   dropdown.
5. The leaderboard table itself (`#leaderboard-frame`, populated by JS).
6. Crash report section, driver-nationality world map/flag grid.
7. Footer (version string, Discord + Patreon links).
8. `<script>` — all JS: the `LEADERBOARDS` config, data fetching,
   rendering functions, event wiring.

### 2. `workers.js` — the Cloudflare Worker

Stateless request router/proxy. Every route:

| Route | Method | Purpose |
|---|---|---|
| `/serverN/...` (N = 1-5, or unprefixed = server1) | GET | Proxies to that Assetto Corsa server's own web API, injecting a Bearer API key server-side for `/api/v1/*` paths so the key never reaches the browser. |
| `/discord/stats` | GET | Returns `{ member_count, online_count, server_players }` for the Discord widget. Reads the Discord guild's approximate counts via the bot token, and separately reads recent messages in a specific channel (where `bot.js` posts its status embeds) to extract live per-track player counts by regex-matching `"X Players Online"` in each embed. Edge-cached 2 minutes via Cloudflare's Cache API. |
| `/discord/verify-request` | POST | Handles "Get Verified" form submissions from the site — DMs a fixed admin Discord user (via bot token) with the driver's submitted details. Public/unauthenticated, so every field is trimmed and length-capped. |
| `/discord/notify-verified` | GET | Admin-triggered (visited manually in a browser after approving a request), protected by a shared secret query param. Looks up a Discord member by username and DMs them a "you're verified" confirmation. Never exposed in the site's HTML/JS. |
| OPTIONS (any path) | OPTIONS | CORS preflight. |

Required Worker environment variables: `DISCORD_BOT_TOKEN`,
`ADMIN_SECRET`, `ASSETTO_API_KEY`, `ASSETTO_API_KEY_2` through `_5`.

### 3. `bot.js` — the Discord status bot

A long-running Node.js process (discord.js v14 + Puppeteer), independent
of the Worker and site — it doesn't call either of them, and they don't
call it directly (see the indirection note below).

Two separate scraping paths, because there are two separate categories of
server:

- **`GAME_SERVERS` array** (Assetto Corsa EVO servers 1-5, minus the AC1
  legacy ones): for each, Puppeteer logs into that server's own
  server-control web panel with credentials from `.env`, reads the live
  console log, and extracts the most recent `"Server updated: N players"`
  line plus recent-join names. Posts/edits one embed per server in a
  status channel (`STATUS_CHANNEL_ID`), refreshed every 5 minutes, and
  also responds to a `!serverstatus` command and a per-embed "Refresh"
  button.
- **Legacy AC1 servers**: a *different* bot already posts status for these
  in a shared channel; `bot.js` just reads those existing messages and
  sums the counts to rename a Discord category (doesn't post its own
  embeds for these).

Also handles: welcome/leave messages, DM-forwarding to a fixed admin,
`!reply`/`!say`/`!edit`/`!invite` admin commands, and `!bestlap`/`!top5`/
`!top10`/`!online` commands that scrape a *separate* AC1 live-timing page
directly (not the server-control panel).

## Why the Worker and bot don't talk to each other directly

The site needs live per-track player counts, but running Puppeteer
(needed to log into each AC server's web panel) isn't something a
Cloudflare Worker can do — Workers have no headless-browser capability.
So the *bot* does the actual scraping (it has a real Node process with
Puppeteer) and posts the result as a normal Discord message; the *Worker*
then just reads that Discord message back out via the plain Discord REST
API (which a Worker *can* call). This is why `/discord/stats`'s
`TRACK_KEYWORDS` matching is a bit fragile-looking (regex over embed
JSON) — it's deliberately not coupled to the bot's internal code, only to
the text it happens to post, so the two can be deployed/changed
independently.

## Where per-lap times and sector splits live

Checked against the live API on 2026-08-26, prompted by a standing
belief that lap times couldn't be retrieved at all. They can — just not
from the endpoint the leaderboard uses.

**`/leaderboards/embed/<shareKey>/rows`** (the public embed endpoint the
site renders) returns only `Position`, `FullName`, `Nickname`, `CarName`,
`BestLap`, `SessionType`, `SessionDate`. `BestLap` is a preformatted
`"M:SS.mmm"` string. There is no lap history and no sector data here, and
there never was — this endpoint is a summary.

**`/api/v1/results/<file>`** (API-keyed, one file per session) carries the
real thing, in a `laps` array:

```json
{
  "car_key":    { "a": "...", "b": "..." },
  "driver_key": { "a": "...", "b": "..." },
  "time": 466173,                          // whole lap, MILLISECONDS
  "split": [123456, 159189, 183528],       // three sectors, ms
  "flags": 1
}
```

`driver_key` joins to `drivers[].guid` — the same `{a, b}` pair shape.
Verified against a real session: 35 of 35 laps matched a driver, so the
join is reliable, not best-effort. Note this is NOT `player_id`; that
field exists on `drivers[]` too but does not appear on a lap.

**Why it looks like lap data doesn't exist.** Most sessions have
`laps: []`. In a 31-session sample spread across the full history, only
10 (~32%) had any laps at all — the rest are a single driver joining and
leaving without completing one. Sampling a handful of recent sessions is
therefore very likely to return nothing but empty arrays and give the
impression the field is never populated. Across the ~815 sessions on
server1 that extrapolates to roughly 260 sessions carrying real lap data.

**Not established:** what `flags` means. Values `1` and `2` were both
observed on laps that otherwise look normal, and the guess that it's a
valid/invalidated marker is only a guess — confirm before filtering on it.

`time_standings` is a parallel array of raw millisecond integers (not
objects), positionally aligned with `drivers`/`driver_standings` — that's
the one `ensureRaceTotalTimesLoaded()` already reads for Race boards.

## Data flow for a leaderboard tab load

1. Person clicks a track tab (or loads a URL with `#track` hash).
2. `switchToTrack(track)` resets per-track UI state, then calls
   `loadLeaderboard(track)`, `loadServerName(track)`,
   `ensureTrackDataLoaded(track)`, `ensureRaceTotalTimesLoaded(track)` (Race
   tracks only), `ensureCrashReportLoaded(track)`.
3. `loadLeaderboard` fetches `WORKER_URL + config.workerPrefix +
   "/leaderboards/embed/" + config.shareKey + "/rows"` — this is the
   public leaderboard-embed endpoint Assetto Corsa server hosting exposes,
   proxied (not API-keyed; the API key is only injected for `/api/v1/*`
   paths).
4. Rows get cached in `leaderboardCache[track]`, then filtered/sorted by
   `computeFilteredEntries()` (handles cheater-name flagging, verified
   badges, Sub-7-club filtering, Race-mode lap-count filtering) and
   rendered into `#leaderboard-frame` as a real `<table>`.
