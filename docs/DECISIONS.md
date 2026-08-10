# Notable Decisions & Debugging History

Things worth knowing so they don't get re-litigated or re-broken.

## The car-class dropdown: divs → table

**What happened:** the "Allowed Cars" dropdown was originally built as a
CSS grid of flex `<div>` cards. It looked correct in every code review and
in DevTools (confirmed twice — correct DOM, correct computed styles, sane
box dimensions), but consistently rendered with car names visually
"covered" (a solid-looking gray bar over the text, only fragments of
descenders visible) for one person testing it, reproducibly, across
multiple screenshots, in incognito, at multiple zoom levels, on a plain
file open (not just the deployed site).

**What we tried, in order, that did NOT fix it:**
1. Assuming it was a JS bug — reviewed and confirmed clean.
2. Assuming stale cache/wrong file — confirmed same file, hard refresh.
3. Assuming a browser extension (Dark Reader etc.) — same result in
   incognito.
4. Assuming GPU/compositing text-rendering degradation caused by
   `transform` + `opacity` together promoting the panel to its own
   composited layer (a real, documented category of Chromium bug) —
   removed `transform` from the show/hide transition, kept opacity-only.
   Also added explicit `-webkit-font-smoothing`/`text-rendering` hints.
   **Did not fix it.**

**What actually fixed it:** rebuilding the same rows as a real `<table>`
(`<tr><td>`) using the exact CSS pattern the main leaderboard table
already used successfully everywhere else in the file (`th, td { padding,
border-bottom, ... }`), instead of custom flex `<div>` cards.

**Takeaway:** we never fully root-caused *why* the flex version broke for
that person — only that swapping to a plain table fixed it, and a plain
table is simpler and more consistent with the rest of the file's own
conventions anyway. If something in this file visually misbehaves for one
person in a way that looks impossible from the code, and it involves
custom flex/grid layout with `transform`/`opacity` animations, consider
this precedent before spending a long time on exotic theories — a boring
`<table>` rewrite may just be faster and more reliable than diagnosing
further.

## Why the car-class dropdown panel is positioned the way it is

Went through a few iterations:
1. First version: panel opened under the button, which sat at the far
   right of a row — panel ended up overlapping the search box.
2. Fix attempt: kept the button on the right, but anchored the *panel*
   to the left edge of a wider ancestor row. This half-worked but still
   looked disconnected (button top-right, panel appearing far away
   bottom-left).
3. **Final version:** moved the whole button+panel out of the
   right-aligned server-name row entirely, into its own standalone
   left-aligned row directly underneath. Panel opens directly below its
   own button now, both on the left. This is the simplest version and the
   one to keep — don't re-introduce the "button on the right, panel
   anchored elsewhere" split.

## Why car-class theming uses CSS custom properties, not classes

`.car-class-dropdown` is one reused DOM subtree (not duplicated per
track), themed red or turquoise depending on the active track. Rather
than writing two full parallel sets of CSS rules (`.theme-red
.car-class-dropdown-btn { ... }` / `.theme-turquoise
.car-class-dropdown-btn { ... }`), the accent colors are CSS custom
properties (`--car-class-accent`, `--car-class-accent-hover`,
`--car-class-accent-text`) declared once with turquoise defaults on
`.car-class-dropdown`, and overridden inline via
`element.style.setProperty(...)` from `renderCarClassSection()` when the
active track's `carClassTheme` is `"red"`. One set of CSS rules, themed
per-instance. Reuse this pattern for future themed-but-shared widgets
rather than duplicating rule sets per theme.

## Why `filter: drop-shadow(...)` is applied per-element, not on a shared parent

Early attempt: wrap a group of header elements in one container and apply
`filter: drop-shadow(...)` to the container once, for efficiency. This
doesn't work the way you'd expect: `filter` on a parent flattens its
*entire* subtree into one composited layer before applying the shadow —
so a child element can't opt itself out of it, and (per the compositing
bug documented above) it's also a plausible source of the same kind of
text-rendering weirdness. Ended up applying `filter: drop-shadow(...)`
individually to each element that needed it (`.leaderboard-tabs`,
`.leaderboard-server-name`, `.leaderboard-title`, `.rank-toggle-row`,
etc.), specifically so the search box could be excluded and get its own
different (inset) shadow treatment instead. If you need "give this whole
group a shadow" again, apply it per-element, not per-wrapper, unless you
specifically want every element in that subtree to be visually identical
(no exceptions).

## Server4/Nürburgring Touring/Laguna Seca swap

Chronologically: Nürburgring Touring was originally on server4. The
person asked to duplicate it onto a new server5 (temporarily existing as
both `nurburgringtour` and `nurburgringtour2`), then separately asked to
turn the *original* server4 slot into Laguna Seca. End state: `lagunaseca`
now owns server4, `nurburgringtour` was renamed back from
`nurburgringtour2` to plain `nurburgringtour` and now owns server5 (the id
"nurburgringtour2" never made it to shipped code, it was an intermediate
naming state). If you find any old comments/screenshots referencing
"Nürburgring on server4", that's pre-swap and stale.

