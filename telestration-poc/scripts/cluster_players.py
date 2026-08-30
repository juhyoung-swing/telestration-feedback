"""Appearance-based re-ID: merge fragmented track IDs into the true ~4 players.

Tracking breaks one person into many IDs (occlusion/crossing). But the players
wear distinct colors, so we cluster fragments by shirt appearance (HSV of the
upper-body crop) into K groups — each group = one physical player — and merge
their foot points into one trajectory. Replaces manual tagging when outfits differ.

Usage: .venv/bin/python cluster_players.py <video> <tracks.json> <players.json> [K]
Output: { video, fps, width, height, step, players: { "1":[{f,t,foot}], … } }  (P1..PK, near→far)
"""
import cv2, json, numpy as np, sys
from collections import defaultdict
from sklearn.cluster import KMeans

video, tj, out = sys.argv[1], sys.argv[2], sys.argv[3]
K = int(sys.argv[4]) if len(sys.argv) > 4 else 4
d = json.load(open(tj)); tr = d["tracks"]
cap = cv2.VideoCapture(video)

def frame_at(f):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(f)); ok, fr = cap.read(); return fr if ok else None

# shirt-appearance descriptor per fragment (median HSV of upper-body crop)
descs = {}
for tid, pts in tr.items():
    pts = sorted(pts, key=lambda e: e["f"])
    cols = []
    for i in np.linspace(0, len(pts) - 1, min(6, len(pts))).astype(int):
        p = pts[i]; fr = frame_at(p["f"])
        if fr is None: continue
        x1, y1, x2, y2 = map(int, p["box"]); bw, bh = x2 - x1, y2 - y1
        crop = fr[max(0, int(y1 + 0.25 * bh)):int(y1 + 0.55 * bh), max(0, int(x1 + 0.2 * bw)):int(x1 + 0.8 * bw)]
        if crop.size == 0: continue
        cols.append(np.median(cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).reshape(-1, 3), axis=0))
    if cols:
        descs[tid] = np.median(cols, axis=0)

tids = list(descs)
X = np.array([descs[t] for t in tids], float)
Hh = X[:, 0] * 2 * np.pi / 180.0; S = X[:, 1] / 255.0; V = X[:, 2] / 255.0
feat = np.stack([np.cos(Hh) * S, np.sin(Hh) * S, V * 0.35], 1)  # hue(circular)+sat, value weak
lab = KMeans(K, n_init=10, random_state=0).fit_predict(feat)
lab = {tids[i]: int(lab[i]) for i in range(len(tids))}

# merge each cluster's foot points into one trajectory (dedupe by frame)
byc = defaultdict(list)
for tid, pts in tr.items():
    c = lab.get(tid)
    if c is None: continue
    for p in pts:
        byc[c].append((p["f"], p["t"], p["foot"]))

groups = []
for c, samples in byc.items():
    samples.sort()
    seen, merged = set(), []
    for f, t, foot in samples:
        if f in seen: continue
        seen.add(f); merged.append({"f": f, "t": t, "foot": foot})
    med_y = float(np.median([m["foot"][1] for m in merged]))
    groups.append((merged, med_y))

groups.sort(key=lambda g: -g[1])  # near (large foot y) first → P1
players = {str(i): g[0] for i, g in enumerate(groups, 1)}

outd = {"video": d["video"], "fps": d["fps"], "width": d["width"], "height": d["height"],
        "step": d.get("step", 1), "players": players}
json.dump(outd, open(out, "w"))
for i, (merged, my) in enumerate(groups, 1):
    t0, t1 = merged[0]["t"], merged[-1]["t"]
    gaps = sum(1 for a, b in zip(merged, merged[1:]) if b["t"] - a["t"] > 1.0)
    print(f"P{i}: {len(merged)} samples, t {t0:.0f}-{t1:.0f}s, medFootY={my:.0f}, gaps>1s={gaps}")
print("wrote", out)
