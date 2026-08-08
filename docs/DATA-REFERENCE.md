# Data Reference

Canonical reference for track config and the two car-class lists. When in
doubt, `index.html`'s `LEADERBOARDS` / `GT3_CAR_CLASS_LIST` constants are
the source of truth — this file explains the *reasoning* behind entries
that aren't self-explanatory.

## Track configuration (`LEADERBOARDS`)

| Track id | Display name | Template | Worker prefix | Theme | Car class |
|---|---|---|---|---|---|
| `nordschleife` | Nordschleife | Hot Lap | `/server1` | red (tab), red (car class) | GT3 (shared) |
| `spa` | Spa Francorchamps (tab shows "SPA") | Hot Lap | `/server2` | red | GT3 (shared) |
| `lagunaseca` | Laguna Seca | Race, 10 laps | `/server4` | red | GT3 (shared) |
| `redbullring` | Red Bull Ring | Race, 10 laps | `/server3` | red | GT3 (shared) |
| `nurburgringtour` | Nürburgring | Touring | `/server5` | turquoise (`.leaderboard-tab-tour`) | own 29-car list |
| `kyalami` | Kyalami | legacy/deactivated | `/server2` (shared history with Spa) | — | — |

Fields worth knowing on each entry:

- `isRace: true` + `requiredLaps: 10` — only present on Race-template
  tracks. `requiredLaps` filters which rows count toward Total Time
  ranking (rows whose actual completed lap count doesn't match this
  exact number get excluded from Race Time mode, and get their Total Time
  struck through in Best Lap mode). **Both current Race tracks are
  confirmed 10 laps** — this was wrong (assumed 5) for a while mid-session
  before being corrected; if a new Race track gets added, don't assume a
  lap count, ask.
- `driverDataSource` — only present where a track's live data should be
  cached under a *different* key than its own track id (used for the
  Kyalami→Spa transition, so historical driver data isn't lost/orphaned
  under the old id).
- `themeClass` — CSS class applied to that track's tab element for visual
  theming beyond the default red (currently only `nurburgringtour` uses
  this, via `.leaderboard-tab-tour`).
- `carClassList` / `carClassButtonLabel` / `carClassSubtitle` /
  `carClassTheme` — drive the "Allowed Cars" dropdown. `carClassTheme` is
  either `"red"` or `"turquoise"` (falls back to turquoise if unset/other
  — see `renderCarClassSection()`).

## Car class: GT3 (shared — Nordschleife, Spa, Laguna Seca, Red Bull Ring)

Defined once as `GT3_CAR_CLASS_LIST`, referenced by all four tracks'
config entries (same array reference, not copies). Button label "GT3 Cars
List", red theme.

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

## Car class: Touring (Nürburgring only, not shared)

Defined inline in the `nurburgringtour` `LEADERBOARDS` entry as
`carClassList`. Button label "Road Cars List", turquoise theme, subtitle
"Manual H Shifter". 29 cars, image URLs under
`fr.assettohosting.com:60785/assets/versions/preset_<slug>_mech_<n>.png`.

Same ascending-ratio-order caveat applies. The one pair with a confirmed
tie (no way to derive order) is **Dallara Stradale Coupe/Spider**, both at
ratio 18.99 — Track (21.34) is unambiguous since it's the outlier.

## Worth double-checking if you inherit this project

Nothing here is *known* wrong — but the guessed pairs above were never
visually confirmed against the live game (no way to do that from this
chat). If you have access to the actual Assetto Corsa server/game client,
a quick spot-check of those specific trims (GT3 Cup ×3, GT3 RS ×2, Dallara
Coupe/Spider) against their preset image files would be worth doing once,
then this note can be deleted.
