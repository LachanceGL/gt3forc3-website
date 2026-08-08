# Gotchas & Hard-Won Lessons

Things that look like bugs, over-engineering, or odd choices but exist because of a real problem hit during development. Read before "simplifying."

## Console scraping correctness

- **"Server updated: X players" only prints when the count *changes*.** On a quiet server, this line can age out of the console's limited scrollback entirely. `getServerPlayerCount()` treats "no fresh line found" as `playerCount: null`, not zero — the caller then falls back to `lastKnownGood[trackName]` rather than showing a wrong "0 players."
- **Stale-line detection:** even when a "Server updated" line IS found, if its own timestamp is more than `STALE_THRESHOLD_MS` (3 min) older than the most recent activity in the log, it's treated as unreliable and nulled out. This prevents an old leftover line from being reported as current.
- **Timezone-safe "now":** never compare console timestamps against `Date.now()` directly — the console's clock may be on a different timezone than the machine running the bot. Always compute `logNow` as the max timestamp actually seen in that page load, and diff against that.
- **"Recently Joined" must ALWAYS be freshly filtered, every single call** — even when the player *count* falls back to a cached value. Early versions had a bug where falling back to `lastKnownGood` also inherited its old, frozen `recentlyJoined` list, causing names to appear "stuck" for hours. Fix: `recentlyJoined: result.recentlyJoined` is explicitly taken from the current scrape, never from the cache, in both fallback branches.
- **Per-server error isolation:** `getServerPlayerCount()` must catch its own errors (timeouts, navigation failures) and return a graceful fallback rather than throwing — because multiple servers are checked via `Promise.all()`, and one rejected promise there used to silently kill the *entire* refresh cycle, including servers that succeeded.

## Discord platform limits (not bugs — actual API constraints)

- **Category/channel renames are rate-limited to 2 per 10 minutes.** The category-rename functions only call `setName()` when the displayed count has actually changed, using a `lastCategoryPlayerCount` cache to skip no-op renames.
- **Buttons/components always render below ALL embeds in a message**, never above, never between multiple embeds in the same message. There is no way to control component vertical position beyond "always last."
- **Button colors are limited to 5 fixed presets** (Primary/blurple, Secondary/gray, Success/green, Danger/red, Link) — no custom hex colors like embeds support.
- **Category/channel names are plain text only** — no markdown (`**bold**`, `__underline__`) renders; it shows literal asterisks/underscores.
- **Embed titles don't support markdown** either, but plain emoji characters work fine as prefixes.
- **`-# text` is real Discord markdown** for small/muted subtext — genuinely renders smaller, confirmed working inside embed descriptions. Distinct from putting text in a code block (which just changes font family to monospace, not actual size).
- **ansi code blocks (` ```ansi `) support a fixed 16-color terminal palette** (codes 30-37, optionally bold `1;`), no "bright"/high-intensity variants. This is the only way to get colored (non-monospace-only) text inside a Discord message from a bot.
- **A single message can hold multiple embeds** but the gap between them is fixed and not directly resizable. The only lever available is inserting a genuinely separate spacer embed (its own margin adds real gap), or accepting the default gap.
- **`DiscordAPIError[10008] Unknown Message`** happens when trying to edit/reply to a message that's been deleted since the bot last touched it. Any `message.edit()` or `interaction.editReply()` call should be wrapped (see `safeEdit()` helper) — an uncaught instance of this in a scheduled loop can crash the whole process if left unhandled at the top level.

## Windows / local dev environment

- **Multiple `node.exe` processes running simultaneously** is a real recurring cause of duplicate behavior (e.g. duplicate welcome messages, a "Refresh" button that silently does nothing because a *different* process instance received the interaction). Always check Task Manager for stray `node.exe` before deep-debugging a "why isn't this working" issue. Note: Adobe Creative Cloud also runs its own bundled `node.exe` processes — don't assume every `node.exe` in Task Manager belongs to this bot; check the `Path` column (`Get-Process node | Select-Object Id, StartTime, Path` in PowerShell).
- **`npm start` vs `node index.js`:** using the npm wrapper adds an extra process layer that was found to make `Ctrl+C` unreliable/slow to actually kill the process on Windows. Prefer `node index.js` directly for local dev.
- **PowerShell execution policy** can block `npm` entirely with a script-signing error. Fix: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or switch the VS Code terminal to Command Prompt instead of PowerShell.
- **A forcefully killed bot process can still show as "online" in Discord for up to a minute or two** — Discord detects disconnects via missed heartbeats, not an explicit signal, when the shutdown wasn't clean. This is normal, not a bug.

## Security

- Bot tokens, admin panel passwords, and API keys pasted into a chat conversation must be treated as compromised immediately, regardless of whether the conversation is "private." Rotate on the source platform (Discord Developer Portal, AssettoHosting panel, etc.) — editing the pasted message doesn't undo the exposure.
- Do not reuse the same password across multiple AssettoHosting server logins — if one is exposed, treat only that one as compromised, not all of them, but this is easier to reason about if passwords aren't shared in the first place.

## Puppeteer resource usage

- Each `getServerPlayerCount()` call launches a **full headless Chromium instance**. With multiple servers checked in parallel every refresh cycle, this is a genuinely non-trivial CPU/memory cost on a machine also being used for other things. If running on a personal PC and noticing slowdowns, first check for orphaned `chrome.exe` processes (can happen after an unclean bot shutdown), then consider increasing `STATUS_REFRESH_INTERVAL_MS`, then consider moving the bot to dedicated hosting (VPS, etc.) if it needs to run 24/7 without impacting the host machine.
