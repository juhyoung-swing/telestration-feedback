"""랠리 지도 — 샷 위치 · 낙하 지점 · 이동 경로를 미니코트에 누적.

바운스 검출 전략:
  타격과 타격 사이에는 바운스가 정확히 한 번 있다. 이 제약으로 구간마다
  후보 하나만 고른다(예전엔 무제한으로 뽑아 43개가 쏟아졌다).
  높은 카메라에서 공이 뜨면 화면상 위쪽(y 작아짐), 바닥에 닿으면 아래쪽(y 최대).
  따라서 구간 내 '추세 대비 y가 가장 큰 지점'이 바운스다.
  그 순간의 공은 실제로 지면에 있으므로 좌표 변환이 유효하다.

  python rally_map.py <시작초> <길이초>
"""
import json, os, pickle, sys
import cv2
import numpy as np
import librosa

TAG, VIDEO = "match_b", "input/match_b.mp4"
CACHE_T0, CACHE_DUR = 300, 30
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 300.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
OUT = "output/rally_map"; os.makedirs(OUT, exist_ok=True)
STRIDE, PERSON_H = 2, 1.75

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])
KP = np.float32(json.load(open(f"kp_{TAG}.json")))
Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
to_court = lambda p: cv2.perspectiveTransform(np.float32([[p]]), Hm).reshape(2)

cap = cv2.VideoCapture(VIDEO); fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
cap.release()
dt = STRIDE/fps
off = int(round((T0-CACHE_T0)/dt))
NF = int(DUR*fps/STRIDE)

D = pickle.load(open(f"output/multi/{TAG}/det_{CACHE_T0}_{CACHE_DUR}_x.pkl", "rb"))
ball_raw = D["ball"][off:off+NF]; persons = D["persons"][off:off+NF]
NF = len(ball_raw)
print(f"[cache] {NF}프레임 ({T0}~{T0+DUR}초)", flush=True)

# ---------- 공 트랙 ----------
allp = np.array([[c[0], c[1]] for fr in ball_raw for c in fr])
static = np.array([p for p in allp if (np.abs(allp-p).max(axis=1) < 10).sum() >= NF*0.15]) \
    if len(allp) else np.empty((0,2))
kf = cv2.KalmanFilter(4, 2)
kf.transitionMatrix = np.array([[1,0,1,0],[0,1,0,1],[0,0,1,0],[0,0,0,1]], np.float32)
kf.measurementMatrix = np.eye(2, 4, dtype=np.float32)
kf.processNoiseCov = np.eye(4, dtype=np.float32)*3.0
kf.measurementNoiseCov = np.eye(2, dtype=np.float32)*12.0
bx, by, seen = np.zeros(NF), np.zeros(NF), np.zeros(NF, bool)
init = False
for i, fr in enumerate(ball_raw):
    cand = [c for c in fr
            if not (len(static) and (np.abs(static-[c[0],c[1]]).max(axis=1) < 10).any())]
    pred = kf.predict() if init else None
    pick = None
    if cand:
        if pred is not None:
            nc = [c for c in cand if np.hypot(c[0]-pred[0,0], c[1]-pred[1,0]) < 260]
            cand = nc or cand
            pick = min(cand, key=lambda c: np.hypot(c[0]-pred[0,0], c[1]-pred[1,0]) - c[2]*150)
        else:
            pick = max(cand, key=lambda c: c[2])
    if pick:
        if not init:
            kf.statePost = np.float32([[pick[0]],[pick[1]],[0],[0]]); init = True
        else:
            kf.correct(np.float32([[pick[0]],[pick[1]]]))
        bx[i], by[i], seen[i] = pick[0], pick[1], True
    elif init:
        bx[i], by[i] = float(pred[0,0]), float(pred[1,0])
    elif i:
        bx[i], by[i] = bx[i-1], by[i-1]
print(f"[ball] 검출 {seen.sum()}/{NF} ({seen.mean()*100:.0f}%)", flush=True)
bw = np.array([to_court((x, y)) for x, y in zip(bx, by)])

# ---------- 타격음 ----------
y_, sr = librosa.load(f"output/multi/{TAG}/audio.wav", sr=22050)
S = librosa.feature.melspectrogram(y=y_, sr=sr, n_fft=2048, hop_length=512,
                                   fmin=2000, fmax=8000, n_mels=64)
