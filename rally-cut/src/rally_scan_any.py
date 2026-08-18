"""랠리 경계 검출 — 인원수 무관 (단식·복식 모두).

기존 rally_scan.py 는 '근거리 1명 + 원거리 1명'을 전제했다.
여기서는 코트 안의 모든 선수가 동시에 멈춘 구간을 찾는다.
그 정지가 끝나는 순간 = 서브 시작 = 랠리 시작.

  python rally_scan_any.py <태그> [시작초] [길이초]
"""
import json, os, sys
import cv2
import numpy as np
from ultralytics import YOLO

TAG = sys.argv[1] if len(sys.argv) > 1 else "match_d"
T0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
DUR = float(sys.argv[3]) if len(sys.argv) > 3 else 180.0
VIDEO = f"input/{TAG}.mp4"
OUT = f"output/rallies_{TAG}.json"
HZ, STILL_SPD, STILL_MIN = 5.0, 0.8, 0.6

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
step = max(1, int(round(fps/HZ)))
dt = step/fps
model = YOLO("yolov8n.pt")
print(f"{TAG}: {T0:.0f}~{T0+DUR:.0f}초, {fps/step:.1f}Hz 샘플", flush=True)

cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
frames, n = [], 0
while n < int(DUR*fps):
    ok = cap.grab()
    if not ok:
        break
    if n % step == 0:
        ok, f = cap.retrieve()
        if ok:
            b = model.predict(f, device="mps", imgsz=960, conf=.35, classes=[0],
                              verbose=False)[0].boxes
            pl = []
            for k in range(len(b)):
                x1, y1, x2, y2 = b.xyxy[k].tolist()
                wx, wy = tc(((x1+x2)/2, min(y2, H-1)))
                # 코트 안(여유 3m) 또는 화면 아래로 잘린 경우만 선수로 인정
                if (-3 < wx < WD+3 and -3 < wy < L+3) or y2 >= H-3:
                    pl.append((float(wx), float(wy)))
            frames.append((T0+n/fps, pl))
    n += 1
cap.release()
print(f"샘플 {len(frames)}개, 프레임당 선수 중앙값 "
      f"{np.median([len(p) for _, p in frames]):.0f}명", flush=True)

# 선수 수가 바뀌어도 되도록, '가장 많이 움직인 사람'의 속도로 판정
moved = np.zeros(len(frames))
for i in range(1, len(frames)):
    prev, cur = frames[i-1][1], frames[i][1]
    if not prev or not cur:
        moved[i] = moved[i-1]
        continue
    v = []
    for p in cur:                       # 각자 직전 프레임의 가장 가까운 사람과 대응
        d = min(np.hypot(p[0]-q[0], p[1]-q[1]) for q in prev)
        if d < 3.0:                     # 3m 이상 점프는 매칭 실패로 보고 버림
            v.append(d/dt)
    moved[i] = max(v) if v else moved[i-1]
sm = np.convolve(moved, np.ones(3)/3, mode="same")
import sys as _s
print(f"[진단] 최대속도 분포: p10={np.percentile(sm,10):.2f} p25={np.percentile(sm,25):.2f} "
      f"중앙값={np.median(sm):.2f} p75={np.percentile(sm,75):.2f} 최소={sm.min():.2f} m/s", flush=True)
print(f"[진단] 프레임당 인원: {np.bincount([len(p) for _,p in frames]).tolist()} (0명,1명,2명...)", flush=True)
for thr in (0.8,1.5,2.5,4.0):
    print(f"[진단] 임계 {thr} m/s 미만 프레임 비율: {(sm<thr).mean()*100:.0f}%", flush=True)

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
    start = frames[min(b, len(frames)-1)][0]
    end = frames[runs[k+1][0]][0] if k+1 < len(runs) else frames[-1][0]
    if end - start >= 1.5:
        rallies.append(dict(no=len(rallies)+1, start=round(start, 2),
                            end=round(end, 2), dur=round(end-start, 2)))

play = sum(r["dur"] for r in rallies)
print(f"\n정지 구간 {len(runs)}개 -> 랠리 {len(rallies)}개", flush=True)
for r in rallies[:15]:
    print(f"  {r['no']:2d}  {r['start']:7.1f}~{r['end']:7.1f}s  ({r['dur']:5.1f}초)")
if len(rallies) > 15:
    print(f"  ... 총 {len(rallies)}개")
print(f"\n분석 구간 {DUR:.0f}초 중 랠리 {play:.0f}초 = "
      f"압축률 {play/DUR*100:.0f}%  (데드타임 {100-play/DUR*100:.0f}%)", flush=True)
if rallies:
    d = [r["dur"] for r in rallies]
    g = [rallies[i+1]["start"]-rallies[i]["end"] for i in range(len(rallies)-1)]
    print(f"랠리 길이 중앙값 {np.median(d):.1f}초 | 랠리 사이 간격 중앙값 "
          f"{np.median(g) if g else 0:.1f}초", flush=True)
json.dump(dict(video=VIDEO, window=[T0, T0+DUR], method="all_players_stillness",
               play_ratio=round(play/DUR, 3), rallies=rallies), open(OUT, "w"), indent=2)
print(OUT, flush=True)
