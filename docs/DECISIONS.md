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
