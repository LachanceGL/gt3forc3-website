# Data Reference

Canonical reference for track config and the two car-class lists. When in
doubt, `index.html`'s `LEADERBOARDS` / `GT3_CAR_CLASS_LIST` constants are
the source of truth — this file explains the *reasoning* behind entries
that aren't self-explanatory.

## ⚠️ Track ids no longer match what they display — read this first

Over several rounds of rebranding, three of the five `LEADERBOARDS` keys
now show a **different track than their id name suggests**. The ids were
deliberately kept stable (not renamed to match) so that `kyalami`'s
`driverDataSource: "spa"` link and the Worker's `TRACK_KEYWORDS` matching
(keyed by these same ids) kept working without any other code changes —
see `docs/DECISIONS.md` for the full reasoning. Concretely:

| Track id (in code) | What it currently displays | Physical server |
|---|---|---|
| `nordschleife` | Nordschleife | server1 (unchanged) |
| `spa` | **"Nürburgring"** (Touring, "Road & Track Cars") | server2 — used to display Spa Francorchamps |
| `redbullring` | **"Nürburgring GP"** (Race, 5 laps) | server3 — used to display Red Bull Ring |
| `lagunaseca` | **"Spa Francorchamps"** (Hot Lap) | server4 — used to display Laguna Seca (and before that, Nürburgring Touring) |
| `nurburgringtour` | "Nürburgring" (Touring, "H Shifter Road Cars") | server5 (unchanged) |
| `kyalami` | Kyalami (legacy/deactivated) | shares history with `spa`'s cache, unrelated to `spa`'s current content |

**If you're grepping for "Spa" or "Red Bull Ring" or "Laguna Seca" expecting
to find the track that's currently branded that way, grep for the id in
the table above instead** — `id="spa"` is not Spa anymore, `id="lagunaseca"`
is.

## Track configuration (`LEADERBOARDS`)

| Track id | Display name | Template | Worker prefix | Theme | Car class |
|---|---|---|---|---|---|
| `nordschleife` | Nordschleife | Hot Lap | `/server1` | red | GT3 (shared) |
| `redbullring` | Nürburgring GP | Race, 5 laps | `/server3` | red | GT3 (shared) |
| `lagunaseca` | Spa Francorchamps | Hot Lap | `/server4` | red | GT3 (shared) |
| `spa` | Nürburgring ("Road & Track Cars") | Touring | `/server2` | purple (`.leaderboard-tab-tour`) | **none set** — see below |
| `nurburgringtour` | Nürburgring ("H Shifter Road Cars") | Touring | `/server5` | purple (`.leaderboard-tab-tour`) | own 29-car list |
| `kyalami` | Kyalami | legacy/deactivated | `/server2` (shared history only) | — | — |

Fields worth knowing on each entry:

- `isRace: true` + `requiredLaps` — only present on Race-template tracks.
  `requiredLaps` filters which rows count toward Total Time ranking (rows
  whose actual completed lap count doesn't match this exact number get
  excluded from Race Time mode, and get their Total Time struck through in
  Best Lap mode). **Currently only one Race-type track exists**
  (`redbullring` / "Nürburgring GP", confirmed 5 laps). `lagunaseca` used
  to be Race/10-laps but was converted to Hot Lap during this session's
  rebrand — it has no `isRace`/`requiredLaps` at all now. If a new Race
  track gets added, don't assume a lap count, ask.
