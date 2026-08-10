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