env = librosa.onset.onset_strength(S=librosa.power_to_db(S, ref=np.max), sr=sr)
env = env/(env.max()+1e-9)
audio = [CACHE_T0 + t for t in librosa.onset.onset_detect(onset_envelope=env, sr=sr,
                                                          units="time", delta=0.28, wait=8)]
audio = [t for t in audio if T0 <= t <= T0+DUR]
print(f"[audio] 타격음 {len(audio)}개", flush=True)

box_dist = lambda p, b: np.hypot(max(b[0]-p[0], 0, p[0]-b[2]), max(b[1]-p[1], 0, p[1]-b[3]))
shots = []
for t in audio:
    i = int(round((t-T0)/dt))
    if not 0 <= i < NF:
        continue
    p1, p2 = persons[i]
    d1 = box_dist((bx[i], by[i]), p1["box"]) if p1 else None
    d2 = box_dist((bx[i], by[i]), p2["box"]) if p2 else None
    shots.append(dict(t=t, i=i, d1=d1, d2=d2, who=None))
# 교대 제약
if shots:
    ev = []
    for s in shots:
        if s["d1"] is None and s["d2"] is None:
            ev.append((None, 0.0))
        elif s["d1"] is None:
            ev.append((2, 0.3))
        elif s["d2"] is None:
            ev.append((1, 0.3))
        else:
            w_, dn, df = (1, s["d1"], s["d2"]) if s["d1"] <= s["d2"] else (2, s["d2"], s["d1"])
            ev.append((w_, 1.0 if dn <= 5 else (0.7 if df > dn*3 else 0.4 if df > dn*2 else 0.0)))
    best = max(range(len(shots)), key=lambda k: ev[k][1])
    aw = ev[best][0] or 1
    for k in range(len(shots)):
        shots[k]["who"] = aw if (k-best) % 2 == 0 else 3-aw
for s in shots:                       # 샷 위치 = 친 사람 발 위치 (지면이라 정확)
    q = persons[s["i"]][s["who"]-1]
    s["pos"] = None if q is None else tuple(float(v) for v in q["world"])
for s in shots:                       # 스트로크 속도 (선수 키 1.75m를 자로)
    q = persons[s["i"]][s["who"]-1]
    if q is None:
        s["speed"] = 0.0; continue
    ppm = (q["box"][3]-q["box"][1]) / PERSON_H
    j = min(s["i"] + int(round(0.30/dt)), NF-1)
    step = [np.hypot(bx[k+1]-bx[k], by[k+1]-by[k])/ppm/dt*3.6 for k in range(s["i"], j)]
    s["speed"] = round(min(float(np.median(step)) if step else 0.0, 200.0), 1)
print(f"[shot] {len(shots)}개 (P1 {sum(s['who']==1 for s in shots)} / "
      f"P2 {sum(s['who']==2 for s in shots)})", flush=True)
for w_ in (1, 2):
    sp = [s["speed"] for s in shots if s["who"] == w_ and s["speed"] > 0]
    print(f"[speed] P{w_} 스트로크 중앙값 {np.median(sp) if sp else 0:.0f} km/h (근사, n={len(sp)})",
          flush=True)

# ---------- 바운스: 타격 사이 구간마다 1개 ----------
ys = np.convolve(by, np.ones(3)/3, mode="same")
bounces = []
for a, b_ in zip(shots, shots[1:]):
    i0, i1 = a["i"]+2, b_["i"]-2
    if i1 - i0 < 4:
        continue
    idx = [k for k in range(i0, i1+1) if seen[k]]        # 실제로 검출된 프레임만
    if len(idx) < 4:
        continue
    seg = ys[idx]
    trend = np.interp(idx, [idx[0], idx[-1]], [seg[0], seg[-1]])
    resid = seg - trend
    k = int(np.argmax(resid))
    # 처짐이 너무 크면 추적이 발산한 것 (화면 높이의 1/4 이상은 물리적으로 불가)
    if not (3 <= resid[k] <= H*0.25):
        continue
    fi = idx[k]
    wpos = bw[fi]
    bounces.append(dict(i=fi, t=T0+fi*dt, pos=(float(wpos[0]), float(wpos[1])),
                        after=a["who"], prom=float(resid[k]), detected=bool(seen[fi])))