- `driverDataSource` — only present where a track's live data should be
  cached under a *different* key than its own track id. Currently only
  `kyalami` has this, set to `"spa"` — a leftover from the original
  Kyalami→Spa transition. **Note:** the `spa` id's own displayed content
  has since changed (it's "Nürburgring" now, not Spa) — this
  `driverDataSource` link is a pure cache-key pointer, unrelated to what
  `spa` currently shows. Don't "fix" it to point somewhere that currently
  says Spa; it was never about display text, only about not losing
  historical driver data under the old id.
- `themeClass` — CSS class applied to that track's tab element for visual
  theming beyond the default red. Both Touring boards (`spa` and
  `nurburgringtour`) use `.leaderboard-tab-tour` (purple).
- `carClassList` / `carClassButtonLabel` / `carClassSubtitle` /
  `carClassTheme` — drive the "Allowed Cars" dropdown. `carClassTheme` is
  either `"red"` or `"purple"` (falls back to purple if unset/other — see
  `renderCarClassSection()`; the literal string used to be `"turquoise"`
  before the Touring theme's colors changed, see below). `spa` has none of
  these fields set at all — no confirmed allowed-cars list exists for that
  specific board yet, so the dropdown just stays hidden for it (this is
  intentional, not a bug — see `docs/TODO.md`).

## Car class: GT3 (shared — Nordschleife, Nürburgring GP, Spa Francorchamps)

Defined once as `GT3_CAR_CLASS_LIST`, referenced by three tracks' config
entries (same array reference, not copies) — **not four**; `spa`
(currently "Nürburgring") does not use it. Button label "GT3 Cars List",
red theme.

11 cars. `ratio` is the raw power-to-weight figure as originally supplied
(unit intentionally not labeled — displayed as-is with a `π` prefix, per
how the source data was formatted). Image URLs are all under
`ca.assettohosting.com:10647/assets/versions/preset_<slug>_mech_<n>.png`.

**Confirmed unambiguous** (unique ratio, or only one trim exists):
Audi R8 LMS GT3 Evo II, BMW M4 GT3 Evo, Ferrari 296 GT3, Ford Mustang GT3,
Porsche 911 GT3 R Rennsport (992) — both GT3 and Unrestricted trims (ratio
differs, order derived from ascending-ratio pattern, see below).

**Unconfirmed guesses** (flagged inline in the source with a comment):
- Porsche 911 GT3 Cup (992) — all three trims (ABS / ABS TC / No ABS No
  TC) share an identical ratio (17.28). Which image file (`mech_1/2/3`) is
  which trim was **assigned in the order the person listed them**, not
  derived from any data — genuinely unconfirmed.
- Porsche 911 GT3 RS (992) — Clubsport and Weissach both confirmed at
  ratio 16.64 (same value). Same situation: file order assigned by listed
  order, unconfirmed.

**The "ascending ratio ⇒ ascending file number" pattern**, referenced
above and used throughout both car lists: when a car has multiple trims
with genuinely different ratios, the lowest-ratio trim consistently turned
out to be `_mech_1` (or `_1` on the Touring list), next-lowest `_2`, etc.
This was *derived*, not assumed — confirmed independently twice (once via
a user-provided screenshot showing a Toyota Supra's in-game ratio badge,
once via the person directly stating the GR86 trim order), then applied
as a working rule to the remaining ambiguous pairs. It **fails silently**
when two trims share the exact same ratio (no signal to sort by), which
is exactly the GT3 Cup trio and GT3 RS pair above.

## Car class: Touring (`nurburgringtour` only — `spa` has none)

Defined inline in the `nurburgringtour` `LEADERBOARDS` entry as
`carClassList`. Button label "Road Cars List", **purple theme** (was
turquoise — the whole Touring palette was swapped this session, see
below), subtitle "Manual H Shifter". 29 cars, image URLs under
`fr.assettohosting.com:60785/assets/versions/preset_<slug>_mech_<n>.png`.

Same ascending-ratio-order caveat applies. The one pair with a confirmed
tie (no way to derive order) is **Dallara Stradale Coupe/Spider**, both at
ratio 18.99 — Track (21.34) is unambiguous since it's the outlier.

`spa` (the *other* Touring-templated board — displays "Nürburgring" with
a "Road & Track Cars" corner-note) has **no `carClassList` at all**. It's
a different server/session pool than `nurburgringtour`, so reusing that
29-car list would have been guessing at data that doesn't apply to it —
left unset instead, per the "don't invent asset/data you don't have"
convention. See `docs/TODO.md`.

## The Touring purple palette (was turquoise)

Both Touring boards share these values, hardcoded in `index.html`'s CSS
(not CSS-variable-driven at the tab level, unlike the car-class dropdown):

| Role | Value |
|---|---|
| Tab rest-state text | `#a78bfa` |
| Gradient dark fill stop (tab hover/active background) | `#4c1d95` |
| Border / hard-shadow accent (tab hover/active) | `#6d28d9` |
| Corner-note badge background | `#2e1065` |
| Corner-note badge text | `#d8b4fe` |
| `--car-class-accent` (dropdown, default + `carClassTheme: "purple"`) | `#6d28d9` |
| `--car-class-accent-hover` | `#5720ae` |
| `--car-class-accent-text` | `#fff` (was `#111` under turquoise — the darker purple needs light text for contrast, unlike the lighter old teal) |

If asked to retheme the Touring boards again, these are every value that
needs to move together.

## Distinguishing the two Touring boards

Both `spa` and `nurburgringtour` display the exact same top-line tab text
("Nürburgring") and the same "Touring" type badge — this is an explicit,
confirmed decision (not an oversight): the person was told this would
create two identically-labeled tabs and confirmed it's fine, because
each tab's **`.leaderboard-tab-corner-note`** (a small badge on the tab
itself, hardcoded in the markup, not config-driven) already tells them
apart: `spa` shows "Road & Track Cars", `nurburgringtour` shows "H Shifter
Road Cars". The "Get Verified" form's track dropdown was updated to use
the same two labels for the same reason (`Nürburgring — Road & Track
Cars` / `Nürburgring — H Shifter`) — keep any future track-selector UI
consistent with this pattern rather than inventing new disambiguating
text.

## Worth double-checking if you inherit this project

Nothing here is *known* wrong — but the guessed pairs above were never
visually confirmed against the live game (no way to do that from this
chat). If you have access to the actual Assetto Corsa server/game client,
a quick spot-check of those specific trims (GT3 Cup ×3, GT3 RS ×2, Dallara
Coupe/Spider) against their preset image files would be worth doing once,
then this note can be deleted.

Also worth knowing: each time a track gets repointed to a brand-new
AssettoHosting share key, the leaderboard-rows endpoint can return `401`
until the leaderboard is manually made public on AssettoHosting's side —
this happened for all three rebranded tracks this session and was
resolved by the person publishing them. If a *new* rebrand ever shows
`401`/empty instead of `[]`, that's very likely the same thing, not a bug
in this repo — test the raw AssettoHosting URL directly with curl to
confirm before assuming otherwise (see `docs/DECISIONS.md`).
