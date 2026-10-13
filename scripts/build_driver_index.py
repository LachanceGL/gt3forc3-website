#!/usr/bin/env python3
"""
Precompute the driver/nation index the website used to build in the browser.

Why this exists
---------------
index.html used to derive its country grid and per-driver flags by
fetching EVERY session results file for EVERY track, one at a time, in the
visitor's browser. On server1 alone that's 815 files -- measured at ~31 MB
(brotli) and ~4.7 minutes on a cold visit, repeated hourly per visitor,
to produce a nation histogram and a name->nation lookup that are the same
for everybody. Roughly 99.8% of those bytes were parsed and thrown away:
the walk only ever reads `drivers[]`, while each file also carries
collisions, penalties, car standings, lap data and session config.

This script does that aggregation once, server-side, and emits a single
small JSON the site fetches instead.

Correctness note (the part worth not breaking)
----------------------------------------------
The output must match what the browser used to compute, or drivers' flags
silently change. Two properties matter:

  * Sessions are processed NEWEST FIRST.
  * Within that order, the FIRST value seen for a driver wins.

Together those are what make "show the driver's CURRENT nation" work: a
leaderboard row frozen under an old name still resolves to the nation from
that account's most recent session. Reverse the order and every flag
silently reverts to whatever the driver first signed up as.

Incremental downloads, full aggregation
---------------------------------------
Session files are immutable once written, so re-downloading all 1606 of
them every hour was the whole cost: 11m31s by 2026-10-13, growing with the
history, and on one run seven fetches timed out and failed the job.

Each session is now reduced to the three fields this index needs -- guid,
name, nation -- and kept in `data/session-digest.json`. A run downloads
only sessions the digest lacks, then re-aggregates the WHOLE digest from
scratch. 11m31s -> 3.6s with nothing new to fetch.

The split matters. Merging new sessions into a previous *result* is subtly
wrong here: `nationCounts` counts each driver once and which nation gets
that count depends on which session was seen first, so a driver who
changed nation would keep a stale count forever. Re-aggregating everything
every time avoids that entirely -- the newest-first/first-wins rule is
applied to the full history, exactly as before. Only the download is
incremental, never the reasoning.

Verified on the switchover: the rebuilt index is semantically identical to
the one the full-download version produced -- same nation counts, same
name->nation map, same grouping of names into accounts, same per-account
nation -- across all five sources.

Keyed on filename rather than a newest-timestamp cursor, so a session that
shows up late is still picked up. `--rebuild` discards the digest.

Fetching is parallel here on purpose. The browser's version had to go
strictly sequential with a delay between requests, because parallel bursts
were failing on some mobile networks -- that constraint does not exist in
CI, and the comment in index.html explaining it should not be read as
applying to this script.

Usage:
  python scripts/build_driver_index.py [--out data/driver-index.json]
"""
import argparse
import gzip
import json
import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

WORKER_URL = "https://raspy-salad-d894.contact-eb9.workers.dev"

# Keyed by the LEADERBOARDS driver-data source id in index.html, NOT by
# what the track currently displays -- several ids were rebranded to other
# tracks and deliberately kept their original key. kyalami is absent on
# purpose: its config points driverDataSource at "spa", so it shares that
# entry rather than having one of its own.
SOURCES = {
    "nordschleife":    "/server1",
    "spa":             "/server2",
    "redbullring":     "/server3",
    "lagunaseca":      "/server4",
    "nurburgringtour": "/server5",
}

# Nation codes kept out of the country grid entirely.
#
# This is the ONLY copy that does anything. index.html used to hold one too,
# back when the browser built these counts itself, but that walk moved here
# and the client list became dead code -- editing it had no effect at all,
# which is easy to miss because the name still looked authoritative. It has
# been removed, so this is the single place to change.
#
# A change here only reaches the site once data/driver-index.json is
# regenerated (every 15 minutes in CI, or by running this script).
EXCLUDED_NATIONS = {
    "REU", "RUS", "ATA", "GLP", "CUW", "UMI", "MTQ", "IRN",
    "BES", "ATF", "GGY", "GIB", "BLM", "NCL", "VGB", "XKX",
    "TKL", "CXR", "JEY", "VIR", "IMN",
}

# 60s, not the 30 this had: on 2026-10-13 seven of 1606 server1 fetches
# timed out and the whole run failed. Nothing was wrong -- the origin was
# briefly slow, and a 30s ceiling turned that into a hard failure.
TIMEOUT = 60
RETRIES = 4
WORKERS = 12
# Retries used to fire back-to-back, which is the worst thing to do when a
# server is momentarily slow: three attempts land inside the same bad
# moment and all three fail. Wait 1s, 2s, then 4s instead.
RETRY_BACKOFF_S = 1

