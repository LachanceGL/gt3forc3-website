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

| id | Host:Port | Currently displays as | Format | Worker prefix | API key env var |
|---|---|---|---|---|---|
| 1 | ca.assettohosting.com:10647 | Nordschleife | Hot Lap | `/server1` | `ASSETTO_API_KEY` |
| 2 | de8.assettohosting.com:60350 | "Nürburgring" (Road & Track Cars) | Touring | `/server2` | `ASSETTO_API_KEY_2` |
| 3 | fr.assettohosting.com:60795 | "Nürburgring GP" | Race (5 laps) | `/server3` | `ASSETTO_API_KEY_3` |
| 4 | ca.assettohosting.com:10648 | "Spa Francorchamps" | Hot Lap | `/server4` | `ASSETTO_API_KEY_4` |
| 5 | fr.assettohosting.com:60785 | "Nürburgring" (H Shifter Road Cars) | Touring | `/server5` | `ASSETTO_API_KEY_5` |

**This table has been rewritten more than once as tracks got rebranded —
trust it over your memory of an earlier version of this file.** As of the
latest rewrite: server2 used to display Spa Francorchamps, server3 used to
display Red Bull Ring, server4 used to display Laguna Seca (and before
that, Nürburgring Touring). The `LEADERBOARDS` keys in `index.html` are
`spa`, `redbullring`, and `lagunaseca` respectively — **those ids no
longer match what they display**, on purpose (see below and
`docs/DATA-REFERENCE.md`). If you see old references anywhere (comments,
screenshots, chat history) using the *previous* pairing of host↔track,
that's stale.

Server 2 **used to be** Kyalami; the `kyalami` entry still exists in
`LEADERBOARDS` in `index.html` as a legacy/deactivated entry, its
`driverDataSource` still pointing at the `spa` id purely as a historical
cache-key link — unrelated to what `spa` currently displays.

## `index.html` — key structures to know before editing

- **`LEADERBOARDS`** (a big `const` object, one entry per track id) is the
  single source of truth for how each tab behaves: which Worker prefix/API
  key it uses, its display name, whether it's a Race-template board
  (`isRace: true` + `requiredLaps`), its allowed-cars list, etc. Almost
  every "make X different for track Y" request should be a change to this
  object, not scattered special-casing elsewhere. **The object keys
  (`spa`, `redbullring`, `lagunaseca`, `nurburgringtour`, `nordschleife`,
  `kyalami`) do not all match their current `displayName`** — three of
  them got rebranded to different tracks mid-project while keeping their
  original id, on purpose (see `docs/DATA-REFERENCE.md`'s warning section
  before assuming `id="spa"` means Spa).
- **`GT3_CAR_CLASS_LIST`** — one shared 11-car list, currently reused by
  **three** tracks (Nordschleife, `redbullring`/"Nürburgring GP",
  `lagunaseca`/"Spa Francorchamps") — not four; `spa` (currently
  "Nürburgring") has no car class list at all. Red-themed, button label
  "GT3 Cars List".
- **`nurburgringtour`'s own `carClassList`** (inline in its config entry)
  — 29-car list, purple-themed (was turquoise — see
  `docs/DATA-REFERENCE.md` for the palette swap), button label "Road Cars
  List". Not shared with anything else, including the *other*
  Touring-templated board (`spa`), which has no car list of its own.
- **The "Allowed Cars" dropdown** (`.car-class-dropdown` /
  `renderCarClassSection()` / `renderCarClassRows()`) is a single reused
  DOM widget, not duplicated per track — its button label, panel title,
  subtitle, and accent color (red vs purple) are all set dynamically from
  the active track's `LEADERBOARDS` entry via CSS custom properties
  (`--car-class-accent` etc.) set inline by JS. **Important lesson learned
  the hard way earlier in this project:** its rows are rendered as a real
  `<table>`, not flex `<div>`s — a flex-card version caused a real (still
  not fully understood) text-rendering bug on at least one person's
  browser/GPU that only went away after rebuilding it as a plain table
  using the same pattern as the main leaderboard table. Don't "simplify"
  it back to divs without a good reason.
- **Two tabs both display "Nürburgring"** (`spa` and `nurburgringtour`,
  both Touring-templated) — confirmed, intentional. They're told apart by
  `.leaderboard-tab-corner-note`, a small hardcoded badge on each tab
  ("Road & Track Cars" vs "H Shifter Road Cars"), not by config. If you
  add a new track selector anywhere (the "Get Verified" dropdown already
  had to be updated for this), reuse this same disambiguating text rather
  than inventing new wording.
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
  the `nurburgringtour` `carClassList` — grep for "unconfirmed guess".
- `spa` (currently "Nürburgring", the "Road & Track Cars" board) has no
  `carClassList` at all — no confirmed allowed-cars data exists for that
  specific server/session pool. The "Allowed Cars" dropdown just stays
  hidden for it. Don't reuse `nurburgringtour`'s list for it; they're
  different servers.
