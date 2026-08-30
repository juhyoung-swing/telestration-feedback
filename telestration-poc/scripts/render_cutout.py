"""Person cutout proof: draw a player's segmentation silhouette (yellow outline
+ subtle fill) following them, server-side. Uses yolov8x-seg for per-frame masks
and associates the mask to the chosen player by foot proximity (players.json).

Usage: .venv/bin/python render_cutout.py <video> <players.json> <seg_model.pt> <out.mp4> <pid> <t0> <t1>
"""
import cv2, json, numpy as np, sys, bisect
from ultralytics import YOLO

video, pj, mp, out, pid, t0, t1 = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), float(sys.argv[7])
d = json.load(open(pj)); pts = d["players"][pid]; fps = d["fps"]
fk = [p["f"] for p in pts]; ff = {p["f"]: p["foot"] for p in pts}

def foot_at(f):
    i = bisect.bisect_left(fk, f); cands = [fk[j] for j in (i - 1, i) if 0 <= j < len(fk)]
    if not cands: return None
    b = min(cands, key=lambda k: abs(k - f)); return ff[b] if abs(b - f) <= 5 else None

model = YOLO(mp)
cap = cv2.VideoCapture(video); W = int(cap.get(3)); H = int(cap.get(4))
f0, f1 = int(t0 * fps), int(t1 * fps); cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
YEL = (61, 239, 228); f = f0; drawn = 0
while f <= f1:
    ok, fr = cap.read()
    if not ok: break
    target = foot_at(f)
    if target:
        r = model.predict(fr, classes=[0], imgsz=960, conf=0.35, device="mps", verbose=False)[0]
        if r.masks is not None and len(r.boxes) > 0:
            best, bd = None, 1e18
            for k in range(len(r.boxes)):
                x1, y1, x2, y2 = r.boxes.xyxy[k].tolist()
                dd = ((x1 + x2) / 2 - target[0]) ** 2 + (y2 - target[1]) ** 2
                if dd < bd: bd, best = dd, k
            if best is not None and bd < 130 ** 2:
                poly = r.masks.xy[best].astype(np.int32)
                ov = fr.copy(); cv2.fillPoly(ov, [poly], YEL); cv2.addWeighted(ov, 0.18, fr, 0.82, 0, fr)
                cv2.polylines(fr, [poly], True, YEL, 3)
                drawn += 1
    vw.write(fr); f += 1
cap.release(); vw.release()
print(f"rendered {f1 - f0 + 1} frames, silhouette on {drawn}")
