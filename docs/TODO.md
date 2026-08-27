# Open Items

In rough priority order. Nothing here is a known code bug — these are
things left in a working-but-provisional state, or genuinely deferred
product decisions.

## Needs action outside this repo (AssettoHosting control panel)

- [x] ~~Server4 broadcasts a stale name ("Laguna Seca – 10 Laps / Q8"),
      and servers 2/3 may be stale the same way.~~ **Fixed on
      AssettoHosting's side; re-verified 2026-08-18, closed.** All five
      servers' `server_name` strings were read back from their own latest
      session data and all five now match the site's branding:

      | server | broadcasts |
      |---|---|
      | 1 | `HOT LAP // Nürburgring Nordschleife – Leaderboard` |
      | 2 | `TOURING // Nürburgring – Road & Track Cars – Weather` |
      | 3 | `RACE // Nürburgring GP – 5 Laps / Q5` |
      | 4 | `HOT LAP // Spa Francorchamps – Leaderboard` |
      | 5 | `TOURING // Nürburgring – H SHIFTER Road Cars` |
- [ ] If any *other* `LEADERBOARDS` entry gets repointed to a new share
      key in the future, expect a `401` from `/leaderboards/embed/.../rows`
      until the person publishes it on AssettoHosting's side — not a bug,
      see `docs/DECISIONS.md`.

## Infrastructure

- [x] ~~Set `ASSETTO_API_KEY_5` in the Cloudflare Worker's
      environment.~~ **Already set; verified 2026-08-18, closed.**
      `/api/v1/results` returns `200` through the Worker for all five
      server prefixes, which only happens if each one's Bearer key is
      present server-side.
- [ ] `bot.js` (in `forc3-discordbot`, not this repo): still has server
      entries present but `enabled: false` per that repo's own docs,
      waiting on real `.env` credentials and real status-image URLs. Not
      actionable from here — see `docs/BOT-HANDOFF.md` for the current
      handoff note, and confirm this repo isn't the one that needs to
      change before assuming it's still pending.

## Performance

- [x] ~~**Edge-cache the `/serverN/*` proxy route in `workers.js`.**~~
      **Implemented, still NOT deployed.** No `wrangler.toml` and no CI
      for the Worker in this repo, so it does nothing live until the
      Worker is redeployed to Cloudflare by hand. See `MEMORY.md` for the
      per-route TTLs and the two guards (200-only, and the 2-day
      settle window before a session file is hard-cached).

      **Its rationale changed on 2026-08-26** and it is now much less
      urgent than when it was written. The thing it was meant to rescue
      — the browser walking every session file to build the country grid
      and driver flags — no longer happens: that aggregation moved to
      `scripts/build_driver_index.py`, run hourly in CI, and the site
      fetches one precomputed file instead. Measured after the switch:
      **954 session requests per visit became 12.**

      What the cache would still help: the hourly CI rebuild (currently
      ~2m28s of mostly-repeated fetches of immutable files), and the one
      small walk still done in the browser, `fetchRaceTotalTimes()`.
      (`fetchCrashReport()` was the other, removed with the crash-report
      section on 2026-08-27.) Worth doing, no longer urgent.

## Data accuracy (low urgency, cosmetic/informational only)

- [ ] Spot-check the "unconfirmed guess" car-image pairings listed in
      `docs/DATA-REFERENCE.md` (GT3 Cup trio, GT3 RS pair, Dallara Stradale
      Coupe/Spider) against the actual game if/when possible.
- [x] ~~No confirmed allowed-cars list exists for `spa` (the
      "Nürburgring — Road & Track Cars" board), so its dropdown stays
      hidden.~~ **Answered 2026-08-22, closed.** Per the person, that
      server allows every car except F1 — so there was never a list to
      find, just a rule to state. Added `carClassNote`, a config field
      that renders one line in place of the car table; the dropdown now
      opens as "Road & Track Cars List" and reads "All cars available
      except F1". Still don't reuse `nurburgringtour`'s 29-car list here;
      different servers.

## Product decisions not yet made (deferred, not urgent)

- [ ] Whether to add a `carClassList`/"Allowed Cars" dropdown to Kyalami
      (the only active-ish track without one, alongside `spa` above) —
      wasn't asked for, so left out rather than assumed.
- [x] ~~Whether the Worker's `/discord/stats` `TRACK_KEYWORDS` map needs
      updating after the rebrand.~~ **Verified 2026-08-18, closed.** The
      one genuinely stale keyword (`nurburgringtour`) was fixed and the
      Worker redeployed; live `/discord/stats` now returns all five ids
      in `server_players`, and all five keywords match the bot's
      `GAME_SERVERS` `trackName` strings byte-for-byte (every separator
      U+2013 on both sides). If a per-track count ever vanishes again,
      check that en-dash codepoint first — `endsWith` fails silently on
      a hyphen/en-dash swap.

## Explicitly out of scope for this repo/conversation (not forgotten)

- Anything in `forc3-discordbot` beyond what's written into
  `docs/BOT-HANDOFF.md` — that repo is owned by a separate Claude Code
  conversation. Write findings there; don't implement bot-side fixes from
  here.
