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

This does a FULL rebuild every run rather than merging new sessions into a
previous result. Incremental merging looks tempting and is subtly wrong
here: `nationCounts` counts each driver once, and which nation gets that
count depends on which session was seen first. A driver who changed nation
would keep their stale count forever under an incremental merge, with
nothing to flag it. A full rebuild is provably identical to the old client
behaviour, and at ~900 files with a thread pool it costs well under a
minute.

Fetching is parallel here on purpose. The browser's version had to go
strictly sequential with a delay between requests, because parallel bursts
were failing on some mobile networks -- that constraint does not exist in
CI, and the comment in index.html explaining it should not be read as
applying to this script.

Usage:
  python scripts/build_driver_index.py [--out data/driver-index.json]
"""
import argparse
import json
import os
import sys
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

# Must stay in step with EXCLUDED_NATIONS in index.html.
EXCLUDED_NATIONS = {
    "REU", "RUS", "ATA", "GLP", "CUW", "UMI", "MTQ", "IRN",
    "BES", "ATF", "GGY", "GIB", "BLM", "NCL", "VGB", "XKX",
}

TIMEOUT = 30
RETRIES = 3
WORKERS = 12


def get_json(url):
    last = None
    for attempt in range(RETRIES):
        try:
            # An explicit User-Agent is required, not cosmetic: Cloudflare
            # rejects urllib's default ("Python-urllib/x.y") with a 403
            # before the request ever reaches the Worker.
            req = urllib.request.Request(url, headers={
                "Accept-Encoding": "identity",
                "User-Agent": "gt3forc3-driver-index/1.0 (+https://gt3forc3.com)",
            })
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:      # noqa: BLE001 - retry anything transient
            last = e
    raise RuntimeError("failed after %d attempts: %s (%s)" % (RETRIES, url, last))


def build_source(source_id, prefix):
    listing = get_json(WORKER_URL + prefix + "/api/v1/results")
    sessions = sorted(
        listing.get("results") or [],
        key=lambda s: s.get("timestamp") or "",
        reverse=True,                      # NEWEST FIRST -- see module docstring
    )

    # Fetch in parallel but KEEP the newest-first ordering when merging:
    # the order results are merged in decides which nation wins.
    def fetch(s):
        try:
            return get_json(WORKER_URL + prefix + s["download_url"])
        except Exception as e:             # noqa: BLE001
            print("    warn: %s (%s)" % (s.get("download_url"), e), file=sys.stderr)
            return None

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        details = list(pool.map(fetch, sessions))

    failures = sum(1 for d in details if d is None)

    seen_players = set()
    nation_counts = {}
    name_to_nation = {}
    name_to_player_id = {}
    player_id_to_names = {}
    player_id_to_nation = {}

    for detail in details:                 # already newest-first
        if not detail:
            continue
        for driver in (detail.get("drivers") or []):
            first = driver.get("first_name") or ""
            last = driver.get("last_name") or ""
            pid = driver.get("player_id")
            nation = driver.get("nation")

            key = pid or ("%s-%s" % (first, last))
            name_key = ("%s %s" % (first, last)).strip().lower()

            if name_key and nation and name_key not in name_to_nation:
                name_to_nation[name_key] = nation

            if name_key and pid:
                if name_key not in name_to_player_id:
                    name_to_player_id[name_key] = pid
                player_id_to_names.setdefault(pid, set()).add(name_key)

            if pid and nation and pid not in player_id_to_nation:
                player_id_to_nation[pid] = nation

            if key in seen_players:
                continue
            seen_players.add(key)

            if not nation or nation in EXCLUDED_NATIONS:
                continue
            nation_counts[nation] = nation_counts.get(nation, 0) + 1

    return {
        "sessionCount": len(sessions),
        "failedSessions": failures,
        "nationCounts": nation_counts,
        "nameToNation": name_to_nation,
        "nameToPlayerId": name_to_player_id,
        # Sets don't survive JSON; the browser rehydrates these, exactly as
        # the old localStorage cache already did.
        "playerIdToNames": {k: sorted(v) for k, v in player_id_to_names.items()},
        "playerIdToNation": player_id_to_nation,
        "seenPlayerKeys": sorted(seen_players),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("data", "driver-index.json"))
    args = ap.parse_args()

    out = {"version": 1, "sources": {}}
    total_failures = 0

    for source_id, prefix in SOURCES.items():
        print("building %s (%s)..." % (source_id, prefix))
        data = build_source(source_id, prefix)
        out["sources"][source_id] = data
        total_failures += data["failedSessions"]
        print("  sessions=%d  drivers=%d  nations=%d  failed=%d" % (
            data["sessionCount"], len(data["seenPlayerKeys"]),
            len(data["nationCounts"]), data["failedSessions"]))

    # Refuse to emit a half-built index. A partial run would silently drop
    # drivers from the country grid and flags from leaderboard rows, and
    # would look exactly like a successful run -- better to fail loudly and
    # leave the previous good file in place.
    if total_failures:
        print("ERROR: %d session fetches failed; refusing to write a partial index"
              % total_failures, file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write("\n")

    print("wrote %s (%.1f KB)" % (args.out, os.path.getsize(args.out) / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