# json.dump doesn't add one.
NEWLINE = chr(10)


def account_key(guid):
    """Stable string for a driver's account, from the game's own `guid`.

    `guid` is the {a, b} pair on each drivers[] entry, and is what
    laps[].driver_key joins against -- so the game already treats it as
    THE per-account identifier. It survives renames: one account showed a
    single guid across 35 sessions and three months.

    This replaced `player_id` on 2026-10-04. player_id is a Steam id and is
    usually right, but not always: the value 76561197960271872 is attached
    to 128 names carrying 137 distinct guids (a placeholder the server
    reports when it has no real id), and at least one other pair of
    unrelated drivers shares one. Keying identity on it merged people who
    are not the same person. See docs/DECISIONS.md.
    """
    if not guid:
        return None
    a, b = guid.get("a"), guid.get("b")
    if not a and not b:
        return None
    return "%s:%s" % (a, b)


def update_digest(digest, source_id, prefix):
    """Download any session this source has that the digest lacks.

    The digest is the expensive thing made cheap: a session file is
    immutable once written, so there is no reason to download all 1606 of
    them every hour. Each is reduced to the three fields this index needs
    -- guid, name, nation -- and kept.

    Deliberately NOT the same trick as build_all_time.py's cursor. That one
    skips sessions older than the newest it has seen; this keys on filename,
    so a session that shows up late is still picked up.
    """
    have = {e["f"] for e in digest}
    listing = get_json(WORKER_URL + prefix + "/api/v1/results")
    missing = [s for s in (listing.get("results") or [])
               if s["filename"] not in have]
    print("  %s: %d session(s) in digest, %d to fetch"
          % (source_id, len(have), len(missing)))
    if not missing:
        return 0, 0

    def fetch(s):
        try:
            return s, get_json(WORKER_URL + prefix + s["download_url"])
        except Exception as e:             # noqa: BLE001
            print("    warn: %s (%s)" % (s.get("download_url"), e), file=sys.stderr)
            return s, None

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        fetched = list(pool.map(fetch, missing))

    failures = 0
    for s, detail in fetched:
        if detail is None:
            failures += 1
            continue
        rows = []
        for driver in (detail.get("drivers") or []):
            guid = account_key(driver.get("guid"))
            name = ("%s %s" % (driver.get("first_name") or "",
                               driver.get("last_name") or "")).strip()
            if not guid and not name:
                continue
            rows.append([guid, name, driver.get("nation") or ""])
        digest.append({"f": s["filename"], "t": s["timestamp"], "d": rows})
    return len(missing) - failures, failures


def build_registry(digest_by_source):
    """guid -> compact id, assigned in oldest-session-first order.

    Oldest first so the mapping is append-only: a new session can only add
    accounts at the end, leaving every existing id where it was. Newest
    first would renumber most of the file every time somebody new turned
    up, which is the same bytes rewritten for no reason on every commit.

    Ordering is global across sources, not per source, for the same reason:
    numbering server1 then server2 would shift server2 every time server1
    gained an account.
    """
    registry = {}
    everything = []
    for sessions in digest_by_source.values():
        everything.extend(sessions)
    for entry in sorted(everything, key=lambda e: (e["t"], e["f"])):
        for guid, _name, _nation in entry["d"]:
            if guid and guid not in registry:
                registry[guid] = len(registry)
    return registry


def get_json(url):
    last = None
    for attempt in range(RETRIES):
        try:
            # An explicit User-Agent is required, not cosmetic: Cloudflare
            # rejects urllib's default ("Python-urllib/x.y") with a 403
            # before the request ever reaches the Worker.
            req = urllib.request.Request(url, headers={
                # gzip, not identity. A session file is ~4.6MB raw and
                # ~565KB compressed -- eight times less over the wire, which
                # is most of why a full walk took 11 minutes.
                "Accept-Encoding": "gzip",
                "User-Agent": "gt3forc3-driver-index/1.0 (+https://gt3forc3.com)",
            })
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8"))
        except Exception as e:      # noqa: BLE001 - retry anything transient
            last = e
            if attempt < RETRIES - 1:
                time.sleep(RETRY_BACKOFF_S * (2 ** attempt))
    raise RuntimeError("failed after %d attempts: %s (%s)" % (RETRIES, url, last))


