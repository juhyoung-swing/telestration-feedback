"""공 검출: 전체 축소(현행) vs 2조각 크롭(제안) A/B 비교.

현행 : 1920x1080 -> imgsz 1280  = 0.67배 축소. 10px 공이 6.7px가 된다.
제안 : 코트 영역을 1152x900 두 조각으로 잘라 각각 추론. 공 크기 유지.
"""
import sys, time
import cv2
import numpy as np
from ultralytics import YOLO

VIDEO = "input/match_amateur.mp4"
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 35.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
STRIDE = 2
CONF = 0.05

# 코트가 들어오는 영역만. x 겹침 384px.
TILES = [(0, 180, 1152, 1080), (768, 180, 1920, 1080)]

model = YOLO("models/yolo5_last.pt")
cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0 * fps))

frames = []
n = 0
while len(frames) < int(DUR * fps / STRIDE):
    ok = cap.grab()
    if not ok:
        break
    if n % STRIDE == 0:
        ok, f = cap.retrieve()
        if ok:
            frames.append(f)
    n += 1
cap.release()
print(f"{len(frames)}프레임 ({T0}~{T0+DUR}초)\n")


def run_full(f):
    b = model.predict(f, device="mps", imgsz=1280, conf=CONF, verbose=False)[0].boxes
    return [((float(b.xyxy[k][0])+float(b.xyxy[k][2]))/2,
             (float(b.xyxy[k][1])+float(b.xyxy[k][3]))/2,
             float(b.conf[k]), float(b.xyxy[k][2])-float(b.xyxy[k][0])) for k in range(len(b))]


def run_tiles(f):
    out = []
    for x0, y0, x1, y1 in TILES:
        b = model.predict(f[y0:y1, x0:x1], device="mps", imgsz=1280,
                          conf=CONF, verbose=False)[0].boxes
        for k in range(len(b)):
            cx = (float(b.xyxy[k][0])+float(b.xyxy[k][2]))/2 + x0
            cy = (float(b.xyxy[k][1])+float(b.xyxy[k][3]))/2 + y0
            out.append((cx, cy, float(b.conf[k]),
                        float(b.xyxy[k][2])-float(b.xyxy[k][0])))
    # 겹침 영역 중복 제거 (12px 이내 같은 것으로 봄)
    keep = []
    for d in sorted(out, key=lambda d: -d[2]):
        if not any(abs(d[0]-e[0]) < 12 and abs(d[1]-e[1]) < 12 for e in keep):
            keep.append(d)
    return keep


results = {}
for name, fn in (("현행 축소", run_full), ("2조각 크롭", run_tiles)):
    t0 = time.time()
    per = [fn(f) for f in frames]
    el = time.time() - t0
    allp = np.array([[d[0], d[1]] for fr in per for d in fr]) if any(per) else np.empty((0, 2))
    static = set()
    for i, p in enumerate(allp):
        if (np.abs(allp - p).max(axis=1) < 10).sum() >= len(frames) * 0.15:
            static.add(i)
    # 정적 오탐 제외한 '움직이는 검출'만 집계
    mov, k = [], 0
    for fr in per:
        cur = []
        for d in fr:
            if k not in static:
                cur.append(d)
            k += 1
        mov.append(cur)

    print(f"── {name}  ({el/len(frames)*1000:.0f} ms/프레임, 총 {el:.0f}초)")
    for c in (0.15, 0.25, 0.40):
        rate = sum(1 for fr in mov if any(d[2] >= c for d in fr)) / len(frames) * 100
        print(f"     conf>={c:.2f}  검출률 {rate:5.1f}%")
    cfs = [d[2] for fr in mov for d in fr]
    szs = [d[3] for fr in mov for d in fr]
    if cfs:
        print(f"     움직이는 검출 {len(cfs)}건 | conf 최대 {max(cfs):.3f} "
              f"중앙값 {np.median(cfs):.3f} | 박스 중앙값 {np.median(szs):.1f}px")
    print(f"     정적 오탐 {len(static)}건 제외\n")
    results[name] = mov

# 두 방식이 같은 프레임에서 잡았는지
a = [any(d[2] >= 0.25 for d in fr) for fr in results["현행 축소"]]
b = [any(d[2] >= 0.25 for d in fr) for fr in results["2조각 크롭"]]
both = sum(1 for x, y in zip(a, b) if x and y)
only_b = sum(1 for x, y in zip(a, b) if not x and y)
only_a = sum(1 for x, y in zip(a, b) if x and not y)
print(f"conf>=0.25 기준 — 둘 다 {both} / 크롭만 {only_b} / 축소만 {only_a} "
      f"/ 둘 다 실패 {len(a)-both-only_a-only_b}")
