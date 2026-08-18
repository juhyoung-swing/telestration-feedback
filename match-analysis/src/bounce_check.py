"""바운스 검증용 — 추정 시각의 프레임에 추정 낙하 지점을 되돌려 그린다.

3D 복원이 계산한 지점(X, Y, 0)을 카메라 투영으로 화면에 되찍는다.
그 자리에 실제 공이 있으면 맞은 것.
"""
import json, os
import cv2
import numpy as np

import sys
SRC = sys.argv[1] if len(sys.argv) > 1 else "output/rally_map/bounce3d.json"
TAG = sys.argv[2] if len(sys.argv) > 2 else "match_b"
VIDEO = f"input/{TAG}.mp4"
OUT = os.path.join(os.path.dirname(SRC), "bounce_check")
os.makedirs(OUT, exist_ok=True)
CROP = 260          # 확대해서 볼 영역 (원본 픽셀)

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])
KP = np.float32(json.load(open(f"kp_{TAG}.json")))
H_i2w, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
H_w2i = np.linalg.inv(H_i2w)

_j = json.load(open(SRC))
ALL = "--all" in sys.argv
B = _j.get("bounces_all") if ALL and _j.get("bounces_all") else _j.get("bounces", [])
if not ALL:
    B = [b for b in B if b.get("ok", True)]
B.sort(key=lambda b: b["t"])
print(f"검증 대상 {len(B)}개")

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
tiles = []
for n, b in enumerate(B, 1):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(b["t"]*fps)))
    ok, f = cap.read()
    if not ok:
        continue
    # 낙하 지점(지면)이므로 바닥 호모그래피만으로 화면 좌표가 나온다
    p = cv2.perspectiveTransform(np.float32([[b["pos"]]]), H_w2i).reshape(2)
    x, y = int(p[0]), int(p[1])
    x1, y1 = max(x-CROP//2, 0), max(y-CROP//2, 0)
    x2, y2 = min(x1+CROP, f.shape[1]), min(y1+CROP, f.shape[0])
    crop = f[y1:y2, x1:x2].copy()
    cx, cy = x-x1, y-y1
    cv2.drawMarker(crop, (cx, cy), (0, 0, 255), cv2.MARKER_CROSS, 46, 2)
    cv2.circle(crop, (cx, cy), 34, (0, 0, 255), 2)
    crop = cv2.resize(crop, (460, 460), interpolation=cv2.INTER_CUBIC)
    okf = b.get("ok", True)
    hdr = (0, 90, 0) if okf else (0, 0, 110)
    cv2.rectangle(crop, (0, 0), (459, 58), hdr, -1)
    cv2.putText(crop, f"#{n}  t={b['t']:.2f}s  ({b['pos'][0]:.1f},{b['pos'][1]:.1f})m",
                (8, 22), cv2.FONT_HERSHEY_SIMPLEX, .52, (255, 255, 255), 1)
    deg = b.get("corner_deg"); gap = b.get("gap_m")
    info = "PASS" if okf else "REJECT"
    if deg is not None:
        info += f"  angle {deg:.0f}deg  gap {gap:.2f}m"
    elif not b.get("confirmed", True):
        info += "  no corner match"
    cv2.putText(crop, info, (8, 46), cv2.FONT_HERSHEY_SIMPLEX, .48, (255, 255, 255), 1)
    cv2.imwrite(f"{OUT}/bounce_{n:02d}.jpg", crop)
    tiles.append(crop)
cap.release()

cols = 5
rows = (len(tiles)+cols-1)//cols
sheet = np.full((rows*460, cols*460, 3), 30, np.uint8)
for i, t in enumerate(tiles):
    r, c = divmod(i, cols)
    sheet[r*460:(r+1)*460, c*460:(c+1)*460] = t
cv2.imwrite(f"{OUT}/contact_sheet{'_all' if ALL else ''}.jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 95])
print(f"{OUT}/contact_sheet{'_all' if ALL else ''}.jpg  ({len(tiles)}장)")
print("빨간 원 안에 공이 있으면 맞은 것. 공이 원 밖이면 틀린 것.")
