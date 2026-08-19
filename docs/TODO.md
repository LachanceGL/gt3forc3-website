# Open Items

In rough priority order. Nothing here is a known code bug — these are
things left in a working-but-provisional state, or genuinely deferred
product decisions.

## Needs action outside this repo (AssettoHosting control panel)

- [ ] Server4 (currently `lagunaseca` id, displays "Spa Francorchamps /
      Hot Lap") still broadcasts its own name as `"GT3FORC3.COM // RACE
      // Laguna Seca – 10 Laps / Q8"` — confirmed directly against the
      latest session's raw data. This needs the server's own
      name/session-description setting changed on AssettoHosting's side;
      nothing in this repo can fix it. Worth checking servers 2 and 3
      (`spa`/"Nürburgring" and `redbullring`/"Nürburgring GP") for the
      same staleness, since they were rebranded the same way.
- [ ] If any *other* `LEADERBOARDS` entry gets repointed to a new share
      key in the future, expect a `401` from `/leaderboards/embed/.../rows`
      until the person publishes it on AssettoHosting's side — not a bug,
      see `docs/DECISIONS.md`.

## Infrastructure

- [ ] Set `ASSETTO_API_KEY_5` in the Cloudflare Worker's environment
      (dashboard or `wrangler secret put ASSETTO_API_KEY_5`) — without it,
      `/api/v1/*` requests to server5 will fail auth (the public
      leaderboard-rows endpoint doesn't need it and already works).
      Status unconfirmed as of this writing — verify before assuming it's
      still outstanding.
- [ ] `bot.js` (in `forc3-discordbot`, not this repo): still has server
      entries present but `enabled: false` per that repo's own docs,
      waiting on real `.env` credentials and real status-image URLs. Not
      actionable from here — see `docs/BOT-HANDOFF.md` for the current
      handoff note, and confirm this repo isn't the one that needs to
      change before assuming it's still pending.

## Performance

- [x] ~~**Edge-cache the `/serverN/*` proxy route in `workers.js`.**~~
      **Implemented 2026-08-18 — but NOT deployed.** `workers.js` has no
      `wrangler.toml` and no CI in this repo, so this does nothing live
      until the Worker is redeployed to Cloudflare by hand. Details of
      what was measured and why, kept for context:

      The
      Nordschleife board's driver-nationality/flag data takes ~4.7 min on
      a cold visit: `fetchTrackDriverData()` fetches all **815** session
      files one at a time (~316 ms each + a 30 ms gap), and server1 has
      815 sessions where every other server has 36–39. Measured
      2026-08-18; see `MEMORY.md` for the full numbers.

      Don't "fix" this by parallelizing the loop — it is sequential on
      purpose, because parallel bursts were failing outright on some
      mobile networks (see the comment above the loop). The real problem
      is that `/serverN/*` is a bare pass-through: no `Cache-Control`, no
      `caches.default`, so **every** visitor re-fetches all 815 files
      from origin every hour (`COUNTRY_CACHE_TTL_MS`).
      `/discord/stats` already caches correctly at `workers.js:187` —
      apply that same pattern here:

      | Route | Suggested TTL | Why |
      |---|---|---|
      | `/api/v1/results/<file>` | 30 days | a completed session's result is immutable |
      | `/api/v1/results` (the list) | 60 s | grows when a session ends |
      | `/leaderboards/embed/.../rows` | 60–120 s | "updated every new session" |

      **What shipped**, via `cacheControlFor()` at the bottom of
      `workers.js` — a whitelist, so any endpoint added later has to opt
      in rather than silently inherit a TTL:

      | Route | TTL | Why |
      |---|---|---|
      | `/api/v1/results/<file>`, ≥2 days old | 30 days, `immutable` | that session is over; its file can't change |
      | `/api/v1/results/<file>`, newer | 5 min | the session may still be running |
      | `/api/v1/results` (the list) | 60 s | grows when a session ends |
      | `/leaderboards/embed/.../rows` | 30 s | "updated every new session" |
      | anything else | not cached | goes to origin every time |

      Two guards worth not undoing: only a `200` is ever cached (caching
      a 401/500 would pin an upstream outage for the full TTL, and for a
      session file that's 30 days with no way to flush it from here), and
      `isSettledSessionFile()` refuses to hard-cache a results file until
      it's a full 2 days old, because a still-running session's file can
      still grow and the servers stamp filenames in three different
      regions' local time. An unparseable filename counts as
      still-changing.

      `/rows` landed at 30 s rather than the 60–120 s originally floated:
      it's the number a driver refreshes to see their own new lap on, and
      the per-visitor saving there is only ~1.6 s anyway — the real value
      of caching it is collapsing a busy race night's concurrent viewers
      into one origin fetch per window. Lower it further, or drop the
      `/rows` rule entirely, if even 30 s feels stale; nearly all the
      speedup lives in the session files, not here.

      Note the leaderboard *table* is not the problem and needs no work:
      its ~1.6 s is AssettoHosting generating a 1,581-row board (timed
      directly, bypassing the Worker), the Worker adds ~0.02 s and
      already brotli-compresses it 268 KB → 42 KB, and rendering is
      capped to `LEADERBOARD_MAX_ENTRIES` before any DOM is built.

## Data accuracy (low urgency, cosmetic/informational only)

- [ ] Spot-check the "unconfirmed guess" car-image pairings listed in
      `docs/DATA-REFERENCE.md` (GT3 Cup trio, GT3 RS pair, Dallara Stradale
      Coupe/Spider) against the actual game if/when possible.
- [ ] No confirmed allowed-cars list exists for `spa` (the "Nürburgring —
      Road & Track Cars" board). It currently has no `carClassList` at
      all, so the "Allowed Cars" dropdown just stays hidden for it. If a
      real car list for that specific server/session pool is ever
      provided, add it — don't reuse `nurburgringtour`'s 29-car list,
      they're different servers.

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
