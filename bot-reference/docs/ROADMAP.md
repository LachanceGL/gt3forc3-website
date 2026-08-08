# Roadmap / Pending Work

Things discussed but not yet done, or explicitly deferred, as of the end of the originating conversation.

## Known bug to fix

- **`!bestlap` / `!top5` / `!top10` / `!online` scrape the wrong server.** `getLapTimes()` is hardcoded to `LIVE_TIMING_URL = 'https://ca.assettohosting.com:10102/live-timing'`, which is unrelated to the actual `GAME_SERVERS` (EVO servers on ports 10647, 60350, 60795). This was very likely leftover from early-stage development before the real server list existed. Headers were relabeled "AC1" as a stopgap to at least signal the mismatch, but the underlying source was never corrected. Decide: point it at the real EVO servers' equivalent data (if the console logs lap times — unconfirmed, needs checking), repurpose these commands for a genuinely separate AC1 server, or remove them.

## New servers pending setup

Two additional AssettoHosting servers were identified as being provisioned (via a Cloudflare Worker's proxy routes and `TRACK_KEYWORDS` map), but never added to `GAME_SERVERS` due to missing credentials/details at the time:

- **Laguna Seca** — proxy target `https://ca.assettohosting.com:10648`, so likely `login`/`server-control` at that host. Needs: login credentials (fresh, not reused), track image URL, subtitle wording.
- **Nürburgring Tour** — proxy target `https://fr.assettohosting.com:60785`. Same needs.

Once added, double check the Cloudflare Worker's `TRACK_KEYWORDS` entries (`lagunaseca`, `nurburgringtour`) still match the exact `trackName` strings chosen, since that worker keys off substring matching against this bot's embed titles.

## FORC3MOD (second server) expansion

Currently FORC3MOD receives welcome messages and has its own `!invite` channel configured (`INVITE_CHANNELS_BY_GUILD`). `!say` and `!edit` already work there automatically (no per-guild hardcoding). Still explicitly deferred, to be revisited later:

- Any server-status monitoring, leave notifications, or other GT3FORC3-specific features would need explicit per-guild configuration (channel/category IDs) if wanted in FORC3MOD — nothing should be assumed to "just work" there beyond what's listed in CLAUDE.md's current feature table.

## Potential API migration

AssettoHosting has a real, documented, authenticated results API (`GET /api/v1/results`, `Bearer <key>` auth via an API key generated in their dashboard) — but it's scoped to **post-session result files** (lap times, standings after a session ends), not live player-count/online-status data. This is already used by the separate website Cloudflare Worker, but never wired into this bot.

- **Good candidate for migration once verified:** if `!bestlap`/`!top5`/`!top10` get pointed at the correct EVO servers (see bug above), and result files turn out to contain lap-time data in a parseable structure, replacing the live-timing-page scraping with a real API call would be significantly more reliable than the current DOM-scraping approach.
- **Not a candidate:** live player count / "who's online now" / "recently joined" — the results API doesn't cover this, based on AssettoHosting's own description of it. The Puppeteer console-scraping approach in `getServerPlayerCount()` is expected to remain necessary for this specific data until/unless AssettoHosting ships a dedicated live-status endpoint. Periodically check their changelog/wiki for this.

## Hosting

The bot currently runs on a personal Windows PC via `node index.js` in a terminal. This means:

- It goes offline whenever the PC sleeps, restarts, or the terminal is closed.
- Puppeteer's resource usage (see GOTCHAS.md) competes with other use of the machine.

Moving to dedicated always-on hosting (a small VPS, Railway, Render, etc.) was discussed as the "real" long-term fix but not actioned. Revisit if uptime/reliability becomes a priority, or if Puppeteer's resource usage becomes a recurring complaint.

## Possible refactor (not urgent)

The entire bot lives in a single `index.js` file, which has grown large. If further features are added, consider splitting into modules (e.g. `commands/`, `services/scraping.js`, `services/welcome.js`) — but this is a "nice to have," not a blocker, and the current single-file structure was a reasonable choice for how the project was built incrementally. Don't refactor pre-emptively without a specific reason.
