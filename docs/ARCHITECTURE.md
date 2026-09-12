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
6. Driver-nationality world map/flag grid. (A crash-report section
   also lived here until 2026-08-27, when it was removed.)
7. Footer (version string, Discord + Patreon links).
8. `<script>` — all JS: the `LEADERBOARDS` config, data fetching,
   rendering functions, event wiring.

### 2. `workers.js` — the Cloudflare Worker

**This Worker is shared with `forc3mod.com`, which is a different site in
a different repo.** One deployed Worker backs both, so this file is not
solely ours: `/contact` exists only for forc3mod.com and nothing in this
repo calls it. That has already caused one near-miss — the tracked copy
here drifted behind the live Worker after the other project added
`/contact` through the dashboard, and pasting this file over the live one
would have silently deleted their contact form.

**Deploy by hand, via the Cloudflare dashboard.** `wrangler.toml` and
`.github/workflows/deploy-worker.yml` exist, but the workflow is
**manual-dispatch only and currently unsafe to run** — the first
automated deploy wiped all seven credentials and took every API-keyed
route down until a rollback restored them. The cause is not understood
(the values present as encrypted secrets, which should survive a deploy),
so treat the dashboard as the deploy path until someone works out why.
See the header comment in that workflow file.

Keeping `workers.js` here accurate still matters regardless — that alone
prevents the drift that nearly deleted forc3mod.com's `/contact` route.

Who actually calls this Worker (grepped, not assumed):

| Caller | Routes it depends on |
|---|---|
| gt3forc3.com (this repo) | `/serverN/*`, `/discord/stats`, `/discord/verify-request`, `/discord/notify-verified` |
| forc3mod.com (`forc3mod-website`) | `/contact`, **and `/discord/stats`** (`js/main.js` lines 11 and 105) |
| `forc3-discordbot` | **none** — it talks to Discord directly |

`/discord/stats` is the trap: forc3mod.com reads
`server_players.nordschleife` out of it, so changing that response shape,
or letting that `TRACK_KEYWORDS` key drift the way `nurburgringtour` once
did, silently breaks a live counter on a site whose repo cannot notice.
That project's own `CLAUDE.md` documents the dependency and says the fix
always belongs here.

Stateless request router/proxy. Every route:

| Route | Method | Purpose |
|---|---|---|
| `/serverN/...` (N = 1-5, or unprefixed = server1) | GET | Proxies to that Assetto Corsa server's own web API, injecting a Bearer API key server-side for `/api/v1/*` paths so the key never reaches the browser. Edge-caches GETs per `cacheControlFor()`: settled session files 30 days, the results list 60s, `/rows` 30s, everything else uncached. |
| `/discord/stats` | GET | Returns `{ member_count, online_count, server_players }` for the Discord widget. Reads the Discord guild's approximate counts via the bot token, and separately reads recent messages in a specific channel (where `bot.js` posts its status embeds) to extract live per-track player counts by regex-matching `"X Players Online"` in each embed. Edge-cached 2 minutes via Cloudflare's Cache API. |
| `/discord/verify-request` | POST | Handles "Get Verified" form submissions from the site — DMs a fixed admin Discord user (via bot token) with the driver's submitted details. Public/unauthenticated, so every field is trimmed and length-capped. |
| `/discord/notify-verified` | GET | Admin-triggered (visited manually in a browser after approving a request), protected by a shared secret query param. Looks up a Discord member by username and DMs them a "you're verified" confirmation. Never exposed in the site's HTML/JS. |
| `/contact` | POST | **Serves forc3mod.com, not this site.** Relays that site's contact form into a FORC3MOD Discord channel via the bot token, so a static site needs no webhook or token of its own. Sets `allowed_mentions: { parse: [] }` — without it, anyone could type `@everyone` into a public form and have the bot fire it. Nothing here calls this; do not remove it as dead code. |
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

## Timestamps are UTC, everywhere

Established 2026-08-26 by measurement, not assumption — it had previously
been guessed at (wrongly) in the Worker's cache logic.

