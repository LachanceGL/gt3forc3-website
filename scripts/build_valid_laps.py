#!/usr/bin/env python3
"""
Precompute a VALID-LAP-ONLY leaderboard for builds that ask for one.

Why this exists
---------------
AssettoHosting's leaderboard endpoint ranks a driver's outright fastest
lap and ignores the game's own per-lap validity flag. Their results page
reads that same flag and badges bad laps `Invalid`, so the two views of
one session disagree -- see docs/ARCHITECTURE.md for the evidence and
docs/TODO.md for the upstream report. The practical effect on the site was
cut laps, out-laps and AFK stints outranking clean ones: on 2026-09-12 an
invalid 6:35.421 sat at P2 of the 0.9 board, and three impossible sub-6:00
times sat above it.

The session files carry the flag, so this rebuilds the board from those
instead: `laps[].flags & 2` means the lap counted toward the session
standings. That test was established symmetrically against real data (see
ARCHITECTURE.md), not guessed.

Scope: 0.9 ONLY, deliberately
-----------------------------
0.8 keeps using the live leaderboard endpoint untouched. Rebuilding it the
same way would drop roughly half its entries -- laps set by people who
never recorded a clean one -- and that is a community decision about
historical results, not a data-quality fix. 0.9 is the build people are
actively racing, so it is the one where showing a real ranking matters.

What it emits, and why BOTH parts matter
----------------------------------------
  rows -- best VALID lap per driver, the board itself.
  keys -- "name|M:SS.mmm" for each driver's best lap of ANY validity.

`keys` is not redundant. index.html uses it to tag which rows of the MAIN
leaderboard belong to this build, so they can be excluded from the 0.8
views. Building it from valid laps only would leave an invalid 0.9 lap
untagged, and it would then show up on the 0.8 board labelled 0.8 --
moving the bug rather than fixing it. So `keys` deliberately ignores
validity while `rows` deliberately respects it.

Verified before this script replaced the old path: the keys it produces
tag exactly the same 554 of the main board's 2211 rows as the two
published 0.9 leaderboards did, with zero differences either way.

Usage:
  python scripts/build_valid_laps.py [--out data/valid-laps.json]
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

# Which boards get rebuilt, and from which sessions.
#
# `track` is (track_name, track_layout_name) and is NOT optional padding --
# it is what stops a board being filled with laps from a different circuit.
# These servers get repointed at new tracks and keep their whole history:
# server4 alone has hosted Spa, Laguna Seca, Road Atlanta, Touristenfahrten
# and Red Bull Ring. Without this filter a Laguna Seca 1:23 lands at the top
# of the Spa board, which is exactly what the first run produced.
#
# Every value here was derived from the data, not from the server list in
# CLAUDE.md: for each board, each track in that server's history was scored
# on how many rows of the LIVE leaderboard it explains. In all four cases
# one track explained 100% and every other explained 0%, so there is no
# judgement call buried in these pairs. Re-run that check if a board is
# repointed -- and note the leaderboard itself does NOT follow a repoint,
# so the newest sessions on a server can be a different track from the one
# its board still shows (true of server2 right now).
#
# `builds` entries:
#   version  -- the label; "all" means the board has no version split and
#               these rows ARE the board.
#   cutover  -- optional. First session timestamp belonging to the build.
#               Session data carries no version field anywhere (checked,
#               not assumed), so a build has to be derived from when the
#               lap was set. The 0.9 value is the earliest session holding
#               a lap the published 0.9 leaderboard also lists, with every
#               valid lap before it belonging to 0.8.
#   keys     -- optional. Emit the tagging key set (see module docstring).
#               Only needed where a version split has to be enforced
#               against the main board, i.e. Nordschleife.
BOARDS = {
    "nordschleife": {
        "prefix": "/server1",
        "track": ("Nurburgring", "Nordschleife"),
        "builds": [
            {"version": "0.9", "cutover": "2026-08-26T05:17:19Z", "keys": True},
        ],
    },
    # Displays as "Nürburgring" (Road & Track Cars).
    "spa": {
        "prefix": "/server2",
        "track": ("Nurburgring", "Touristenfahrten"),
        "builds": [{"version": "all"}],
    },
    # Displays as "Nürburgring GP". Race format -- the Total Time column is
    # joined on separately from time_standings and is untouched by this.
    "redbullring": {
        "prefix": "/server3",
        "track": ("Nurburgring", "Gp Strecke"),
        "builds": [{"version": "all"}],
    },
    # Displays as "Spa Francorchamps".
    "lagunaseca": {
        "prefix": "/server4",
        "track": ("Circuit de Spa Francorchamps", "GP"),
        "builds": [{"version": "all"}],
    },
    # Displays as "Nürburgring" (H Shifter Road Cars). Same physical track
    # as `spa` above but a different server, so the two session pools are
    # separate and must not be merged.
    "nurburgringtour": {
        "prefix": "/server5",
        "track": ("Nurburgring", "Touristenfahrten"),
        "builds": [{"version": "all"}],
    },
}

TIMEOUT = 120
RETRIES = 3
WORKERS = 12

# Bit 1 of laps[].flags. Set == the lap counted toward the session
# standings; clear == what the panel's results page badges "Invalid",
# which is a mixed bucket of cuts, out-laps and idle stints.
LAP_COUNTS = 2


def get_json(url):
    last = None
    for _ in range(RETRIES):
        try:
            # Explicit User-Agent is required, not cosmetic: Cloudflare 403s
            # urllib's default before the request reaches the Worker.
            req = urllib.request.Request(url, headers={
                "Accept-Encoding": "gzip",
                "User-Agent": "gt3forc3-valid-laps/1.0 (+https://gt3forc3.com)",
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
    """Milliseconds to the "M:SS.mmm" string the leaderboard endpoint uses."""
    return "%d:%06.3f" % (ms // 60000, (ms % 60000) / 1000.0)


def key_of(guid):
    return (guid["a"], guid["b"])


def build_board(cfg):
    prefix = cfg["prefix"]
    listing = get_json(WORKER_URL + prefix + "/api/v1/results")
    sessions = listing.get("results") or []

    def fetch(s):
        try:
            return s, get_json(WORKER_URL + prefix + s["download_url"])
        except Exception as e:      # noqa: BLE001
            print("    warn: %s (%s)" % (s.get("download_url"), e), file=sys.stderr)
            return s, None

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        details = list(pool.map(fetch, sessions))

    failures = sum(1 for _, d in details if d is None)

    # Keep only sessions actually run on this board's track. See the BOARDS
    # comment: these servers keep the history of every track they have ever
    # hosted, and the leaderboard only ever showed one of them.
    want_track = cfg["track"]
    on_track = []
    other_tracks = 0
    for s, detail in details:
        if detail is None:
            continue
        got = (detail.get("track_name"), detail.get("track_layout_name") or "")
        if got == want_track:
            on_track.append((s, detail))
        else:
            other_tracks += 1

    out = {}
    for build in cfg["builds"]:
        cutover = build.get("cutover")
        best_valid = {}   # driver guid -> row dict
        best_any = {}     # driver name (lower) -> ms, for the tagging keys

        for s, detail in on_track:
            if cutover and s["timestamp"] < cutover:
                continue
            drivers = {key_of(d["guid"]): d for d in (detail.get("drivers") or [])}
            cars = {key_of(c["car_id"]): c.get("model_displayname")
                    for c in (detail.get("cars") or [])}

            for lap in (detail.get("laps") or []):
                driver = drivers.get(key_of(lap["driver_key"]))
                if not driver:
                    continue
                name = ("%s %s" % (driver.get("first_name") or "",
                                   driver.get("last_name") or "")).strip()
                if not name:
                    continue

                # Tagging key: fastest lap regardless of validity, because
                # that is what the MAIN board shows for this driver.
                nk = name.lower()
                if nk not in best_any or lap["time"] < best_any[nk]:
                    best_any[nk] = lap["time"]

                if not (lap["flags"] & LAP_COUNTS):
                    continue
                dk = key_of(lap["driver_key"])
                prev = best_valid.get(dk)
                if prev is None or lap["time"] < prev["_ms"]:
                    best_valid[dk] = {
                        "_ms": lap["time"],
                        "FullName": name,
                        "Nickname": driver.get("nickname") or "",
                        "CarName": cars.get(key_of(lap["car_key"])) or "",
                        "BestLap": fmt_lap(lap["time"]),
                        "SessionType": s.get("session_type") or "Practice",
                        # UTC, matching the live endpoint's SessionDate --
                        # see the timezone section in docs/ARCHITECTURE.md.
                        "SessionDate": s["timestamp"][:10],
                    }

        rows = sorted(best_valid.values(), key=lambda r: r["_ms"])
        for i, r in enumerate(rows):
            r["Position"] = i + 1
            del r["_ms"]

        entry = {"rows": rows}
        if cutover:
            entry["cutover"] = cutover
        # Tagging keys only where a version split has to be enforced against
        # the main board. Emitting them everywhere would just be dead weight
        # in the file -- a board with no versions has nothing to exclude.
        if build.get("keys"):
            entry["keys"] = sorted("%s|%s" % (n, fmt_lap(t))
                                   for n, t in best_any.items())
        out[build["version"]] = entry

    return out, len(sessions), len(on_track), other_tracks, failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join("data", "valid-laps.json"))
    args = ap.parse_args()

    out = {
        "version": 1,
        "generated": datetime.datetime.now(datetime.timezone.utc)
                     .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "boards": {},
    }
    total_failures = 0

    for board_id, cfg in BOARDS.items():
        print("building %s (%s, %s / %s)..."
              % (board_id, cfg["prefix"], cfg["track"][0], cfg["track"][1]))
        builds, session_count, on_track, other_tracks, failures = build_board(cfg)
        out["boards"][board_id] = builds
        total_failures += failures
        print("  %d sessions, %d on this track, %d on other tracks (ignored), %d failed"
              % (session_count, on_track, other_tracks, failures))
        for version, data in builds.items():
            print("  %s: %d valid-lap rows%s"
                  % (version, len(data["rows"]),
                     ", %d tagging keys" % len(data["keys"]) if "keys" in data else ""))
        # A board that filters down to nothing would render as "No
        # Leaderboard active yet", which reads as a broken page rather than
        # as "nobody set a clean lap here". Worth seeing in the log.
        for version, data in builds.items():
            if not data["rows"]:
                print("  WARNING: %s/%s has no valid laps at all"
                      % (board_id, version), file=sys.stderr)

    # Refuse to emit a partial board. A dropped session silently removes
    # somebody's lap -- or worse, leaves it untagged so it resurfaces on the
    # 0.8 board -- and a partial run looks exactly like a successful one.
    # Failing loudly leaves the previous good file in place.
    if total_failures:
        print("ERROR: %d session fetches failed; refusing to write a partial board"
              % total_failures, file=sys.stderr)
        return 1

    # Leave the file alone when nothing but the clock moved.
    #
    # `generated` changes on every run by definition, and this file is one
    # line of JSON, so rewriting it always produces a one-line diff. That
    # silently defeated the workflow's "commit only when the content
    # changed" guard: the first CI run committed a file whose payload was
    # byte-identical to the previous one, and left unfixed it would have
    # done that every hour forever -- exactly what the guard exists to
    # prevent.
    #
    # Comparing the payload here rather than filtering the field out in the
    # workflow keeps the fix next to the field that causes it, and gives
    # `generated` a more useful meaning as a side effect: when the board
    # last actually CHANGED, not when the script last ran.
    if os.path.exists(args.out):
        try:
            with open(args.out, encoding="utf-8") as f:
                existing = json.load(f)
            a = dict(existing)
            b = dict(out)
            a.pop("generated", None)
            b.pop("generated", None)
            if a == b:
                print("unchanged since %s; leaving %s as-is"
                      % (existing.get("generated", "?"), args.out))
                return 0
        except Exception as e:      # noqa: BLE001 - unreadable/corrupt file
            print("  note: could not read existing %s (%s); rewriting"
                  % (args.out, e), file=sys.stderr)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write("\n")

    print("wrote %s (%.1f KB)" % (args.out, os.path.getsize(args.out) / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
