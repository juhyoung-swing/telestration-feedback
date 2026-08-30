"""Player tracking → per-frame foot points, in the SAME pixel space as court.mp4.

The app's homography H⁻¹ is defined on the video's intrinsic pixels (1920×1080),
so we run detection ON court.mp4 itself and record each player's foot contact point
(bbox bottom-center). The app later does foot → H⁻¹ → court meters per frame.

Usage:
  .venv/bin/python track_players.py <video> <model.pt> <out.json> [T0] [DUR] [STEP]

Output JSON:
  { video, fps, width, height, step, range:[t0,t1],
    tracks: { "<id>": [ {f, t, foot:[x,y], conf, box:[x1,y1,x2,y2]}, ... ] } }
"""
import cv2, json, sys, time, os
from collections import defaultdict
from ultralytics import YOLO

VIDEO = sys.argv[1]
MODEL = sys.argv[2]
OUT   = sys.argv[3]
T0    = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
DUR   = float(sys.argv[5]) if len(sys.argv) > 5 else 1e9
STEP  = int(sys.argv[6]) if len(sys.argv) > 6 else 1   # process every STEP-th frame
IMGSZ = int(sys.argv[7]) if len(sys.argv) > 7 else 1280
CONF  = 0.30

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
f0 = int(T0 * fps)
cap.set(cv2.CAP_PROP_POS_FRAMES, f0)

model = YOLO(MODEL)
tracks = defaultdict(list)
processed = 0
t_start = time.time()

while True:
    if not cap.grab():
        break
    fidx = int(cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1
    pos = fidx / fps
    if pos > T0 + DUR:
        break
    if (fidx - f0) % STEP != 0:
        continue
    ok, frame = cap.retrieve()
    if not ok:
        break
    r = model.track(frame, persist=True, classes=[0], tracker="bytetrack.yaml",
                    imgsz=IMGSZ, device="mps", conf=CONF, verbose=False)[0]
    b = r.boxes
    if b is not None and b.id is not None:
        for k in range(len(b)):
            x1, y1, x2, y2 = b.xyxy[k].tolist()
            tid = int(b.id[k])
            tracks[tid].append({
                "f": fidx, "t": round(pos, 3),
                "foot": [round((x1 + x2) / 2, 1), round(y2, 1)],
                "conf": round(float(b.conf[k]), 3),
                "box": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            })
    processed += 1

cap.release()
elapsed = time.time() - t_start

# drop noise tracks (too few points)
tracks = {tid: pts for tid, pts in tracks.items() if len(pts) >= 5}
out = {
    "video": os.path.basename(VIDEO), "fps": round(fps, 3),
    "width": W, "height": H, "step": STEP, "range": [T0, T0 + DUR],
    "tracks": {str(tid): pts for tid, pts in tracks.items()},
}
with open(OUT, "w") as fp:
    json.dump(out, fp)

print(f"processed {processed} frames in {elapsed:.1f}s "
      f"({elapsed / max(processed, 1) * 1000:.0f} ms/frame), fps={fps:.2f} {W}x{H}")
print("tracks (id: n points):", {tid: len(pts) for tid, pts in tracks.items()})
print("wrote", OUT)