- **Session filenames** (`results_20260827_011556_practice`) are UTC.
- **The listing's `timestamp`** carries an explicit `Z`, matches the
  filename exactly, and is genuine UTC rather than local time wearing a
  `Z`: the newest session measured 14 minutes old against both the system
  clock and the origin's own HTTP `Date` header.
- **`/rows`' `SessionDate` is the UTC date.** Confirmed across a midnight
  boundary, which is the only test that distinguishes it: a session
  starting 00:28:26Z on the 27th reports `2026-08-27`. Under any timezone
  west of UTC it would have read the 26th.

**User-visible consequence worth knowing:** `formatSessionDate()` only
strips the century (`2026-08-27` → `26-08-27`) and does no conversion, so
the site shows UTC dates verbatim. For a mostly North-American community
that pushes late-evening laps onto the next day — a lap set at 9pm
Eastern displays as tomorrow's date. Not a bug, and changing it would be
a product decision needing care: `SessionDate` is also a join key for race
total times and lap counts, so it has to keep matching the raw data rather
than what's displayed.

**Don't cross-check dates against the HTML embed page — it localises and
`/rows` does not.** The human-facing
`/leaderboards/embed/<shareKey>` page and the `/rows` JSON behind it
disagree by a day around midnight UTC: on 2026-09-06 the page showed
`Nikita Marshakov` under `2026-09-05` while `/rows` returned
`"SessionDate": "2026-09-06"` for the same row — and the lap really is in
`results_20260906_000858_practice`, so `/rows` is the correct one. The page
is server-rendered (no `toLocaleDateString` anywhere in it), so this is the
panel's configured zone, not the viewer's, and it will look the same for
everybody. It only matters when eyeballing that page against result files;
the site reads `/rows` and is unaffected.

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

**`flags` is a bitfield, and bit 1 (value `2`) means the lap counts
toward the session standings.** Established 2026-09-06 against
`results_20260905_232108_practice` on server1, and the test was symmetric
in both directions rather than a spot check:

- 28 drivers had at least one `flags & 2` lap; 28 drivers had a non-zero
  `time_standings` entry; the difference each way was **0**.
- `time_standings` equalled the fastest `flags & 2` lap for **28 of 28**
  drivers, no exceptions.

Values seen in that session: `1` (118 laps), `2` (38), `129` (2). `129` is
`128|1` and does **not** count. What bit 7 (`128`) marks is still unknown —
only two laps carried it, which is too few to infer anything from.

**What "doesn't count" actually covers.** AssettoHosting's own HTML results
page renders a per-lap Status column of `SB` / `PB` / `Invalid`, and its
`Invalid` badge lines up with the missing bit — 155 laps were badged that
way in this session. It is a mixed bucket, not just track limits: laps of
`18:26.772` (S1 alone `13:29`) and `93:03.754` (S1 `88:09`) are in it, which
are out-laps and idle/AFK stints. So don't present a filtered-out lap to
anyone as "cut" — the data doesn't say that.

⚠️ **The leaderboard endpoint ignores this field, and so therefore does the
site.** `/leaderboards/embed/<shareKey>/rows` ranks a driver's fastest lap
regardless of validity: across 59 rows matched back to the session file,
59 equalled the fastest lap of *any* flag and only 23 equalled the fastest
*valid* one. Concretely, `Paul Richardson VR GUY` is `6:46.689` on the
results page and `6:45.339` on the leaderboard — the faster one is
`flags: 1`. Every board on gt3forc3.com inherits this.

This is upstream behaviour in AssettoHosting's Server Manager, not
something this repo introduced: the same software's results page reads the
flag correctly and its leaderboard doesn't. Still open with them — see
`docs/TODO.md`.

**Every board except 0.8 is now rebuilt from the session files** by
`scripts/build_valid_laps.py`, hourly in CI, served from
`data/valid-laps.json`; `index.html` prefers that file and falls back to
the live endpoint if it can't be loaded. 0.9 went first (2026-09-11), the
other four followed. **0.8 alone is deliberately left on the live
endpoint** — it is the superseded build and rebuilding it drops roughly
half its rows, which is a decision about historical results rather than a
data fix. The effect on 0.9: 623 rows to 278, Sub 7 Club 211 to 168, and the
three impossible sub-6:00 times at the top disappear on their own, since
they were invalid all along. **Sub 7 Club was then switched off for 0.9**
(`views: ["top200"]`) — 168 was judged too thin a field to stand as a
club. That is a product call about the real number, not a sign the
rebuild is wrong; drop the key again when the field recovers.

