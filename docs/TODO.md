# Open Items

In rough priority order. Nothing here is a known bug — these are things
that were left in a working-but-provisional state at the end of the
session.

## Infrastructure (needed before things actually work end-to-end)

- [ ] Set `ASSETTO_API_KEY_5` in the Cloudflare Worker's environment
      (dashboard or `wrangler secret put ASSETTO_API_KEY_5`) — without it,
      requests to server5 (Nürburgring Touring) will fail auth.
- [ ] `bot.js`: add to `.env`:
      ```
      SERVER_CONTROL_4_USERNAME=...
      SERVER_CONTROL_4_PASSWORD=...
      SERVER_CONTROL_5_USERNAME=admin
      SERVER_CONTROL_5_PASSWORD=guizmoke
      ```
      then flip `enabled: false` → remove/`true` on the Laguna Seca and
      Nürburgring Touring entries in `GAME_SERVERS` once confirmed working.
- [ ] `bot.js`'s two new `GAME_SERVERS` entries reference placeholder
      image filenames (`evo_status_track_LagunaSeca.jpg`,
      `evo_status_track_NurburgringTour.jpg`) that almost certainly don't
      exist yet in the image repo — upload real status-embed images and
      update those URLs, or the status embeds will render without an
      image.

## Data accuracy (low urgency, cosmetic/informational only)

- [ ] Spot-check the "unconfirmed guess" car-image pairings listed in
      `docs/DATA-REFERENCE.md` (GT3 Cup trio, GT3 RS pair, Dallara Stradale
      Coupe/Spider) against the actual game if/when possible.

## Product decisions not yet made (deferred, not urgent)

- [ ] Whether to add a `carClassList`/"Allowed Cars" dropdown to Kyalami
      (currently the only active-ish track without one) — wasn't asked
      for, so it was left out rather than assumed.
- [ ] Whether the Worker's `/discord/stats` `TRACK_KEYWORDS` needs a
      `redbullring`/`lagunaseca` embed-title keyword tuned to match
      whatever exact string `bot.js` actually posts once those two
      servers go live in the bot — the current keywords (`"Red Bull Ring"`,
      `"Laguna Seca"`) are a substring match against the bot's `trackName`
      field, which should work as-is, but wasn't tested against a real
      posted embed.

## Explicitly out of scope this session (not forgotten, just deferred)

- `bot.js` beyond the two config additions above — the person asked to
  stop touching it mid-session and focus on the website. Don't assume
  it needs more work; ask before making further bot.js changes.