ins = [b for b in bounces if -1.5 < b["pos"][0] < WD+1.5 and -1.5 < b["pos"][1] < L+1.5]
print(f"[bounce] {len(bounces)}개 중 코트 안 {len(ins)}개 ({len(ins)/max(len(bounces),1)*100:.0f}%)",
      flush=True)
for b in bounces:
    print(f"    t={b['t']:6.2f}s  ({b['pos'][0]:6.2f}, {b['pos'][1]:6.2f})m  "
          f"처짐 {b['prom']:5.1f}px  {'검출' if b['detected'] else '예측'}"
          f"{'' if b in ins else '   <- 코트 밖'}", flush=True)

json.dump(dict(window=[T0, T0+DUR], shots=[{k: v for k, v in s.items() if k != 'i'} for s in shots],
               bounces=bounces, ball_rate=float(seen.mean()),
               bounce_inside_rate=len(ins)/max(len(bounces), 1)),
          open(f"{OUT}/rally_stats.json", "w"), indent=2, default=float)
np.savez(f"{OUT}/track.npz", bx=bx, by=by, seen=seen, bw=bw)
print(f"{OUT}/rally_stats.json", flush=True)

# ---------- 렌더: 랠리 지도 누적 ----------
# 선수는 베이스라인 뒤에 서므로(실측 y -2.1~25.7m) 코트 밖 여백을 포함해 그린다
MGX, MGY = 2.0, 3.5
SPAN_X, SPAN_Y = WD + 2*MGX, L + 2*MGY
MW, MH, MX, MY = 300, 620, W-370, 130
mini = lambda p: (int(MX + (p[0]+MGX)*MW/SPAN_X), int(MY + (p[1]+MGY)*MH/SPAN_Y))
LINES = [(0,1),(1,3),(3,2),(2,0),(4,5),(6,7),(8,9),(10,11),(12,13)]
COL = {1: (255, 170, 60), 2: (80, 80, 255)}          # P1 파랑계열 / P2 빨강계열


def clean(seq, jump=2.5):
    """추적이 튄 지점을 끊어 선분 목록으로 (이어 그리면 화면을 가로지르는 선이 생김)."""
    segs, cur = [], []
    for p in seq:
        if cur and np.hypot(p[0]-cur[-1][0], p[1]-cur[-1][1]) > jump:
            if len(cur) > 1:
                segs.append(cur)
            cur = []
        cur.append(p)
    if len(cur) > 1:
        segs.append(cur)
    return segs

BOUNCE = []
if os.path.exists(f"{OUT}/bounce3d.json"):
    BOUNCE = [b for b in json.load(open(f"{OUT}/bounce3d.json"))["bounces"] if b.get("ok")]
    print(f"[bounce3d] 낙하 지점 {len(BOUNCE)}개 로드", flush=True)

