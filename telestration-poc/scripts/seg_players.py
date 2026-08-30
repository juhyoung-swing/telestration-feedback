"""Precompute per-player silhouette polygons (for in-app person cutout).

One seg pass over the clip: each frame → person masks (yolov8x-seg) → assign each
mask to the nearest player (players.json foot) → simplify contour (approxPolyDP).
Polygons are in VIDEO px (screen-space, not court — a cutout outlines the body).

Usage: .venv/bin/python seg_players.py <video> <players.json> <seg_model.pt> <cutouts.json> [STEP]
Output: { video, fps, width, height, step, players: { "<pid>": [{f, poly:[[x,y],...]}] } }
"""
import cv2, json, numpy as np, sys, bisect, time
from ultralytics import YOLO

video, pj, mp, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
STEP = int(sys.argv[5]) if len(sys.argv) > 5 else 3
d = json.load(open(pj)); players = d["players"]; fps = d["fps"]

lut = {}
for pid, pts in players.items():
    lut[pid] = ([p["f"] for p in pts], {p["f"]: p["foot"] for p in pts})
def foot_at(pid, f):
    fk, ff = lut[pid]; i = bisect.bisect_left(fk, f); c = [fk[j] for j in (i - 1, i) if 0 <= j < len(fk)]
    if not c: return None
    b = min(c, key=lambda k: abs(k - f)); return ff[b] if abs(b - f) <= STEP + 2 else None

model = YOLO(mp)
cap = cv2.VideoCapture(video); W = int(cap.get(3)); H = int(cap.get(4))
out_players = {pid: [] for pid in players}
f = 0; t0 = time.time()
while True:
    if not cap.grab(): break
    if f % STEP != 0: f += 1; continue
    ok, fr = cap.retrieve()
    if not ok: break
    r = model.predict(fr, classes=[0], imgsz=960, conf=0.35, device="mps", verbose=False)[0]
    if r.masks is not None and len(r.boxes) > 0:
        insts = []
        for k in range(len(r.boxes)):
            x1, y1, x2, y2 = r.boxes.xyxy[k].tolist()
            insts.append(((x1 + x2) / 2, y2, k))
        for pid in players:
            tf = foot_at(pid, f)
            if not tf: continue
            best, bd = None, 130 ** 2
            for cx, cy, k in insts:
                dd = (cx - tf[0]) ** 2 + (cy - tf[1]) ** 2
                if dd < bd: bd, best = dd, k
            if best is not None:
                poly = r.masks.xy[best].astype(np.float32).reshape(-1, 1, 2)
                ap = cv2.approxPolyDP(poly, 2.5, True).reshape(-1, 2)
                out_players[pid].append({"f": f, "poly": [[round(float(x), 1), round(float(y), 1)] for x, y in ap]})
    f += 1
cap.release()
outd = {"video": d["video"], "fps": fps, "width": W, "height": H, "step": STEP, "players": out_players}
json.dump(outd, open(out, "w"))
for pid in out_players: print(f"P{pid}: {len(out_players[pid])} frames")
print("elapsed", round(time.time() - t0, 1), "s")