⚠️ **A server's session history spans every track it has ever hosted, so
the rebuild MUST filter by track.** server4 alone has run Spa, Laguna
Seca, Road Atlanta, Touristenfahrten and Red Bull Ring. The first
unfiltered run put a Laguna Seca 1:23 at the top of the Spa board. The
`track` pairs in `BOARDS` were derived, not assumed: each track in a
server's history was scored on how many rows of that board's LIVE
leaderboard it explains, and in all four cases one track explained 100%
and every other explained 0%.

| board | server | track filter | live → valid |
|---|---|---|---|
| nordschleife | 1 | Nurburgring / Nordschleife | 623 → 278 (0.9) |
| spa | 2 | Nurburgring / Touristenfahrten | 3 → 1 |
| redbullring | 3 | Nurburgring / Gp Strecke | 11 → 9 |
| lagunaseca | 4 | Circuit de Spa Francorchamps / GP | 9 → 5 |
| nurburgringtour | 5 | Nurburgring / Touristenfahrten | 5 → 1 |

Two of those end up with a single row. That is the honest count, not a
bug — almost nobody set a clean lap on those servers. The script logs a
warning if one ever reaches zero, since an empty board renders as "No
Leaderboard active yet" and reads like a broken page.

Note the leaderboard does NOT follow a repoint: server2's newest sessions
are Spa while its board still shows Touristenfahrten, so that board is
already stale upstream regardless of this rebuild.

Two things about the 0.9 rebuild specifically are load-bearing and easy to
get wrong:

- The precomputed file carries **`rows` (valid laps only) and `keys`
  (best lap of ANY validity)**. `keys` is what tags MAIN-board rows as 0.9
  so they're kept off the 0.8 views; building it from valid laps only would
  leave an invalid 0.9 lap untagged and it would resurface on the 0.8 board
  labelled 0.8. Verified identical to the old share-key tagging: the same
  554 of 2209 main-board rows, zero differences either way.
- `gameVersionForRow()` short-circuits to the active version filter. The
  key lookup can't serve the VER column on the rebuilt board, because a row
  now shows a driver's best VALID lap while their key holds their best lap
  of any validity — for anyone whose fastest lap was invalid those differ,
  and the lookup missed, rendering 0.8 on a 0.9 row.

`time_standings` is a parallel array of raw millisecond integers (not
objects), positionally aligned with `drivers`/`driver_standings` — that's
the one `ensureRaceTotalTimesLoaded()` already reads for Race boards.

## Data flow for a leaderboard tab load

1. Person clicks a track tab (or loads a URL with a track hash). The hash
   is the entry's `slug` (`#spa`, `#nurburgring-gp`, ...), resolved to the
   `LEADERBOARDS` id by `trackIdFromHash()`; old id links still work.
2. `switchToTrack(track)` resets per-track UI state, then calls
   `loadLeaderboard(track)`, `loadServerName(track)`,
   `ensureTrackDataLoaded(track)`, `ensureRaceTotalTimesLoaded(track)` (Race
   tracks only).
3. `loadLeaderboard` fetches `WORKER_URL + config.workerPrefix +
   "/leaderboards/embed/" + config.shareKey + "/rows"` — this is the
   public leaderboard-embed endpoint Assetto Corsa server hosting exposes,
   proxied (not API-keyed; the API key is only injected for `/api/v1/*`
   paths).
4. Rows get cached in `leaderboardCache[track]`, then filtered/sorted by
   `computeFilteredEntries()` (handles cheater-name flagging, verified
   badges, Sub-7-club filtering, Race-mode lap-count filtering) and
   rendered into `#leaderboard-frame` as a real `<table>`.
