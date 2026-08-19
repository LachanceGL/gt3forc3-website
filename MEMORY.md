# Memory

This is the running log — what happened, roughly chronologically, across
working sessions on this repo. It's different from the other docs:

- **`CLAUDE.md`** — current-state reference. Gets *updated* as things
  change, has no history. Read this first, always.
- **`docs/DECISIONS.md`** — deep "why" write-ups for specific technical
  decisions and debugging war stories. Read this before touching
  something that looks like it was already fought over once.
- **This file** — the story of how the repo got here, session by session.
  Append to it; don't rewrite history in it. If you're a future Claude
  session (or human) picking this project up cold, read this top-to-bottom
  for context, then go verify anything load-bearing against the actual
  code — this file is a summary, not a source of truth.

## 2026-08-07 → 2026-08-10 session

Multi-day Claude Code session covering repo setup and a long series of
visual/functional changes to `index.html`. Summarized here; see
`docs/DECISIONS.md` for the "why" behind the entries that involved real
debugging, and `docs/DATA-REFERENCE.md` for exact current values.

**Repo setup**
- Cloned `gt3forc3-website` locally; added this repo's `CLAUDE.md` and
  `docs/` (originally drafted in an earlier, separate conversation before
  the repo existed on disk locally).
- Added `workers.js` to this repo as a **reference copy only** — the
  Cloudflare Worker is deployed manually via the Cloudflare dashboard;
  this file isn't auto-deployed from here, just tracked for visibility.
- Added `bot-reference/` — a point-in-time snapshot of the
  `forc3-discordbot` repo (owned by a *separate* Claude Code conversation)
  for cross-referencing the Worker/bot coupling without editing that repo
  from here.
- Established a standing workflow: **findings relevant to the Discord bot
  get written into `docs/BOT-HANDOFF.md` in this repo**, not implemented
  directly in `forc3-discordbot` — the person pastes the handoff content
  into that other conversation themselves.
- Established a standing workflow: **every change to this repo gets
  committed and pushed immediately**, without asking for confirmation
  first — this is a per-repo default, not a one-time approval.

**Header Discord button restyle**
Iterated through several hover-interaction designs before landing on the
current one. Two real bugs surfaced along the way (see
`docs/DECISIONS.md`): a width-collapse animation that visibly resized a
*sibling* button because of `align-items: stretch` on their shared
container, and a bare `span` CSS selector that accidentally also matched
the icon's own wrapper (also a `<span>`), making the icon fade out along
with the label. Final version uses only `transform`/`opacity` — never
anything that changes layout — and a computed fixed-pixel offset to
recenter the icon.

**Leaderboard tab restyle**
Added a hard-shadow hover/active "lift" interaction to `.leaderboard-tab`
(adapted from a pasted Uiverse.io reference, kept to the site's own
red/purple accents). Tabs shift up-right and cast a solid offset shadow
on hover or when selected. The gradient fill and the shadow color were
later both darkened relative to the border, on request, in two separate
follow-up rounds (the shadow-darkening round was reverted, then
re-applied — current state has both darkened).

**Touring theme: teal → purple**
Full palette swap across both Touring-templated boards — tab text,
gradient, border/shadow accent, corner-note badge, and the "Allowed Cars"
dropdown's CSS-variable theme. See `docs/DATA-REFERENCE.md` for exact hex
values if it needs to move again.

