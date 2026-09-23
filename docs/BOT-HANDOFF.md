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

## Request: have the bot trigger the website's data rebuild

Added 2026-09-23. This one is a **request for a small addition to the
bot**, not a review finding — the website side cannot fix it alone.

### The problem

`gt3forc3.com` no longer renders leaderboards straight from
AssettoHosting's live endpoint. It serves `data/valid-laps.json`, rebuilt
from the session results files by a GitHub Actions workflow in the
`gt3forc3-website` repo (`.github/workflows/driver-index.yml`). The rebuild
is what filters out laps the game flagged invalid, so the site is only as
current as the last successful run.

That workflow is on a 15-minute cron. **GitHub does not honour it.**
Measured 2026-09-23 over the preceding 12 scheduled runs, the real gaps
were 2.4, 2.6, 3.0, 3.4, 4.0, 4.0, 4.6, 4.8, 4.9, 5.1 and 5.5 hours.
GitHub treats `schedule` as best-effort and drops runs under load rather
than queueing them; asking four times an hour still yields about five runs
a day. The cron itself is correct on the default branch — this was checked
against the GitHub API, not just the local file.

Practical effect: two drivers set valid laps on the Spa board and were
missing from the site for ~18 hours, while the AssettoHosting embed showed
them immediately. A manual run published them in under a minute.

The fix is something outside GitHub calling the workflow on a real
schedule. The bot is the natural candidate: it already runs 24/7 on a host
that is under our control, and unlike a Cloudflare cron it needs no Worker
deploy — that Worker's last deploy wiped all seven of its credentials and
the cause is still not understood.

### What to add

One timer that POSTs to GitHub's `workflow_dispatch` endpoint. No new
dependency: Node 18+ has global `fetch`, and the host is on v24.

Sketch, matching the existing `*_INTERVAL_MS` + module-level `setInterval`
idiom in `index.js` (`GATEWAY_CHECK_INTERVAL_MS`,
`UPDATE_BADGE_CHECK_INTERVAL_MS`):

```js
// gt3forc3.com serves a leaderboard file rebuilt by GitHub Actions. Its
// own cron is unreliable (GitHub drops scheduled runs under load -- see
// docs/BOT-HANDOFF.md in gt3forc3-website), so this nudges it on a real
// schedule. Optional: unset token => feature simply off, like the other
// optional config here.
const GITHUB_DISPATCH_TOKEN = process.env.GITHUB_DISPATCH_TOKEN || null;
const SITE_REBUILD_INTERVAL_MS = 15 * 60 * 1000;
const SITE_REBUILD_URL =
  'https://api.github.com/repos/LachanceGL/gt3forc3-website' +
  '/actions/workflows/driver-index.yml/dispatches';

async function triggerSiteRebuild() {
  if (!GITHUB_DISPATCH_TOKEN) return;
  try {
    const res = await fetch(SITE_REBUILD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'forc3-discordbot',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    // 204 No Content is success and returns no body.
    if (res.status !== 204) {
      console.warn('[site-rebuild] HTTP %d: %s', res.status, await res.text());
    }
  } catch (err) {
    // Never let this reach the bot's main loop -- a failed nudge just
    // means the site is briefly staler, which is the status quo anyway.
    console.warn('[site-rebuild] failed:', err.message);
  }
}

setInterval(triggerSiteRebuild, SITE_REBUILD_INTERVAL_MS);
```

Deliberately NOT called on startup or on gateway reconnect: a bot that
restart-loops would then hammer the endpoint. The timer is enough.

### The token

A **fine-grained** personal access token, created by the repo owner:

- Repository access: **only** `LachanceGL/gt3forc3-website`
- Permissions: **Actions — Read and write** (nothing else; it does not
  need contents, issues, or anything on other repos)
- Stored as `GITHUB_DISPATCH_TOKEN` in the bot's `.env`, never committed

Rate limits are a non-issue: 5,000 authenticated requests/hour against 96
dispatches/day.

### Why this is cheap on the receiving end

- The workflow takes ~30s and **only commits when the data actually
  changed**, so extra dispatches that find nothing new cost one run and
  produce no commit.
- It already declares `concurrency: driver-index` with
  `cancel-in-progress: false`, so overlapping triggers queue instead of
  racing on the branch.
- The scheduled cron stays in place as a fallback; the two coexist fine.

### How to tell it is working

From the website side: `gh run list --workflow=driver-index.yml` should
start showing `workflow_dispatch` runs about 15 minutes apart, and
`https://gt3forc3.com/data/valid-laps.json` should have a `generated`
timestamp within ~20 minutes of now rather than hours old.

If the bot host is ever down for a long stretch, nothing breaks — the
site just falls back to GitHub's own unreliable schedule.