def build_source(digest_sessions, accounts):
    """Aggregate one source from its digest entries.

    Takes digest rows rather than fetching: the download is now done once
    per session ever, in update_digest(), instead of once per session per
    run. The aggregation itself is unchanged and still runs over the FULL
    history every time -- it is cheap, and doing it fully is what keeps the
    newest-first/first-wins rule exact rather than approximated.
    """
    details = sorted(digest_sessions, key=lambda s: s["t"], reverse=True)

    seen_accounts = set()
    nation_counts = {}
    name_to_nation = {}
    name_to_account = {}
    account_to_names = {}
    account_to_nation = {}

    for entry in details:                  # already newest-first
        for guid, display_name, nation in entry["d"]:
            account = accounts.get(guid)
            name_key = display_name.strip().lower()
            # Falls back to the name when a driver somehow has no guid, so
            # such a row is still counted once rather than dropped. Measured
            # 2026-10-03: 0 of 23812 driver entries lacked one, so this is
            # belt-and-braces, not a path anything relies on.
            key = account if account is not None else ("name:%s" % name_key)

            if name_key and nation and name_key not in name_to_nation:
                name_to_nation[name_key] = nation

            if name_key and account is not None:
                if name_key not in name_to_account:
                    name_to_account[name_key] = account
                # lowercase key -> the name as the game spells it. The key
                # is what everything matches on; the value is what a reader
                # sees in the "also races as" tooltip, so "FOR DunkMonkey"
                # does not get shown as "for dunkmonkey". Sessions arrive
                # newest-first and the first spelling seen wins, so this is
                # the driver's most recent casing.
                account_to_names.setdefault(account, {}).setdefault(
                    name_key, display_name)

            if account is not None and nation and account not in account_to_nation:
                account_to_nation[account] = nation

            if key in seen_accounts:
                continue
            seen_accounts.add(key)

            if not nation or nation in EXCLUDED_NATIONS:
                continue
            nation_counts[nation] = nation_counts.get(nation, 0) + 1

    return {
        # sessionCount / failedSessions are filled in by main(), which is
        # what now knows about sessions and fetching.
        "nationCounts": nation_counts,
        "nameToNation": name_to_nation,
        "nameToAccount": name_to_account,
        # Sets don't survive JSON; the browser rehydrates these, exactly as
        # the old localStorage cache already did.
        # Sorted by the lowercase key so the order is stable between runs;
        # the values are the display spellings.
        "accountToNames": {
            k: [v for _, v in sorted(names.items())]
            for k, names in account_to_names.items()
        },
        "accountToNation": account_to_nation,
        # str() keys sort against int ones, which plain sorted() refuses.
        "seenAccountKeys": sorted(seen_accounts, key=str),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("data", "driver-index.json"))
    ap.add_argument("--digest", default=os.path.join("data", "session-digest.json"),
                    help="where the per-session cache lives")
    ap.add_argument("--rebuild", action="store_true",
                    help="throw the digest away and re-download every session")
    args = ap.parse_args()

    digest = {}
    if not args.rebuild and os.path.exists(args.digest):
        with open(args.digest, encoding="utf-8") as f:
            digest = json.load(f).get("sources") or {}

    total_failures = 0
    added = 0
    for source_id, prefix in SOURCES.items():
        sessions = digest.setdefault(source_id, [])
        new_count, failures = update_digest(sessions, source_id, prefix)
        added += new_count
        total_failures += failures

    # Refuse to emit a half-built index. A partial run would silently drop
    # drivers from the country grid and flags from leaderboard rows, and
    # would look exactly like a successful run -- better to fail loudly and
    # leave the previous good file in place.
    #
    # The digest is NOT written when this happens either: a session missing
    # from it would never be retried, since update_digest() only fetches
    # what the digest lacks and a half-written one would claim to have it.
    if total_failures:
        print("ERROR: %d session fetches failed; refusing to write a partial index"
              % total_failures, file=sys.stderr)
        return 1

    # One registry over every source, built oldest-first so ids are stable
    # between runs. See build_registry().
    accounts = build_registry(digest)

    out = {"version": 1, "sources": {}}
    for source_id in SOURCES:
        data = build_source(digest[source_id], accounts)
        data["sessionCount"] = len(digest[source_id])
        data["failedSessions"] = 0
        out["sources"][source_id] = data
        print("  %-16s sessions=%-5d drivers=%-6d nations=%d" % (
            source_id, data["sessionCount"], len(data["seenAccountKeys"]),
            len(data["nationCounts"])))

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write(NEWLINE)

    # Written after the index, and only on success, so the two can never
    # disagree about which sessions have been seen.
    with open(args.digest, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "sources": digest}, f,
                  ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write(NEWLINE)

    print(NEWLINE + "%d new session(s) fetched; wrote %s (%.1f KB) and %s (%.1f KB)" % (
        added, args.out, os.path.getsize(args.out) / 1024,
        args.digest, os.path.getsize(args.digest) / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
