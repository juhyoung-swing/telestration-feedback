"""Track A 정찰 — 200프레임만 뽑아 공 검출률을 먼저 잰다.

README "Track A 매몰" 경고 대응. 전체 22분을 태우기 전에 SPEC §3의
폴백 기준(검출률 <30%)에 걸리는지부터 확인한다.
conf를 0.05로 낮춰 한 번만 추론하고, 임계값별 검출률은 사후 계산한다.
"""
import cv2, json
import numpy as np
from ultralytics import YOLO

VIDEO = "input/match_amateur.mp4"
N = 200
IMGSZ = 1280      # MPS 상한 (1920은 DFL conv에서 65536 채널 제한으로 실패)
CONF_FLOOR = 0.05

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
idx = np.linspace(0, total - 1, N).astype(int)

frames, times = [], []
for i in idx:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
    ok, f = cap.read()
    if ok:
        frames.append(f)
        times.append(i / fps)
cap.release()
print(f"{len(frames)} 프레임 샘플 (영상 전체 균등, {total} 중)")

model = YOLO("models/yolo5_last.pt")
res = model.predict(frames, device="mps", imgsz=IMGSZ, conf=CONF_FLOOR, verbose=False)

rows = []
for t, r in zip(times, res):
    b = r.boxes
    for k in range(len(b)):
        x1, y1, x2, y2 = b.xyxy[k].tolist()
        rows.append(dict(t=round(t, 2), conf=float(b.conf[k]),
                         cx=(x1 + x2) / 2, cy=(y1 + y2) / 2, w=x2 - x1, h=y2 - y1))

print(f"\nconf>={CONF_FLOOR} 총 검출 {len(rows)}건")
print("\n임계값별 — 검출률(1개 이상 있는 프레임 비율) / 프레임당 평균 검출 수")
for c in (0.05, 0.10, 0.15, 0.20, 0.25, 0.30):
    hit = [any(r["conf"] >= c for r in rows if r["t"] == t) for t in times]
    n = sum(1 for r in rows if r["conf"] >= c)
    rate = sum(hit) / len(times) * 100
    flag = "  <-- ultralytics 기본값" if c == 0.25 else ""
    print(f"  conf>={c:.2f}: 검출률 {rate:5.1f}%   평균 {n/len(times):.2f}개/프레임{flag}")

if rows:
    cf = np.array([r["conf"] for r in rows])
    sz = np.array([r["w"] for r in rows])
    print(f"\nconfidence 분포: max={cf.max():.3f} p90={np.percentile(cf,90):.3f} "
          f"중앙값={np.median(cf):.3f}")
    print(f"박스 크기(px): 중앙값={np.median(sz):.1f} p10={np.percentile(sz,10):.1f} "
          f"p90={np.percentile(sz,90):.1f}")

    # 정적 오탐 판별: 같은 위치(±8px)에 여러 시각에 걸쳐 반복 등장 = 배너/얼룩
    pts = np.array([[r["cx"], r["cy"]] for r in rows])
    static = 0
    for i, p in enumerate(pts):
        near = np.abs(pts - p).max(axis=1) < 8
        if near.sum() >= 5:      # 5개 이상 시각에서 같은 자리
            static += 1
    print(f"정적 위치 반복 검출: {static}/{len(rows)}건 ({static/len(rows)*100:.0f}%) "
          f"— 높을수록 배너·얼룩 오탐")

json.dump(rows, open("output/trackA_calibration.json", "w"), indent=2)
print("\noutput/trackA_calibration.json")