**Track rebrand (the big one — read `docs/DATA-REFERENCE.md`'s warning
section before touching any of these three ids)**
`spa`, `redbullring`, and `lagunaseca` — the `LEADERBOARDS` object keys —
were each repointed to a brand-new AssettoHosting share key mid-session,
changing what each one *displays* without renaming the keys themselves
(kept stable specifically to preserve `kyalami`'s `driverDataSource` link
and the Worker's `TRACK_KEYWORDS` matching, both keyed by these same ids):

- `spa` → now displays "Nürburgring" (Touring, "Road & Track Cars")
- `redbullring` → now displays "Nürburgring GP" (Race, 5 laps — was 10)
- `lagunaseca` → now displays "Spa Francorchamps" (Hot Lap — was Race/10)

All three new share keys initially returned `401` until the person
published them on AssettoHosting's side — not a bug in this repo,
confirmed by curling the raw AssettoHosting URLs directly (bypassing the
Worker and site entirely) to isolate where the failure actually was.

**Two real bugs found and fixed this session**
1. `.leaderboard-tab-corner-note` text wasn't vertically centered. Root
   cause was font-metric/line-height math (default line-height reserves
   uneven space above vs. below cap-height text, and a hug-content flex
   box has no free space for `align-items: center` to redistribute in the
   first place) — not a layout bug. See `docs/DECISIONS.md`.
2. Switching from an empty leaderboard to a different, already-cached one
   left a styled-but-empty `.empty-message` box (red border/background)
   stuck on screen. Root cause: `loadLeaderboard`'s cache-hit fast path
   cleared the status text but never reset its `className`. Reproduced
   the exact scenario before and after the fix to confirm it.

**Logo**
`<img>` → CSS-masked gradient `<div>` (needed for a real multi-color
gradient — `filter` can only push toward one flat recolor tone, same
limitation as the Patreon/Discord icon recoloring elsewhere in this file)
→ briefly an inlined `<svg>` (to color the wordmark and the "Sim Racing
Community" subtitle + flag squares independently, since the source file's
`.cls-1`/`.cls-2` classes already split them) → reverted back to the
masked-div version by explicit request (reason not stated — if asked to
do independent two-part coloring again, inlining is the correct/only
technique, it isn't broken, it was just reverted). Current state: masked
gradient div, **red palette only** (a red→purple gradient was tried and
explicitly rejected — purple is reserved for the Touring theme), and
`box-shadow` instead of `filter: drop-shadow` (avoids forcing the masked
content through an offscreen rasterization pass — same reasoning
confirmed to apply here as for an unrelated project's logo; this specific
change was reverted once, then explicitly re-applied once, so don't be
surprised by the back-and-forth in git history).

**Known live-data quirk (not a code bug — don't try to "fix" this in the
repo)**
The header's server-name status line (`loadServerName`) displays whatever
`server_name` string the AssettoHosting server itself reports in its most
recent session results file — completely independent of what the website
brands that track as, and independent of whether the leaderboard is
"published." Confirmed directly (fetched server4's actual latest session
JSON) that it still said `"GT3FORC3.COM // RACE // Laguna Seca – 10 Laps
/ Q8"` despite the site now branding that track "Spa Francorchamps / Hot
Lap" — fixing this requires a change on AssettoHosting's own control
panel (the server's own name/description setting), not anything here.

## 2026-08-18

**Fixed a stale `TRACK_KEYWORDS` entry in `workers.js` that had been
silently dropping one server's live player count since 2026-08-09.**

The `/discord/stats` endpoint doesn't read player counts from
AssettoHosting — it regex-scrapes the Discord bot's own status embeds and
uses `TRACK_KEYWORDS` to map a track id to the exact embed title the bot
posts. When the bot's servers were renamed/reshuffled on 2026-08-09, four
of the five keywords were updated to match, but `nurburgringtour` was
left on the pre-reshuffle title `"EVO Nürburgring – TOURING #2"`. The bot
actually posts `"EVO Nürburgring – TOURING (H Shifter)"`.

Because the lookup is `endsWith`, the mismatch never threw — it just
matched no embed, so `server_players.nurburgringtour` has been quietly
absent from the stats payload for over a week. The other four ids were
unaffected. Verified against the bot repo's live `GAME_SERVERS` table
(`forc3-discordbot/index.js`) rather than guessing at the title.

**Not deployed by this commit.** `workers.js` has no `wrangler.toml` and
no CI in this repo — it's a manual Cloudflare Workers deploy, so the live
site keeps showing the missing count until the Worker is redeployed.

**Deployed later the same day, and verified live.** The person redeployed
the Worker to Cloudflare by hand. Confirmed from this end rather than
taken on trust:

- `GET /discord/stats` now returns all five ids in `server_players`
  (`nordschleife`, `redbullring`, `lagunaseca`, `spa`, `nurburgringtour`)
  — the route only writes a key when an embed *and* its "N Players
  Online" regex both matched, so a present key proves the match worked.
  `nurburgringtour` had been absent since 2026-08-09.
- The deployed Worker matches this repo's tracked copy: `/discord/stats`
  still sends `Cache-Control: public, max-age=120`, exactly as
  `workers.js` sets it.
- All five `TRACK_KEYWORDS` values compared byte-for-byte against the bot
  repo's live `GAME_SERVERS` `trackName` strings: five exact matches,
  zero orphaned bot titles, and every separator is U+2013 (en dash) on
  both sides — the failure mode most likely to silently break `endsWith`
  again, so it's worth re-checking that specific codepoint if a count
  ever vanishes.

This closes `docs/TODO.md`'s long-standing "never re-verified against a
real posted embed after the rebrand" item.

## 2026-08-18 (later) — why the Nordschleife board feels slow

Investigated a report that the Nordschleife leaderboard takes noticeably
longer to load than the others. **No code changed** — this is a
measurement writeup, and the fix it points to is still open (see
`docs/TODO.md`).

Two unrelated costs, three orders of magnitude apart:

| | Nordschleife | Other boards |
|---|---|---|
| `/rows` payload | 268 KB / 1,581 rows | ~1 KB / ~2 rows |
| `/rows` load time | ~1.6 s | ~0.4 s |
| Session files (`/api/v1/results`) | **815** | 36–39 |
| Driver/flag cold load | **~283 s** | ~12 s |

**The leaderboard table itself is not the problem.** Its ~1.6 s is
AssettoHosting generating a 1,581-row board — timed directly against
`ca.assettohosting.com:10647`, bypassing the Worker entirely: 1.58 s. The
Worker adds ~0.02 s and already brotli-compresses the response for free
(268 KB → 42 KB on the wire, negotiated at the Cloudflare edge; upstream
itself sends it uncompressed). Rendering is capped to
`LEADERBOARD_MAX_ENTRIES` before any DOM is built, so 1,581 rows never
reach the table.

**The slow part is the driver-nationality/flag data.**
`fetchTrackDriverData()` walks every session results file one at a time
with a 30 ms gap between requests. Nordschleife has 815 of them at
~316 ms each ≈ 4.7 minutes cold; that's what the "Loading drivers
data... (This can take some time, only on 1st visit)" message covers, and
why flags trickle in late on that board specifically. If any fetch fails,
the retry re-runs the *entire* 815-file loop, roughly doubling it.

The sequential design is deliberate and should stay — the comment above
the loop records that parallel bursts were failing outright on some
mobile networks. The real lever is that `/serverN/*` is a bare
pass-through with no `Cache-Control` and no `caches.default`, so every
visitor re-fetches all 815 files from origin every hour
(`COUNTRY_CACHE_TTL_MS`). `/discord/stats` already does edge caching
correctly — the pattern exists, it just isn't applied to the proxy
route. A completed session's results file is immutable, which is what
makes caching it safe and effective.

**Then fixed it.** Added a cache layer to the `/serverN/*` proxy,
reusing the `caches.default` pattern `/discord/stats` already used. The
policy lives in `cacheControlFor()` at the bottom of `workers.js`, kept
as a whitelist so a new upstream endpoint has to opt in rather than
silently inherit someone else's TTL: settled session files 30 days
`immutable`, the results list 60s, `/rows` 30s, everything else straight
to origin.

Because the `Cache-Control` goes out on the response, this is also the
*browser's* cache policy — a returning visitor serves the session files
from disk without a request at all, which is where the repeat-visit win
comes from, on top of the edge cache helping first-time visitors.

Two things deliberately guarded, both learned by thinking through what
"immutable" actually promises:

- **Only a `200` is ever cached.** Caching a 401/500 would pin an
  upstream outage in place for the entire TTL — 30 days for a session
  file, unflushable from this repo.
- **A results file isn't hard-cached until it's 2 days old**
  (`isSettledSessionFile()`). The immutability claim only holds *after*
  the session ends; a live session's file can still grow, and pinning a
  partial one would silently drop those drivers from the nationality
  counts. The 2-day threshold is deliberately coarse because the
  filename's date is read as UTC while the three server regions
  (ca/de8/fr) stamp it in their own local time — 2 days clears any real
  offset with a day to spare. It costs ~nothing: all but the newest
  handful of the 815 files are far older than that. An unparseable
  filename is treated as still-changing.

`/rows` landed at 30s rather than the 60–120s first floated — it's the
number a driver refreshes to see their own new lap, and the per-visitor
saving is only ~1.6s regardless. Its real value is collapsing concurrent
viewers on a race night into one origin fetch per window.

Verified `cacheControlFor()`/`isSettledSessionFile()` against real paths
and real filenames (including today's, a 2-day-old one, and a malformed
one) before shipping, since a regex that silently matches nothing would
have looked exactly like success here. **Not deployed** — same manual
Cloudflare deploy story as the `TRACK_KEYWORDS` fix above; this does
nothing live until the Worker is redeployed by hand.
