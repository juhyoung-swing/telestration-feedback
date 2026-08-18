"""랠리 경계 검출 — 화면 픽셀 기반 (코트 좌표 정밀도에 의존하지 않음).

코트 좌표는 '이 사람이 코트 위인가'를 가리는 영역 판별에만 쓴다(50cm 오차 허용).
속도는 화면상 이동 픽셀을 선수 상자 높이(=1.75m)로 나눠서 구한다.
그러면 호모그래피 오차가 속도에 섞이지 않는다.

랠리는 '정지 구간과 정지 구간 사이'로 잡는다. 정지는 포인트 사이에만 일어나므로
랠리 중간이 잘리지 않는다(화면 변화량 방식의 결함이 여기서 없어진다).

  python rally_scan_px.py <태그> [시작초] [길이초]
"""
import json, os, sys
import cv2
import numpy as np
from ultralytics import YOLO

TAG = sys.argv[1] if len(sys.argv) > 1 else "match_f"
T0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
DUR = float(sys.argv[3]) if len(sys.argv) > 3 else 180.0
VIDEO = f"input/{TAG}.mp4"
HZ, PERSON_H = 5.0, 1.75
STILL_SPD, STILL_MIN = 0.55, 0.6      # m/s, 초

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, L/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])
KP = np.float32(json.load(open(f"kp_{TAG}.json")))
Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
tc = lambda p: cv2.perspectiveTransform(np.float32([[p]]), Hm).reshape(2)

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
step = max(1, int(round(fps/HZ))); dt = step/fps
model = YOLO("yolov8x.pt")   # 원거리 선수 검출률 85% -> 93%
print(f"{TAG}: {T0:.0f}~{T0+DUR:.0f}초, {fps/step:.1f}Hz", flush=True)

cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
frames, n = [], 0
while n < int(DUR*fps):
    ok = cap.grab()
    if not ok:
        break
    if n % step == 0:
        ok, f = cap.retrieve()
        if ok:
            b = model.predict(f, device="mps", imgsz=1280, conf=.25, classes=[0],
                              verbose=False)[0].boxes
            pl = []
            for k in range(len(b)):
                x1, y1, x2, y2 = b.xyxy[k].tolist()
                h = y2-y1
                if h < 20:                       # 너무 작으면 관중
                    continue
                wx, wy = tc(((x1+x2)/2, min(y2, H-1)))
                if -4 < wx < WD+4 and -4 < wy < L+4:      # 영역 판별에만 사용
                    pl.append(dict(c=((x1+x2)/2, y2), h=h))
            frames.append((T0+n/fps, pl))
    n += 1
cap.release()
cnt = [len(p) for _, p in frames]
print(f"샘플 {len(frames)}개 | 코트 위 인원 중앙값 {np.median(cnt):.0f}명 "
      f"(분포 {np.bincount(cnt).tolist()})", flush=True)

# 화면 픽셀 이동 -> 선수 키로 정규화 -> m/s
spd = np.zeros(len(frames))
for i in range(1, len(frames)):
    prev, cur = frames[i-1][1], frames[i][1]
    if len(prev) < 2 or len(cur) < 2:     # 둘 다 안 보이면 직전 값 유지 (오판 방지)
        spd[i] = spd[i-1]; continue
    v = []
    for p in cur:
        d = min(np.hypot(p["c"][0]-q["c"][0], p["c"][1]-q["c"][1]) for q in prev)
        ppm = p["h"]/PERSON_H                    # 그 선수 위치에서의 픽셀당 미터
        if d/ppm < 4.0:                          # 4m 이상 점프는 매칭 실패
            v.append(d/ppm/dt)
    spd[i] = max(v) if v else spd[i-1]
sm = np.convolve(spd, np.ones(3)/3, mode="same")
print(f"속도 분포: p10={np.percentile(sm,10):.2f} 중앙값={np.median(sm):.2f} "
      f"p90={np.percentile(sm,90):.2f} m/s", flush=True)

still = sm < STILL_SPD
runs, st = [], None
for i, x in enumerate(still):
    if x and st is None:
        st = i
    if not x and st is not None:
        if (i-st)*dt >= STILL_MIN:
            runs.append((st, i))
        st = None
if st is not None and (len(frames)-st)*dt >= STILL_MIN:
    runs.append((st, len(frames)-1))

rallies = []
for k, (a, b) in enumerate(runs):
    s = frames[min(b, len(frames)-1)][0]
    e = frames[runs[k+1][0]][0] if k+1 < len(runs) else frames[-1][0]
    if e - s >= 2.0:
        rallies.append(dict(no=len(rallies)+1, start=round(s, 2), end=round(e, 2),
                            dur=round(e-s, 2)))
play = sum(r["dur"] for r in rallies)
print(f"\n정지 구간 {len(runs)}개 -> 랠리 {len(rallies)}개", flush=True)
for r in rallies:
    print(f"  {r['no']:2d}  {r['start']:7.1f}~{r['end']:7.1f}s  ({r['dur']:5.1f}초)")
print(f"\n{DUR:.0f}초 중 랠리 {play:.0f}초 = 압축률 {play/DUR*100:.0f}%", flush=True)
if rallies:
    d = [r["dur"] for r in rallies]
    print(f"랠리 길이 중앙값 {np.median(d):.1f}초 (최소 {min(d):.1f} 최대 {max(d):.1f})", flush=True)
json.dump(dict(video=VIDEO, window=[T0, T0+DUR], method="pixel_stillness",
               play_ratio=round(play/DUR, 3), rallies=rallies),
          open(f"output/rallies_{TAG}_px.json", "w"), indent=2)
print(f"output/rallies_{TAG}_px.json", flush=True)
