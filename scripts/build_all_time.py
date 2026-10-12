#!/usr/bin/env python3
"""
Maintain an accumulating all-time record of every valid lap ever seen.

Why this exists
---------------
AssettoHosting's leaderboards are live, mutable and occasionally lose
entries. Measured on the main Nordschleife board: 2211 rows on 2026-09-11,
1341 on 2026-09-21, 1866 on 2026-10-12. Some of that drop was their own
invalid-lap cleanup and entirely correct, but the small boards have bounced
around too (Touring: 3 -> 1 -> 5 -> 13). If a board is ever reset, those
times are gone and nothing on our side held them.

This file is the thing that holds them. It only ever ADDS: a driver's
fastest valid lap on a track, once recorded, stays recorded even if the
leaderboard and the session file behind it both disappear.

It is a repo-side archive, not a site feature -- nothing fetches it.

What counts as a lap
--------------------
`laps[].flags & 2`, the game's own "this lap counted" bit. Cut laps,
out-laps and idle stints are excluded; an all-time record of invalid laps
would be worthless. See docs/DECISIONS.md.

Keys, and why they are what they are
------------------------------------
**Driver: the raw `guid`.** Everything else in the repo uses the compact
integer ids from build_driver_index.py, but those are assigned per build,
in registry insertion order -- they are NOT stable between runs and would
silently re-point every record in this file. The guid string costs more
bytes, which is exactly why the index compacts it, but that index is
downloaded by every visitor and this file is downloaded by nobody.

**Track: `server prefix | track_name | track_layout_name`, read from the
session itself.** Deliberately not the LEADERBOARDS board id. These servers
get repointed at new tracks and keep their history -- server4 alone has
hosted Spa, Laguna Seca, Road Atlanta, Touristenfahrten and Red Bull Ring
-- so a board id would attach a record to whatever that slot happens to
show today. Reading the track off the session is immune to that.

The server prefix stays in the key on purpose even though the track name
would group them: server2 and server5 both run Touristenfahrten, but with
different car classes, so their times are not comparable.

Incremental, and why that is safe here
--------------------------------------
Each run processes only sessions newer than the stored cursor, so the
first run walks everything (~3 min) and later runs usually see nothing.

That would be wrong for build_driver_index.py, where a nation count
depends on which session was seen first -- it rebuilds fully for that
reason. It is safe here because the merge is a min() over lap times, which
does not care about order or about being applied repeatedly.

Known gap: a session file that appears with a timestamp older than the
cursor is skipped. Timestamps are write times, so this should not happen;
run with --rebuild if it ever does.

Usage:
  python scripts/build_all_time.py [--out data/all-time.json] [--rebuild]
"""
import argparse
import datetime
import gzip
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

WORKER_URL = "https://raspy-salad-d894.contact-eb9.workers.dev"

# Every server, by Worker prefix. No track mapping here on purpose -- the
# track comes from each session, see the module docstring.
PREFIXES = ["/server1", "/server2", "/server3", "/server4", "/server5"]

TIMEOUT = 120
RETRIES = 3
WORKERS = 12

# Bit 1 of laps[].flags: the lap counted toward the session standings.
LAP_COUNTS = 2


def get_json(url):
    last = None
    for _ in range(RETRIES):
        try:
            # Explicit User-Agent is required, not cosmetic: Cloudflare 403s
            # urllib's default before the request reaches the Worker.
            req = urllib.request.Request(url, headers={
                "Accept-Encoding": "gzip",
                "User-Agent": "gt3forc3-all-time/1.0 (+https://gt3forc3.com)",
            })
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8"))
        except Exception as e:      # noqa: BLE001 - retry anything transient
            last = e
    raise RuntimeError("failed after %d attempts: %s (%s)" % (RETRIES, url, last))


