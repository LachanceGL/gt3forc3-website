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
- [ ] Whether the Worker's `/discord/stats` `TRACK_KEYWORDS` map needs
      updating now that `spa`/`redbullring`/`lagunaseca` display different
      tracks than their ids suggest. It's keyed by track id and matched
      against `bot.js`'s embed *titles* (physical-server identity, not
      site branding), so it should still work mechanically as long as
      `bot.js`'s own embed text hasn't changed — but this was never
      re-verified against a real posted embed after the rebrand. If live
      per-track player counts look wrong on the site for any of these
      three tracks, check this coupling first.

## Explicitly out of scope for this repo/conversation (not forgotten)

- Anything in `forc3-discordbot` beyond what's written into
  `docs/BOT-HANDOFF.md` — that repo is owned by a separate Claude Code
  conversation. Write findings there; don't implement bot-side fixes from
  here.
