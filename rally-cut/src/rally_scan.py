"""선수 정지 구간으로 경기 전체의 랠리 경계를 찾는다.

포인트는 항상 두 선수가 자기 베이스라인 뒤에 멈춰 선 상태에서 시작한다.
그 정지가 '끝나는' 순간이 서브 시작 = 랠리 시작이다.

소리(간격 4초)나 서브 자세(신호 약함)와 달리 선수 검출은 98~100%로 가장
믿을 만하고, 스코어보드와 달리 어떤 영상에도 있다.

정지 구간은 1초쯤 지속되므로 초당 5프레임이면 충분해 가벼운 모델로 훑는다.

  python rally_scan.py <태그>
"""
import json, os, sys
import cv2
import numpy as np
from ultralytics import YOLO

TAG = sys.argv[1] if len(sys.argv) > 1 else "match_b"
VIDEO = f"input/{TAG}.mp4"
OUT = f"output/rallies_{TAG}.json"
HZ = 5.0                    # 초당 샘플
STILL_SPD = 0.7             # m/s 미만이면 정지로 본다
STILL_MIN = 0.4             # 초
BEHIND = 1.0                # 베이스라인에서 이만큼 뒤/앞이어야 서브 준비로 인정

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
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
step = max(1, int(round(fps/HZ)))
dt = step/fps
model = YOLO("yolov8n.pt")          # 위치만 필요하므로 가벼운 모델로 충분
print(f"{TAG}: {total/fps/60:.1f}분, {step}프레임당 1회 ({fps/step:.1f}Hz)", flush=True)

pos = []
n = 0
while True:
    ok = cap.grab()
    if not ok:
        break
    if n % step == 0:
        ok, f = cap.retrieve()
        if ok:
            b = model.predict(f, device="mps", imgsz=960, conf=.35, classes=[0],
                              verbose=False)[0].boxes
            cand = []
            for k in range(len(b)):
                x1, y1, x2, y2 = b.xyxy[k].tolist()
                wx, wy = tc(((x1+x2)/2, min(y2, H-1)))
                cut = y2 >= H-3
                if (-3 < wx < WD+3 and -3 < wy < L+3) or cut:
                    cand.append((float(wx), float(wy), y2, cut))
            near = max((c for c in cand if c[1] > NET or c[3]), key=lambda c: c[2], default=None)
            far = min((c for c in cand if c[1] <= NET and not c[3]), key=lambda c: c[2], default=None)
            pos.append((n/fps, near[:2] if near else None, far[:2] if far else None))
    n += 1
    if n % (step*300) == 0:
        print(f"  {n/fps:.0f}s / {total/fps:.0f}s", flush=True)
cap.release()

T = np.array([p[0] for p in pos])
NP = len(pos)


def track(k):
    a = np.full((NP, 2), np.nan)
    for i, p in enumerate(pos):
        if p[k+1]:
            a[i] = p[k+1]
    for c in range(2):
        v = a[:, c]; ok = ~np.isnan(v)
        if ok.sum() > 2:
            a[:, c] = np.interp(np.arange(NP), np.flatnonzero(ok), v[ok])
    s = np.zeros(NP)
    for i in range(1, NP):
        s[i] = np.hypot(*(a[i]-a[i-1]))/dt
    return a, np.convolve(s, np.ones(3)/3, mode="same")


p1, s1 = track(0); p2, s2 = track(1)
still = (s1 < STILL_SPD) & (s2 < STILL_SPD) & (p1[:,1] > L-BEHIND-3) & (p2[:,1] < BEHIND+3)
runs, st = [], None
for i, v in enumerate(still):
    if v and st is None:
        st = i
    if not v and st is not None:
        if (i-st)*dt >= STILL_MIN:
            runs.append((st, i))
        st = None
if st is not None and (NP-st)*dt >= STILL_MIN:
    runs.append((st, NP-1))

# 랠리 = 정지가 끝나는 순간(서브 시작)부터 다음 정지가 시작될 때까지
rallies = []
for k, (a, b) in enumerate(runs):
    start = float(T[min(b, NP-1)])
    end = float(T[runs[k+1][0]]) if k+1 < len(runs) else float(T[-1])
    if end - start >= 1.0:
        rallies.append(dict(no=len(rallies)+1, start=round(start, 2), end=round(end, 2),
                            dur=round(end-start, 2)))
json.dump(dict(video=VIDEO, method="player_stillness", hz=HZ,
               still_speed=STILL_SPD, still_min_s=STILL_MIN, rallies=rallies),
          open(OUT, "w"), indent=2)
print(f"\n정지 구간 {len(runs)}개 -> 랠리 {len(rallies)}개")
for r in rallies[:12]:
    print(f"  {r['no']:2d}번  {r['start']:7.1f}~{r['end']:7.1f}s  ({r['dur']:5.1f}초)")
if len(rallies) > 12:
    print(f"  ... 총 {len(rallies)}개")
print(OUT)
