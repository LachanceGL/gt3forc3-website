# GT3FORC3.COM — Project Context for Claude Code

This file is auto-loaded by Claude Code. Read it first, then check `docs/`
for deeper detail before making changes.

## What this project is

GT3FORC3.COM is a sim racing community site for an Assetto Corsa EVO (and
one legacy Assetto Corsa 1) Discord community. It shows live leaderboards
scraped from Assetto Corsa game servers, a Discord member-count widget, a
"Get Verified" driver-verification flow, and a couple of stats sections
(crash reports, driver nationality breakdown).

The system has **three separate components** that only communicate over
HTTP — there is no shared codebase or build step between them:

| Component | File | Language | Deploy target |
|---|---|---|---|
| Website | `index.html` | Single-file HTML/CSS/JS (no framework, no build) | Static hosting (e.g. GitHub Pages / Cloudflare Pages) |
| API proxy | `workers.js` | Cloudflare Worker (JS) | Cloudflare Workers |
| Status bot | `bot.js` | Node.js (discord.js + Puppeteer) | Long-running Node process (VPS/host you control) |

**Scope note carried over from the prior chat:** the person explicitly
asked to stop touching `bot.js` mid-project ("stop updating the Bot here,
we are focusing on the HTML/website part"). Treat `bot.js` as read-mostly
unless asked directly — most session work was on `index.html`, some on
`workers.js`.

## How the three pieces fit together

```
Browser (index.html)
   │  fetch("<WORKER_URL>/serverN/api/v1/...")       — leaderboard data
   │  fetch("<WORKER_URL>/discord/stats")             — member/online counts
   │  fetch("<WORKER_URL>/discord/verify-request")    — Get Verified form submit
   ▼
Cloudflare Worker (workers.js)
   │  proxies to N Assetto Corsa server-control APIs, injecting per-server
   │  Bearer API keys server-side so they never reach the browser
   │  also calls the Discord REST API directly (bot token, server-side only)
   ▼
Discord (via bot token)  +  N Assetto Corsa hosted servers

Discord bot (bot.js) — separate process, NOT called by the Worker or site.
   Logs into each AC server's own web control panel (Puppeteer), reads the
   live console, and posts/updates "X Players Online" status embeds in a
   Discord channel. The Worker's /discord/stats route READS those same
   embeds back out (by message content, not by talking to the bot) to
   surface live per-track player counts on the website.
```

Read `docs/ARCHITECTURE.md` for the full request-flow diagram and the
"why" behind that indirection.

## The 5 Assetto Corsa servers

| id | Host:Port | Track | Format | Worker prefix | API key env var |
|---|---|---|---|---|---|
| 1 | ca.assettohosting.com:10647 | Nordschleife | Hot Lap | `/server1` | `ASSETTO_API_KEY` |
| 2 | de8.assettohosting.com:60350 | Spa Francorchamps | Hot Lap | `/server2` | `ASSETTO_API_KEY_2` |
| 3 | fr.assettohosting.com:60795 | Red Bull Ring | Race (10 laps) | `/server3` | `ASSETTO_API_KEY_3` |
| 4 | ca.assettohosting.com:10648 | Laguna Seca | Race (10 laps) | `/server4` | `ASSETTO_API_KEY_4` |
| 5 | fr.assettohosting.com:60785 | Nürburgring Touring | Touring | `/server5` | `ASSETTO_API_KEY_5` |

Server 4 **used to be** Nürburgring Touring; it was repointed to Laguna
Seca mid-project, and Nürburgring Touring got its own new server5 slot.
If you see old references to "Nürburgring" pointing at server4 anywhere
(comments, screenshots, chat history), that's the pre-swap state — server4
is Laguna Seca now.

Server 2 **used to be** Kyalami; the `kyalami` entry still exists in
`LEADERBOARDS` in `index.html` as a legacy/deactivated entry pointing at
the same shareKey history, kept for continuity rather than deleted.

## `index.html` — key structures to know before editing

- **`LEADERBOARDS`** (a big `const` object, one entry per track id) is the
  single source of truth for how each tab behaves: which Worker prefix/API
  key it uses, its display name, whether it's a Race-template board
  (`isRace: true` + `requiredLaps`), its allowed-cars list, etc. Almost
  every "make X different for track Y" request should be a change to this
  object, not scattered special-casing elsewhere.
- **`GT3_CAR_CLASS_LIST`** — one shared 11-car list reused by all 4 GT3
  tracks (Nordschleife, Spa, Laguna Seca, Red Bull Ring). Red-themed,
  button label "GT3 Cars List".
- **Nürburgring Touring's own `carClassList`** (inline in its config
  entry) — 29-car list, turquoise-themed, button label "Road Cars List".
  Not shared with anything else.