## Recoloring externally-hosted SVGs via CSS

Used in two places (top Patreon bar icon, footer Patreon icon): since
these are `<img src="....svg">` (not inlined `<svg>`), you can't target
their internal `fill` with CSS — the browser treats them as opaque raster
content. The working technique is `filter: brightness(0) invert(N%)` (for
gray) or `filter: brightness(0) saturate(100%) invert(...) sepia(...)
saturate(...) hue-rotate(...) brightness(...) contrast(...)` (for a
specific hue like red) — `brightness(0)` first flattens every opaque pixel
to solid black regardless of the source file's original color(s), then
the rest of the filter chain recolors that black silhouette to a target
color. Reuse this pattern for any other externally-hosted single-color
icon that needs recoloring; don't try to use `fill`/`color` on an `<img>`,
it won't do anything.

## Why three `LEADERBOARDS` ids don't match what they display

`spa`, `redbullring`, and `lagunaseca` were each repointed to a brand-new
AssettoHosting share key, changing what track/session type they actually
show — but the object keys themselves were deliberately left unrenamed.
Renaming `spa` to something like `nurburgring2` (to match its new
"Nürburgring" branding) would have been the "clean" option, but would
have broken two things that key off that exact id string:
`kyalami.driverDataSource: "spa"` (historical driver-data continuity from
the original Kyalami→Spa transition) and the Worker's `TRACK_KEYWORDS`
map (keyed by these same ids, matched against the bot's embed titles for
live player counts). Keeping the ids stable and only changing the
*display* fields was the smaller, safer diff. The cost is a genuinely
confusing mismatch for anyone reading the code fresh — mitigated by
loud warnings in `docs/DATA-REFERENCE.md` and `CLAUDE.md`, not by fixing
the mismatch itself. If you ever do decide to rename the ids properly,
budget time to also update `kyalami.driverDataSource`, the Worker's
`TRACK_KEYWORDS` keys, and anywhere else that greps for the old id
strings (URL hashes in old links would also silently stop matching a tab).

## A `401` on a freshly-repointed leaderboard usually isn't a bug here

When a `LEADERBOARDS` entry gets pointed at a new AssettoHosting share
key, the `/leaderboards/embed/<key>/rows` endpoint can return `401
Unauthorized` with an empty body — not `200` with `[]` — until the person
publishes that leaderboard on AssettoHosting's own side. This happened for
all three rebranded tracks this session. Confirmed by curling the raw
AssettoHosting URL directly (bypassing both the Worker and the site):

```
curl -s -o /dev/null -w "%{http_code}" "https://<host>:<port>/leaderboards/embed/<key>/rows"
```

If that comes back `401` straight from AssettoHosting (same result
through the Worker), it's almost certainly an AssettoHosting-side
publish/visibility setting, not a code or share-key problem — don't spend
time debugging the Worker's proxy logic for this. Once published, the
same curl returns `200` with `[]` (empty but valid) until real sessions
exist.

## The AssettoHosting server's own name is independent of the site's branding

