"""Server-side render: draw a ground halo following a player (proves the pipeline
= the future Export path). foot → H⁻¹ → court center → circle in court → H → polygon.

Usage: .venv/bin/python render_follow.py <video> <players.json> <out.mp4> <pid> <t0> <t1> [radius]
Homography is the known 4-corner calibration for court.mp4 (edit if the clip changes).
"""
import cv2, json, numpy as np, sys, bisect

video, pj, out, pid, t0, t1 = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5]), float(sys.argv[6])
R = float(sys.argv[7]) if len(sys.argv) > 7 else 0.8
d = json.load(open(pj)); pts = d["players"][pid]; fps = d["fps"]

court = np.array([[0, 0], [10.97, 0], [10.97, 23.77], [0, 23.77]], np.float32)
imgc = np.array([[670, 147], [1190, 150], [1770, 884], [75, 883]], np.float32)
H = cv2.getPerspectiveTransform(court, imgc); Hinv = np.linalg.inv(H)

def unproj(x, y):
    p = Hinv @ np.array([x, y, 1.0]); return p[0] / p[2], p[1] / p[2]

def circle_poly(cx, cy, r, n=64):
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    c = np.stack([cx + np.cos(a) * r, cy + np.sin(a) * r, np.ones(n)], 1)
    ip = (H @ c.T).T; ip = ip[:, :2] / ip[:, 2:3]
    return ip.astype(np.int32)

fk = [p["f"] for p in pts]; ff = {p["f"]: p["foot"] for p in pts}

def foot_at(f, max_gap=6):
    # nearest sample within max_gap frames; linear interpolation if between two close samples
    i = bisect.bisect_left(fk, f)
    lo = fk[i - 1] if i - 1 >= 0 else None
    hi = fk[i] if i < len(fk) else None
    if lo is not None and hi is not None and hi - lo <= 2 * max_gap and lo <= f <= hi:
        a, b = ff[lo], ff[hi]; w = (f - lo) / (hi - lo) if hi != lo else 0
        return (a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w)
    cand = [c for c in (lo, hi) if c is not None]
    if not cand: return None
    b = min(cand, key=lambda c: abs(c - f))
    return ff[b] if abs(b - f) <= max_gap else None

cap = cv2.VideoCapture(video); W = int(cap.get(3)); Hh = int(cap.get(4))
f0, f1 = int(t0 * fps), int(t1 * fps); cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, Hh))
YEL = (61, 239, 228); f = f0; drawn = 0
while f <= f1:
    ok, fr = cap.read()
    if not ok: break
    foot = foot_at(f)
    if foot:
        cx, cy = unproj(*foot); poly = circle_poly(cx, cy, R)
        ov = fr.copy(); cv2.fillPoly(ov, [poly], YEL); cv2.addWeighted(ov, 0.22, fr, 0.78, 0, fr)
        cv2.polylines(fr, [poly], True, YEL, 4); drawn += 1
    vw.write(fr); f += 1
cap.release(); vw.release()
print(f"rendered {f1 - f0 + 1} frames, halo on {drawn}")