cap = cv2.VideoCapture(VIDEO); cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
vw = cv2.VideoWriter(f"{OUT}/rally_map.mp4", cv2.VideoWriter_fourcc(*"mp4v"), 1/dt, (W, H))
trail = {1: [], 2: []}
last_sp = {1: 0.0, 2: 0.0}
for i in range(NF):
    ok = False
    for _ in range(STRIDE):
        ok, v = cap.read()
    if not ok:
        break
    for w_, q in ((1, persons[i][0]), (2, persons[i][1])):
        if q:
            trail[w_].append(q["world"])
            x1, y1, x2, y2 = map(int, q["box"])
            cv2.rectangle(v, (x1,y1), (x2,y2), COL[w_], 3)
            cv2.putText(v, f"P{w_}", (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, .9, COL[w_], 2)
    if seen[i]:
        cv2.circle(v, (int(bx[i]), int(by[i])), 13, (0,255,255), 3)

    ov = v.copy()
    cv2.rectangle(ov, (MX-26, MY-56), (MX+MW+26, MY+MH+26), (250,250,250), -1)
    cv2.addWeighted(ov, .82, v, .18, 0, v)
    cv2.putText(v, "RALLY MAP", (MX-6, MY-24), cv2.FONT_HERSHEY_SIMPLEX, .8, (40,40,40), 2)
    for a, b_ in LINES:
        cv2.line(v, mini(WORLD[a]), mini(WORLD[b_]), (90,90,90), 2)
    cv2.line(v, mini([0, NET]), mini([WD, NET]), (200,60,60), 3)
    for w_ in (1, 2):                                   # 이동 경로
        for sg in clean(trail[w_]):
            cv2.polylines(v, [np.int32([mini(q) for q in sg])], False, COL[w_], 1, cv2.LINE_AA)
    for n, s in enumerate(shots, 1):                    # 샷 위치 (친 사람 발)
        if s["i"] > i or s["pos"] is None:
            continue
        p = mini(s["pos"])
        cv2.circle(v, p, 13, COL[s["who"]], -1)
        cv2.circle(v, p, 13, (255,255,255), 2)
        cv2.putText(v, str(n), (p[0]-6, p[1]+6), cv2.FONT_HERSHEY_SIMPLEX, .5, (255,255,255), 2)
    if seen[i] and -1 < bw[i][0] < WD+1 and -1 < bw[i][1] < L+1:   # 코트 안일 때만
        cv2.circle(v, mini(bw[i]), 7, (0,200,220), -1)
    for b in BOUNCE:                                    # 낙하 지점 (3D 포물선 복원)
        if b["t"] - T0 <= i*dt:
            q = mini(b["pos"])
            cv2.drawMarker(v, q, (20,140,20), cv2.MARKER_TILTED_CROSS, 20, 3)

    n1 = sum(1 for s in shots if s["i"] <= i and s["who"] == 1)
    n2 = sum(1 for s in shots if s["i"] <= i and s["who"] == 2)
    for s_ in shots:
        if s_["i"] == i:
            last_sp[s_["who"]] = s_["speed"]
    nb = sum(1 for b in BOUNCE if b["t"]-T0 <= i*dt)
    px, py = 20, H-210
    ov = v.copy(); cv2.rectangle(ov, (px,py), (px+520, py+180), (35,35,35), -1)
    cv2.addWeighted(ov, .78, v, .22, 0, v)
    cv2.putText(v, f"t={T0+i*dt:5.1f}s", (px+18, py+38), cv2.FONT_HERSHEY_SIMPLEX, .8, (0,255,0), 2)
    cv2.putText(v, f"Shots   P1 {n1}   P2 {n2}", (px+18, py+82),
                cv2.FONT_HERSHEY_SIMPLEX, .75, (255,255,255), 2)
    cv2.putText(v, f"Stroke  P1 ~{last_sp[1]:.0f}   P2 ~{last_sp[2]:.0f} km/h", (px+18, py+124),
                cv2.FONT_HERSHEY_SIMPLEX, .75, (255,255,255), 2)
    cv2.putText(v, f"Bounces  {nb}", (px+18, py+164),
                cv2.FONT_HERSHEY_SIMPLEX, .75, (140,255,140), 2)
    vw.write(v)
vw.release(); cap.release()

# 정지 이미지 요약본
sm = np.full((MH+120, MW+80, 3), 250, np.uint8)
sh = lambda p: (int(40 + (p[0]+MGX)*MW/SPAN_X), int(70 + (p[1]+MGY)*MH/SPAN_Y))
for a, b_ in LINES:
    cv2.line(sm, sh(WORLD[a]), sh(WORLD[b_]), (90,90,90), 2)
cv2.line(sm, sh([0, NET]), sh([WD, NET]), (200,60,60), 3)
cv2.putText(sm, f"RALLY MAP  {T0:.0f}-{T0+DUR:.0f}s", (36, 40),
            cv2.FONT_HERSHEY_SIMPLEX, .7, (40,40,40), 2)
for w_ in (1, 2):
    for sg in clean(trail[w_]):
        cv2.polylines(sm, [np.int32([sh(q) for q in sg])], False, COL[w_], 1, cv2.LINE_AA)
for b in BOUNCE:
    q = sh(b["pos"])
    cv2.drawMarker(sm, q, (20,140,20), cv2.MARKER_TILTED_CROSS, 22, 3)
for n, s in enumerate(shots, 1):
    if s["pos"] is None:
        continue
    p = sh(s["pos"])
    cv2.circle(sm, p, 15, COL[s["who"]], -1); cv2.circle(sm, p, 15, (255,255,255), 2)
    cv2.putText(sm, str(n), (p[0]-7, p[1]+7), cv2.FONT_HERSHEY_SIMPLEX, .55, (255,255,255), 2)
cv2.imwrite(f"{OUT}/rally_map.png", sm)
print(f"{OUT}/rally_map.mp4, {OUT}/rally_map.png", flush=True)
