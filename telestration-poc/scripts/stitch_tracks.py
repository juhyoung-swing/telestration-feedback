"""Stitch fragmented ByteTrack IDs into continuous per-player trajectories.

Long footage breaks a player into many short track IDs (occlusion, net crossings).
This greedily joins a fragment onto the open chain whose last foot point is close
(in image px) within a short time gap — reconstructing one trajectory per person.

Usage:  .venv/bin/python stitch_tracks.py <tracks.json> <players.json>
Output: { video, fps, width, height, step, players: { "1":[{f,t,foot:[x,y]},…], … } }
        players are relabeled P1.. sorted by number of samples (coverage).
"""
import json, sys, math

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))

frags = [sorted(pts, key=lambda e: e["f"]) for pts in d["tracks"].values()]
frags.sort(key=lambda p: p[0]["f"])  # by start frame

MAXGAP = 20  # frames (~0.66s @30fps)
def maxdist(gap): return min(260, 9 * gap + 60)  # more slack for longer gaps
def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])

chains = []  # {last_f, last_foot, pts}
for frag in frags:
    sf, sfoot = frag[0]["f"], frag[0]["foot"]
    best, bestd = None, 1e9
    for ch in chains:
        gap = sf - ch["last_f"]
        if 0 < gap <= MAXGAP:
            dd = dist(ch["last_foot"], sfoot)
            if dd <= maxdist(gap) and dd < bestd:
                best, bestd = ch, dd
    if best is None:
        chains.append({"last_f": frag[-1]["f"], "last_foot": frag[-1]["foot"], "pts": list(frag)})
    else:
        best["pts"].extend(frag)
        best["last_f"], best["last_foot"] = frag[-1]["f"], frag[-1]["foot"]

chains = [c for c in chains if len(c["pts"]) >= 30]
chains.sort(key=lambda c: len(c["pts"]), reverse=True)
players = {
    str(i): [{"f": p["f"], "t": p["t"], "foot": p["foot"]} for p in sorted(c["pts"], key=lambda e: e["f"])]
    for i, c in enumerate(chains, 1)
}

out_d = {k: d[k] for k in ("video", "fps", "width", "height", "step")}
out_d["players"] = players
json.dump(out_d, open(out, "w"))
print(f"{len(d['tracks'])} fragments → {len(players)} players")
for pid, pts in list(players.items())[:8]:
    print(f"  P{pid}: {len(pts)} pts, t {pts[0]['t']:.0f}-{pts[-1]['t']:.0f}s")
print("wrote", out)
