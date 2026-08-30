"""Attach a shirt-color appearance descriptor to each track fragment, so the app
can do user-anchored re-ID: user clicks each player once (→ a fragment → its desc
= anchor), then every fragment is assigned to the nearest anchor in-app.

Usage: .venv/bin/python describe_fragments.py <video> <tracks.json> <fragments.json>
Output: { video, fps, width, height, step,
          tracks: { "<id>": { desc:[H,S,V], pts:[{f,t,foot,box}] } } }
"""
import cv2, json, numpy as np, sys

video, tj, out = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(tj)); tr = d["tracks"]
cap = cv2.VideoCapture(video)

def frame_at(f):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(f)); ok, fr = cap.read(); return fr if ok else None

outtr = {}
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
    desc = [round(float(x), 1) for x in (np.median(cols, 0) if cols else [0, 0, 0])]
    outtr[tid] = {
        "desc": desc,
        "pts": [{"f": p["f"], "t": p["t"], "foot": p["foot"], "box": p["box"]} for p in pts],
    }

outd = {k: d[k] for k in ("video", "fps", "width", "height", "step")}
outd["tracks"] = outtr
json.dump(outd, open(out, "w"))
print("fragments", len(outtr))