- `bot.js` has two server entries (referenced there as Laguna Seca,
  Nürburgring Touring — bot-side naming, may now be stale relative to the
  site's rebrand) present but `enabled: false`, waiting on real `.env`
  credentials and real status-image URLs (currently placeholder filenames
  that likely don't exist yet in the image repo). This is tracked in
  `forc3-discordbot`'s own repo, not fixable from here.
- The Cloudflare Worker needs `ASSETTO_API_KEY_5` set in its environment
  before server5 authenticates for `/api/v1/*` calls (the public
  leaderboard-rows endpoint doesn't need it and already works).
- The Worker's `/discord/stats` `TRACK_KEYWORDS` map is keyed by the same
  `LEADERBOARDS` ids (`spa`, `redbullring`, etc.) and matches against
  `bot.js`'s embed *titles* by substring — since those ids' displayed
  tracks changed but the ids/keywords weren't touched, this should still
  work mechanically (it matches physical-server identity via the bot's
  current embed text, not the site's display name) as long as `bot.js`'s
  own embed titles haven't changed independently. If live per-track player
  counts on the site ever look wrong for one of the three rebranded
  tracks, check this coupling first — see `docs/BOT-HANDOFF.md`.
- The header's live server-name status line reflects whatever
  AssettoHosting itself reports as that server's name/session — this is
  **not** driven by anything in this repo and won't match the site's
  branding until someone updates it on AssettoHosting's own control panel.
  Confirmed stale for server4 as of this writing (still says "Laguna
  Seca... Race... 10 Laps" despite the site showing "Spa Francorchamps /
  Hot Lap"). Not a bug to fix here.
- 🚩 **`www.gt3forc3.com` serves an invalid TLS cert** (`NET::ERR_CERT_COMMON_NAME_INVALID`
  in Chrome, `SEC_E_WRONG_PRINCIPAL` via curl) — confirmed 2026-08-13, reported
  by a user clicking an external Discord link. The apex domain
  (`gt3forc3.com`) serves fine with a valid cert; only `www.` is broken.
  DNS is correct (`www` CNAMEs to `lachancegl.github.io`, resolves to GitHub
  Pages IPs) and `CNAME` in this repo is correct (`gt3forc3.com`) — so this
  is **not fixable by editing repo files**. GitHub Pages has not
  provisioned a cert covering the `www` subdomain, only the apex. No CAA
  record restricts issuance (checked via DNS-over-HTTPS), so it isn't that.
  Fix lives in GitHub repo Settings → Pages: clear the custom domain field,
  save, re-enter `gt3forc3.com`, save again (forces a DNS re-check + cert
  reissue). User did this on 2026-08-13; Pages settings showed "DNS Check
  in Progress" afterward (the expected transient state right after a
  re-save — can take minutes to ~24h per GitHub's docs). **Don't touch the
  custom domain field or Enforce HTTPS again while a check is in
  progress** — editing it restarts the check from scratch. Needs someone
  with repo admin access — Claude has no Pages-settings access. If it's
  still showing "in progress" (or errors out) after a day, that's the
  point to dig further rather than assume it'll self-resolve. Remove this
  note once confirmed fixed.

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
  - Note the tab bar itself doesn't use this pattern for its red/purple
    theming — it's fine to introduce the CSS-variable version for *new*
    themed things, no need to retrofit everything.
- **`box-shadow`, not `filter: drop-shadow`, on anything already using a
  CSS `mask-image` or otherwise being composited/rasterized (the site
  logo is the current example).** `filter` forces the element through an
  offscreen rasterization pass to compute the shadow, which can resample
  a masked/vector graphic's edges at visibly lower quality than normal
  rendering. `box-shadow` reads the element's box geometry directly
  instead, avoiding that — the tradeoff is the shadow becomes a soft
  rectangle around the element's bounding box rather than hugging its
  actual visible silhouette, which matters more the more transparent/
  negative space the element has. Filters on a *parent* wrapping multiple
  unrelated elements have a related but separate problem — see
  `docs/DECISIONS.md`'s "Why `filter: drop-shadow(...)` is applied
  per-element" entry.
- **Hard-shadow hover/active "lift" interaction** (`.leaderboard-tab`,
  originally adapted from a pasted Uiverse.io button reference): on
  hover/when selected, `transform: translate(...)` shifts the element and
  a same-direction `box-shadow` (no blur, solid color) simulates it
  lifting off a flat-colored duplicate of itself. Reuse this pattern
  (rather than reinventing it) for any other "physical button press" style
  request — see git history around when `.leaderboard-tab` got this for
  the exact values.
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

## Workflow conventions for whoever (or whatever) works on this repo

- **Commit and push every change immediately, without asking for
  confirmation first.** This is a standing preference for this repo
  specifically, not a one-time approval — don't revert to "want me to
  push this?" after a quiet stretch.
- **`forc3-discordbot` (the Discord bot) is out of scope for this
  repo/conversation.** It's owned by a separate Claude Code conversation.
  If something you find here is actually a bot-side issue or requires a
  bot-side change, write it into `docs/BOT-HANDOFF.md` (create/update, per
  the pattern already in that file) instead of editing that repo directly
  — the person copies the handoff content over themselves. `bot-reference/`
  in this repo is a read-only, point-in-time snapshot for cross-checking,
  not something to keep in sync or edit.
- **Verify visual/interactive changes against real computed state, not
  just "looks right in the source."** Screenshots and hover-triggered
  CSS transitions have been unreliable in at least one automated preview
  environment used on this project — when that happens, fall back to
  reading actual computed styles / forced pseudo-classes via JS, or to an
  isolated reproduction the person can check in their own browser, rather
  than asserting something works without evidence.

## Where to go next

- `MEMORY.md` — session-by-session log of what's been done on this repo.
  Read this for the story of how things got to their current state.
- `docs/ARCHITECTURE.md` — full system diagram, every endpoint the Worker
  exposes, what each one is for.
- `docs/DATA-REFERENCE.md` — every track's shareKey/workerPrefix/API key,
  both car-class lists in full, and the reasoning behind ambiguous entries
  — **including which `LEADERBOARDS` ids currently display a different
  track than their name suggests.**
- `docs/TODO.md` — concrete open items, in priority order.
- `docs/DECISIONS.md` — notable design decisions and debugging war stories
  worth knowing before you repeat them.
- `docs/BOT-HANDOFF.md` — pending findings for the separate
  `forc3-discordbot` conversation to pick up.
