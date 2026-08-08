# Handoff to the forc3-discordbot conversation

Generated 2026-08-07 from a different Claude Code conversation, the one
working in this `gt3forc3-website` repo. That conversation does **not**
edit `forc3-discordbot` — this file exists so its findings can be handed
off to whichever Claude Code conversation actually owns that repo.

`bot-reference/` in this repo is a point-in-time snapshot of
`forc3-discordbot` (`index.js` + its `CLAUDE.md`/`docs/`), copied in for
cross-reference only. It is not kept in sync and should not be edited here
— treat it as read-only context, not a fork.

## Suggested fix: reuse one Puppeteer browser instance

Found while reviewing the website/Worker/bot system for performance. Not
implemented, not measured/profiled — just flagged as worth evaluating.

`index.js` calls `puppeteer.launch()` and `browser.close()` on every single
check, in two separate functions:

- **`getServerPlayerCount(server)`** — launch at `index.js:355`. This is
  the main status-monitoring path: called per-server, in parallel via
  `Promise.all()`, both from the `STATUS_REFRESH_INTERVAL_MS` timer
  (5 min — `index.js:642`) and the on-demand refresh path
  (`index.js:888`), plus a single-server call at `index.js:1102`
  (per-embed "Refresh" button).
- **`getLapTimes()`** — launch at `index.js:101`. Called once per
  invocation of `!bestlap`, `!top5`, `!top10`, and `!online`
  (`index.js:962`, `984`, `1017`, `1050`).

Launching a full Chromium process is the expensive part of Puppeteer, not
the page navigation — `bot-reference/docs/GOTCHAS.md` (in this repo) /
`docs/GOTCHAS.md` (in that repo) already calls this out as a "genuinely
non-trivial CPU/memory cost," especially since multiple `GAME_SERVERS`
launch in parallel every refresh cycle.

**Suggestion:** keep one shared `browser` instance alive (launched once at
startup, or lazily on first use) and open/close only a `page` per check,
instead of relaunching the whole browser every time.

**Tradeoff to weigh:** right now, if Chromium itself crashes mid-check, the
next cycle just launches a fresh one for free — an accidental benefit of
the current approach. A shared instance would need its own crash
detection (e.g. check `browser.isConnected()` before use, wrap in
try/catch, relaunch if it's gone) to not silently lose that self-healing.

## Explicitly not evaluated from the website side

- Whether this actually matters at the current server count / refresh
  interval on real hardware — this is a flagged cost, not a profiled one.
- What to do about `getLapTimes()` pointing at a stale/wrong server
  (`bot-reference/docs/ROADMAP.md` already tracks this as a separate,
  known issue) — if that command family gets fixed or removed, decide
  whether the browser-reuse change still applies to it.