def fmt_lap(ms):
    return "%d:%06.3f" % (ms // 60000, (ms % 60000) / 1000.0)


def guid_key(guid):
    if not guid:
        return None
    a, b = guid.get("a"), guid.get("b")
    if not a and not b:
        return None
    return "%s:%s" % (a, b)


def load_existing(path, rebuild):
    if rebuild or not os.path.exists(path):
        return {"version": 1, "cursors": {}, "tracks": {}}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("cursors", {})
    data.setdefault("tracks", {})
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("data", "all-time.json"))
    ap.add_argument("--rebuild", action="store_true",
                    help="ignore the cursors and walk every session again")
    args = ap.parse_args()

    record = load_existing(args.out, args.rebuild)
    cursors = record["cursors"]
    tracks = record["tracks"]

    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    added = improved = 0
    failures = 0

    for prefix in PREFIXES:
        cursor = cursors.get(prefix, "")
        listing = get_json(WORKER_URL + prefix + "/api/v1/results")
        sessions = [s for s in (listing.get("results") or [])
                    if (s.get("timestamp") or "") > cursor]
        print("%s: %d session(s) newer than %s"
              % (prefix, len(sessions), cursor or "(never run)"))
        if not sessions:
            continue

        def fetch(s):
            try:
                return s, get_json(WORKER_URL + prefix + s["download_url"])
            except Exception as e:      # noqa: BLE001
                print("    warn: %s (%s)" % (s.get("download_url"), e),
                      file=sys.stderr)
                return s, None

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            details = list(pool.map(fetch, sessions))

        failed_here = sum(1 for _, d in details if d is None)
        failures += failed_here

        newest = cursor
        for s, detail in sorted(details, key=lambda x: x[0]["timestamp"]):
            if detail is None:
                # Stop the cursor here. Advancing past a session we failed to
                # read would skip it forever, losing whatever it held.
                break
            track_key = "%s|%s|%s" % (prefix,
                                      detail.get("track_name") or "?",
                                      detail.get("track_layout_name") or "")
            drivers = {guid_key(d.get("guid")): d
                       for d in (detail.get("drivers") or [])}
            cars = {guid_key(c.get("car_id")): c.get("model_displayname")
                    for c in (detail.get("cars") or [])}
            # Created lazily: a session with no valid laps -- most of them --
            # would otherwise leave an empty track behind, and a server that
            # once hosted a track for an afternoon would appear here forever
            # with nobody in it.
            bucket = None

            for lap in (detail.get("laps") or []):
                if not (lap["flags"] & LAP_COUNTS):
                    continue
                key = guid_key(lap.get("driver_key"))
                driver = drivers.get(key)
                if not key or not driver:
                    continue
                name = ("%s %s" % (driver.get("first_name") or "",
                                   driver.get("last_name") or "")).strip()
                if not name:
                    continue

                if bucket is None:
                    bucket = tracks.setdefault(track_key, {"drivers": {}})["drivers"]
                entry = bucket.get(key)
                if entry is None:
                    bucket[key] = {
                        "name": name,
                        "car": cars.get(guid_key(lap.get("car_key"))) or "",
                        "ms": lap["time"],
                        "lap": fmt_lap(lap["time"]),
                        "date": s["timestamp"][:10],
                        "session": s["filename"],
                        "recorded": today,
                    }
                    added += 1
                elif lap["time"] < entry["ms"]:
                    entry.update({
                        "name": name,
                        "car": cars.get(guid_key(lap.get("car_key"))) or "",
                        "ms": lap["time"],
                        "lap": fmt_lap(lap["time"]),
                        "date": s["timestamp"][:10],
                        "session": s["filename"],
                    })
                    improved += 1
            newest = max(newest, s["timestamp"])

        cursors[prefix] = newest

    if failures:
        print("note: %d session fetch(es) failed; their cursors were left "
              "behind so the next run retries them" % failures,
              file=sys.stderr)

    # Drop any empty track left by an earlier run, before the lazy create
    # above existed.
    empty = [k for k, t in tracks.items() if not t["drivers"]]
    for key in empty:
        del tracks[key]
    pruned = len(empty)

    total = sum(len(t["drivers"]) for t in tracks.values())
    print()
    for key in sorted(tracks):
        print("  %-52s %5d driver(s)" % (key, len(tracks[key]["drivers"])))
    print("\n%d new record(s), %d improved, %d total across %d track(s)"
          % (added, improved, total, len(tracks)))

    if not added and not improved and not pruned and os.path.exists(args.out):
        # Nothing moved. Rewriting would only bump `generated` and produce a
        # commit with no content -- the trap data/valid-laps.json fell into,
        # which committed an identical file every run until it was fixed.
        print("unchanged; leaving %s as-is" % args.out)
        return 0

    record["generated"] = datetime.datetime.now(datetime.timezone.utc) \
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        # Indented and key-sorted: this file is read by people in diffs, not
        # by the site, and line-oriented JSON keeps those diffs legible and
        # git's deltas small.
        json.dump(record, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    print("wrote %s (%.1f KB)" % (args.out, os.path.getsize(args.out) / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