- **The "Allowed Cars" dropdown** (`.car-class-dropdown` /
  `renderCarClassSection()` / `renderCarClassRows()`) is a single reused
  DOM widget, not duplicated per track — its button label, panel title,
  subtitle, and accent color (red vs turquoise) are all set dynamically
  from the active track's `LEADERBOARDS` entry via CSS custom properties
  (`--car-class-accent` etc.) set inline by JS. **Important lesson learned
  the hard way this session:** its rows are rendered as a real `<table>`,
  not flex `<div>`s — a flex-card version caused a real (still not fully
  understood) text-rendering bug on at least one person's browser/GPU that
  only went away after rebuilding it as a plain table using the same
  pattern as the main leaderboard table. Don't "simplify" it back to divs
  without a good reason.
- **`switchToTrack(track)`** is the one function that runs on every tab
  change — it resets basically all per-track UI state (rank mode, sort
  direction, car-class dropdown, cheater/anomalies notice [now removed],
  filter mode, etc). If you add new per-track UI, its reset logic
  generally belongs here, *and* mirrored in the near-identical "on first
  page load" block right after it (search for `initialTrack` in the file)
  — the two are not automatically kept in sync and this file has bitten
  us once already (see `docs/DECISIONS.md`).
- **Default state, as of end of session:** Race-type tracks default to
  **Best Lap** ranking (not Race Time) — this was a late change, applied
  in three places (`raceRankMode` initial value, the per-switch reset, and
  the static HTML `active` class) — if you touch rank-mode defaults, all
  three need to move together.

## Known incomplete / unconfirmed data (do these first if picking up fresh)

See `docs/TODO.md` for the full list with context. Short version:

- A handful of car images in both car-class lists were assigned by
  *inferred* pattern (ascending power-to-weight ratio ⇒ ascending file
  number) rather than confirmed 1:1, because several cars within a class
  share an identical ratio with no way to tell which image file is which
  trim. These are flagged with inline comments in `GT3_CAR_CLASS_LIST` and
  the Nürburgring Touring `carClassList` — grep for "unconfirmed guess".
- `bot.js` has two server entries (Laguna Seca, Nürburgring Touring)
  present but `enabled: false`, waiting on real `.env` credentials and
  real status-image URLs (currently placeholder filenames that likely
  don't exist yet in the image repo).
- The Cloudflare Worker needs `ASSETTO_API_KEY_5` set in its environment
  before server5 (Nürburgring Touring) will actually authenticate.

## Conventions this codebase already follows — keep following them

- **No build step, no framework.** `index.html` is intentionally a single
  file with inline `<style>`/`<script>`. Don't introduce a bundler,
  npm dependency, or split it into modules unless explicitly asked.
- **Config-driven, not per-track special-casing.** New track-specific
  behavior goes into a new field on the relevant `LEADERBOARDS` entry
  (or a new shared constant like `GT3_CAR_CLASS_LIST`), read generically
  by shared rendering code — not `if (track === "spa") { ... }` sprinkled
  around.
- **CSS custom properties for theming, not duplicated rule sets.** See
  `--car-class-accent`/`--car-class-accent-hover`/`--car-class-accent-text`
  on `.car-class-dropdown` for the pattern: one set of CSS rules, themed
  per-instance via inline `style.setProperty(...)` from JS.
  - Note the tab bar itself doesn't use this pattern for its red/turquoise
    theming — it's fine to introduce the CSS-variable version for *new*
    themed things, no need to retrofit everything.
- **Show/hide via a toggled `.visible` class, not inline `display`.**
  Every conditionally-shown block in this file (`.rank-toggle-row`,
  `.car-class-dropdown`, `.leaderboard-search-hint`, etc.) follows
  `display: none` by default + `.visible { display: ... }`, toggled from
  JS with `classList.toggle("visible", someBoolean)`. Keep using this.
- **Comments explain *why*, especially for anything non-obvious or a
  workaround.** This file has a lot of inline comments justifying
  specific numbers/decisions (e.g. why a shadow offset is negative-x, why
  a filter isn't applied on a parent element). Match that style — a
  future session (or future you) will thank you.
- **External assets are always full URLs to the person's own GitHub repo
  or their Assetto Corsa hosting**, never data URIs or assumed local
  paths. Don't invent asset filenames — if you don't have a confirmed
  URL, use the existing silhouette/placeholder pattern
  (`CAR_SILHOUETTE_SVG`) rather than guessing a filename, and flag it
  instead of guessing, unless there's a strong, stated pattern to infer
  from (see `docs/TODO.md` for what "strong pattern" looked like in
  practice here).

## Where to go next

- `docs/ARCHITECTURE.md` — full system diagram, every endpoint the Worker
  exposes, what each one is for.
- `docs/DATA-REFERENCE.md` — every track's shareKey/workerPrefix/API key,
  both car-class lists in full, and the reasoning behind ambiguous entries.
- `docs/TODO.md` — concrete open items, in priority order.
- `docs/DECISIONS.md` — notable design decisions and a couple of debugging
  war stories worth knowing before you repeat them.
