"""입력 배율 스윕 — 이 모델이 선호하는 공 크기를 찾는다.

크롭 실험에서 "해상도를 바꾸면 잡히는 프레임이 달라진다"가 나왔다.
전체 프레임을 여러 imgsz로 넣어 최적점과 조합 효과를 확인한다.
"""
import sys, time
import cv2
import numpy as np
from ultralytics import YOLO

VIDEO = "input/match_amateur.mp4"
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 35.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
STRIDE, CONF = 2, 0.05
CONFIGS = [("imgsz 640", dict(imgsz=640)),
           ("imgsz 960", dict(imgsz=960)),
           ("imgsz 1280", dict(imgsz=1280)),
           ("imgsz 1280 +TTA", dict(imgsz=1280, augment=True))]

model = YOLO("models/yolo5_last.pt")
cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
frames, n = [], 0
while len(frames) < int(DUR*fps/STRIDE):
    ok = cap.grab()
    if not ok:
        break
    if n % STRIDE == 0:
        ok, f = cap.retrieve()
        if ok:
            frames.append(f)
    n += 1
cap.release()
print(f"{len(frames)}프레임\n")

hits = {}
for name, kw in CONFIGS:
    try:
        t0 = time.time()
        per = []
        for f in frames:
            b = model.predict(f, device="mps", conf=CONF, verbose=False, **kw)[0].boxes
            per.append([((float(b.xyxy[k][0])+float(b.xyxy[k][2]))/2,
                         (float(b.xyxy[k][1])+float(b.xyxy[k][3]))/2,
                         float(b.conf[k])) for k in range(len(b))])
        el = (time.time()-t0)/len(frames)*1000
    except Exception as e:
        print(f"── {name}: 실패 {type(e).__name__}: {str(e)[:70]}\n")
        continue
    allp = np.array([[d[0], d[1]] for fr in per for d in fr])
    stat = set()
    for i, p in enumerate(allp):
        if (np.abs(allp-p).max(axis=1) < 10).sum() >= len(frames)*0.15:
            stat.add(i)
    mov, k = [], 0
    for fr in per:
        cur = []
        for d in fr:
            if k not in stat:
                cur.append(d)
            k += 1
        mov.append(cur)
    hits[name] = [any(d[2] >= 0.25 for d in fr) for fr in mov]
    r15 = sum(1 for fr in mov if any(d[2] >= .15 for d in fr))/len(frames)*100
    r25 = sum(hits[name])/len(frames)*100
    cfs = [d[2] for fr in mov for d in fr]
    print(f"── {name:18s} {el:4.0f} ms/f | conf>=.15 {r15:5.1f}% | conf>=.25 {r25:5.1f}%"
          f" | conf중앙값 {np.median(cfs) if cfs else 0:.3f}")

print("\n조합 (conf>=0.25, 하나라도 잡으면 성공):")
names = list(hits)
for i in range(len(names)):
    for j in range(i+1, len(names)):
        u = sum(1 for a, b in zip(hits[names[i]], hits[names[j]]) if a or b)
        print(f"   {names[i]} + {names[j]}: {u/len(frames)*100:.1f}%")
if len(names) >= 3:
    u = sum(1 for k in range(len(frames)) if any(hits[n][k] for n in names))
    print(f"   전체 조합: {u/len(frames)*100:.1f}%")
