"""Track A 소규모 정찰 — 지정한 10초 구간만 공 검출.

머신 부담을 최소화하는 구조:
  - seek 1회 후 순차 읽기 (임의 탐색 반복 금지)
  - 프레임을 쌓지 않고 한 장씩 처리 후 즉시 폐기
  - 100회 추론 ≈ 30초
"""
import cv2, json, sys, time
import numpy as np
from ultralytics import YOLO

VIDEO = "input/match_amateur.mp4"
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 35.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
IMGSZ = 1280        # MPS 상한
CONF_FLOOR = 0.05   # 낮게 잡고 임계값별 검출률은 사후 계산

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
step = max(1, round(fps / 10))          # 10Hz 샘플
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0 * fps))   # seek는 여기 한 번뿐

model = YOLO("models/yolo5_last.pt")
print(f"{T0:.1f}~{T0+DUR:.1f}초, {step}프레임당 1회 ({fps/step:.0f}Hz)")

per_frame, dets = [], []
n = 0
t_start = time.time()
best = (-1, None, None)   # (conf, frame, det) — 최고 검출 프레임 보관
while True:
    ok = cap.grab()
    if not ok:
        break
    pos = cap.get(cv2.CAP_PROP_POS_FRAMES) / fps
    if pos > T0 + DUR:
        break
    if n % step == 0:
        ok, frame = cap.retrieve()
        if ok:
            r = model.predict(frame, device="mps", imgsz=IMGSZ,
                              conf=CONF_FLOOR, verbose=False)[0]
            b = r.boxes
            cur = []
            for k in range(len(b)):
                x1, y1, x2, y2 = b.xyxy[k].tolist()
                d = dict(t=round(pos, 2), conf=float(b.conf[k]),
                         cx=round((x1+x2)/2, 1), cy=round((y1+y2)/2, 1),
                         w=round(x2-x1, 1))
                cur.append(d); dets.append(d)
            per_frame.append((round(pos, 2), cur))
            if cur:
                top = max(cur, key=lambda d: d["conf"])
                if top["conf"] > best[0]:
                    best = (top["conf"], frame.copy(), cur)
            del frame
    n += 1
cap.release()
elapsed = time.time() - t_start
print(f"프레임 {len(per_frame)}장 처리, {elapsed:.1f}초 ({elapsed/max(len(per_frame),1)*1000:.0f} ms/장)\n")

print("임계값별 검출률 (공이 1개 이상 잡힌 프레임 비율)")
for c in (0.05, 0.10, 0.15, 0.20, 0.25):
    hit = sum(1 for _, cur in per_frame if any(d["conf"] >= c for d in cur))
    tag = "  <-- ultralytics 기본값" if c == 0.25 else ""
    n_det = sum(1 for d in dets if d["conf"] >= c)
    print(f"  conf>={c:.2f}:  {hit/len(per_frame)*100:5.1f}%   "
          f"({n_det/len(per_frame):.2f}개/프레임){tag}")

if dets:
    pts = np.array([[d["cx"], d["cy"]] for d in dets])
    static_mask = np.array([(np.abs(pts - p).max(axis=1) < 8).sum() >= 5 for p in pts])
    print(f"\n정적 위치 반복 검출: {static_mask.sum()}/{len(dets)}건 "
          f"({static_mask.mean()*100:.0f}%) — 배너·얼룩 오탐 지표")
    mv = [d for d, s in zip(dets, static_mask) if not s]
    print(f"움직이는 검출: {len(mv)}건", end="")
    if mv:
        mc = np.array([d["conf"] for d in mv])
        print(f", conf 최대={mc.max():.3f} 중앙값={np.median(mc):.3f}")
    else:
        print()

json.dump(dict(window=[T0, T0+DUR], n_frames=len(per_frame),
               detections=dets, ms_per_frame=round(elapsed/max(len(per_frame),1)*1000)),
          open("output/trackA_probe.json", "w"), indent=2)

if best[1] is not None:
    img = best[1]
    for d in best[2]:
        x, y, w = int(d["cx"]), int(d["cy"]), max(int(d["w"]), 10)
        cv2.rectangle(img, (x-w, y-w), (x+w, y+w), (0, 0, 255), 2)
        cv2.putText(img, f'{d["conf"]:.2f}', (x-w, y-w-6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    cv2.imwrite("output/probe_best_frame.jpg", img)
    print(f"\n최고 검출 프레임 -> output/probe_best_frame.jpg (conf={best[0]:.3f})")
print("output/trackA_probe.json")