The header's live status line (`loadServerName()`) doesn't display
anything this repo controls — it fetches AssettoHosting's own
`/api/v1/results`, takes the most recent session, and shows that session's
raw `server_name` field verbatim. That field is set by whatever the
physical server's own name/session-description setting was *at the time
that session was recorded* — a completely separate setting from which
track the site's `LEADERBOARDS` config brands it as, and separate from
whether the leaderboard is "published" (see above). Confirmed directly:
after rebranding `lagunaseca` to "Spa Francorchamps / Hot Lap" and even
after a brand-new session was recorded, that session's `server_name` still
read `"GT3FORC3.COM // RACE // Laguna Seca – 10 Laps / Q8"` — fetched and
inspected the raw JSON directly to confirm this wasn't a caching artifact
on our side. Fixing this requires changing the actual server's own
name/description setting in AssettoHosting's control panel; nothing in
this repo can override or hide it short of not displaying the field at
all (not done, since it's genuinely useful live info otherwise).

## Two real bugs found building the Discord button's hover animation

While giving the header Discord button a hover-lift interaction (icon +
label, similar spirit to the leaderboard tabs' later hard-shadow style):

1. **A width-collapsing hover animation resized a sibling button.** An
   early version animated the label's `max-width`/`margin` to zero on
   hover, intending to shrink the button around just the icon. This
   worked in isolation, but the button sits inside
   `.discord-header-block { align-items: stretch }` alongside the "Get
   Verified" button — shrinking the Discord button's own layout size
   shrank/shifted "Get Verified" too, since `align-items: stretch`
   propagates a shared cross-axis size across siblings. **Fix:** never
   animate anything layout-affecting (`max-width`, `margin`, `padding`)
   on an element whose box size is shared with siblings via stretch —
   `transform`/`opacity` only, which never trigger reflow.
2. **A bare `span` CSS selector also matched an unrelated icon wrapper.**
   The button's icon is wrapped in `<span class="svg-wrapper">` — a
   `<span>`. A rule meant to target only the *label* span
   (`.discord-link span { ... }`) used a bare element selector, which
   also matched the icon's wrapper. Since `.svg-wrapper`'s own rule never
   set `max-width`/`opacity`/`transform`, the label's hover-collapse
   values fell through and applied to the icon too — silently hiding it
   on hover along with the text. **Fix:** gave the label its own
   `.discord-link-label` class and scoped every rule to that instead of
   the bare tag. **Lesson:** if a component has more than one `<span>`
   (or any repeated tag) inside it, a same-tag CSS selector meant for
   "just this one" will silently catch the others too — always check for
   sibling elements sharing a tag before writing a bare-tag rule.

The button's final, stable version does none of the above: only
`transform`/`opacity` change on hover, and the icon reaches visual center
via a computed fixed-pixel `translateX` (derived from the button's own
known, unchanging content-box width) rather than any layout trick.

## `.leaderboard-tab-corner-note` vertical centering needed `line-height`, not `align-items`

The small badge on the two Touring tabs ("Road & Track Cars" / "H Shifter
Road Cars") looked visibly off-center vertically even after adding
`display: inline-flex; align-items: center`. Root cause, in order:

1. The badge's box is sized to hug its own content (no fixed height), so
   there's no *free space* inside it for `align-items: center` to
   distribute in the first place — with a single line of text as the only
   flex item, the "centering" is a no-op.
2. Even where `align-items: center` *does* have free space to work with,
   it centers the text's line box, not the actual glyph ink — default
   (`normal`) line-height reserves more space above cap-height than below
   the baseline for most system fonts, especially for bold/uppercase text,
   so a "centered" line box still doesn't put the visible letters in the
   true middle.

**Fix:** set an explicit `height` and `line-height` to the same value —
per spec, any space *beyond* the font's natural line height that this
introduces gets split evenly above/below, which is a real guarantee
`align-items` doesn't give you here. That closed most of the gap; a small
residual (~1px) asymmetry remained, intrinsic to this specific font's
ascent-vs-cap-height metrics, and was closed with a measured 1px
asymmetric top/bottom padding tweak on top. If another badge like this
ever looks off-center again, reach for `height`/`line-height` parity
first, not more `align-items` tinkering.

## `loadLeaderboard`'s cache-hit path leaked `.empty-message` styling

Switching from an empty leaderboard (which sets
`#leaderboard-status.className = "empty-message"`, a bordered/backgrounded
box) to a *different*, already-cached track left that box's styling stuck
on screen with no text inside it, floating above a leaderboard that
actually had rows. Root cause: `loadLeaderboard`'s "serve from cache
instantly" fast path cleared the status element's `textContent` but never
reset its `className` — the only one of the function's several exit paths
that didn't. Every other path went through the "Loading leaderboard..."
step first, which does reset `className`, so this cache-hit branch was
the one place a previous track's leftover class could survive a switch.
**Fixed** by adding the same `className = ""` reset there. If a similar
"floating empty box over real data" bug shows up elsewhere, check for a
fast/cached path that skips the same reset logic as the normal path.

## Site logo: `<img>` → masked gradient `<div>` → (briefly) inlined `<svg>` → masked gradient `<div>`

The logo went through several forms in one session; if you're reading
history and confused why an inline-SVG attempt isn't there anymore, this
is why:

1. **Started as** a plain `<img src="....svg">`.
2. **Became a CSS-masked gradient `<div>`** (`background:
   linear-gradient(...)` + `mask-image: url(...)` using the same SVG
   purely as a silhouette mask) because a `filter` can only push an
   external `<img>`'s SVG toward one flat recolor tone (same limitation as
   the Patreon/Discord icon recoloring above), not a real multi-color
   gradient.
3. **Briefly inlined as a real `<svg>`** (raw markup pasted into
   `index.html` instead of referenced by URL) specifically to color the
   "GT3FORC3" wordmark and the "Sim Racing Community" subtitle + flag
   squares *independently* — the source file already separates them via
   internal CSS classes (`.cls-1`/`.cls-2`), which only becomes reachable
   by page-level CSS once the SVG is actually in the DOM, not referenced
   by URL. This worked correctly (verified: both parts colored
   independently, accessibility preserved via a real `<title>` element).
4. **Reverted back to the masked-`<div>` version** by explicit request,
   reason not stated. Take this as "the person prefers the single-gradient
   look for now," not "inlining was broken" — if asked again to color the
   wordmark and subtitle independently, inlining is the correct (only)
   technique, and the `.cls-1`/`.cls-2` split is still there in the source
   file whenever it's wanted again.

Separately, the masked `<div>` had `filter: drop-shadow(...)` swapped for
`box-shadow` (see the `box-shadow`-vs-`filter` convention in `CLAUDE.md`)
— this specific swap was reverted once, then explicitly re-applied once,
so as of this writing the logo uses `box-shadow`, but don't be surprised
if git history shows it flip-flopping.
