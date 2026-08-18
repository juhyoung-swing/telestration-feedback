"""합본 오버레이 — 지금까지 검증된 것만 모아 한 영상으로.

  코트 키포인트 14점 · 선수 트래킹 · 공 트래킹(궤적)
  코트맵: 선수 발 경로 + 샷 위치 + 낙구 위치
  패널: 랠리 수(랠리 내 샷 수) · P1/P2 스트로크 속도

  python render_final.py [시작초] [길이초]
"""
import json, os, pickle, sys
import cv2
import numpy as np
import librosa


def _h264(path):
    """OpenCV VideoWriter 는 mp4v(MPEG-4 Part 2)만 안정적으로 쓴다.
    그 코덱은 브라우저 HTML5 video 가 재생하지 못한다 — QuickTime 에서는 열려서
    눈치채기 어렵다. 다 쓴 뒤 h264 로 갈아끼운다."""
    import os
    import subprocess
    tmp = f"{path}.h264.mp4"
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(path),
                        "-c:v", "h264_videotoolbox", "-b:v", "8000k",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp],
                       capture_output=True, text=True)
    if r.returncode == 0 and os.path.exists(tmp):
        os.replace(tmp, path)
    else:
        print(f"[h264] 변환 실패, mp4v 그대로 둔다: {path}", flush=True)


TAG, VIDEO = "match_b", "input/match_b.mp4"
CACHE_T0, CACHE_DUR = 300, 30
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 300.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 30.0
OUT = "output/final"; os.makedirs(OUT, exist_ok=True)
STRIDE, PERSON_H, RALLY_GAP = 2, 1.75, 4.0
TRAIL_N = 18                      # 공 궤적 길이(프레임)

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
D = pickle.load(open(f"output/multi/{TAG}/det_{CACHE_T0}_{CACHE_DUR}_x.pkl", "rb"))
NFmax = int(DUR*fps/STRIDE)
ball_raw = D["ball"][off:off+NFmax]; persons = D["persons"][off:off+NFmax]
NF = len(ball_raw)

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
bw = np.array([to_court((x, y)) for x, y in zip(bx, by)])
print(f"[ball] {seen.sum()}/{NF} ({seen.mean()*100:.0f}%)", flush=True)

# ---------- 샷 · 랠리 · 속도 ----------
y_, sr = librosa.load(f"output/multi/{TAG}/audio.wav", sr=22050)
S = librosa.feature.melspectrogram(y=y_, sr=sr, n_fft=2048, hop_length=512,
                                   fmin=2000, fmax=8000, n_mels=64)
env = librosa.onset.onset_strength(S=librosa.power_to_db(S, ref=np.max), sr=sr)
env = env/(env.max()+1e-9)
audio = [CACHE_T0+t for t in librosa.onset.onset_detect(onset_envelope=env, sr=sr,
                                                        units="time", delta=0.28, wait=8)]
audio = [t for t in audio if T0 <= t <= T0+DUR]
bd = lambda p, b: np.hypot(max(b[0]-p[0], 0, p[0]-b[2]), max(b[1]-p[1], 0, p[1]-b[3]))
shots = []
for t in audio:
    i = int(round((t-T0)/dt))
    if 0 <= i < NF:
        p1, p2 = persons[i]
        shots.append(dict(t=t, i=i, who=None,
                          d1=bd((bx[i], by[i]), p1["box"]) if p1 else None,
                          d2=bd((bx[i], by[i]), p2["box"]) if p2 else None))
rallies = []
for s in shots:
    if rallies and s["t"] - rallies[-1][-1]["t"] < RALLY_GAP:
        rallies[-1].append(s)
    else:
        rallies.append([s])
for r in rallies:                                   # 교대 제약으로 귀속
    ev = []
    for s in r:
        if s["d1"] is None and s["d2"] is None:
            ev.append((None, 0.0))
        elif s["d1"] is None:
            ev.append((2, 0.3))
        elif s["d2"] is None:
            ev.append((1, 0.3))
        else:
            w_, dn, df = (1, s["d1"], s["d2"]) if s["d1"] <= s["d2"] else (2, s["d2"], s["d1"])
            ev.append((w_, 1.0 if dn <= 5 else (0.7 if df > dn*3 else 0.4 if df > dn*2 else 0.0)))
    k = max(range(len(r)), key=lambda x: ev[x][1]); aw = ev[k][0] or 1
    for x in range(len(r)):
        r[x]["who"] = aw if (x-k) % 2 == 0 else 3-aw
for s in shots:
    q = persons[s["i"]][s["who"]-1]
    s["pos"] = None if q is None else tuple(float(v) for v in q["world"])
    if q is None:
        s["speed"] = 0.0
    else:
        ppm = (q["box"][3]-q["box"][1])/PERSON_H
        j = min(s["i"]+int(round(0.30/dt)), NF-1)
        st = [np.hypot(bx[k+1]-bx[k], by[k+1]-by[k])/ppm/dt*3.6 for k in range(s["i"], j)]
        s["speed"] = round(min(float(np.median(st)) if st else 0.0, 200.0), 1)
rally_of = {}
for n, r in enumerate(rallies, 1):
    for x, s in enumerate(r, 1):
        rally_of[s["i"]] = (n, x, len(r))
print(f"[shot] {len(shots)}개 | 랠리 {len(rallies)}개 {[len(r) for r in rallies]}", flush=True)

BOUNCE = []
bp = "output/rally_map/bounce3d.json"
if os.path.exists(bp):
    BOUNCE = [b for b in json.load(open(bp))["bounces"]
              if b.get("ok") and T0 <= b["t"] <= T0+DUR]
print(f"[bounce] {len(BOUNCE)}개", flush=True)

# ---------- 렌더 ----------
MGX, MGY = 2.0, 3.5
SPX, SPY = WD+2*MGX, L+2*MGY
MW, MH, MX, MY = 300, 620, W-360, 120
mini = lambda p: (int(MX+(p[0]+MGX)*MW/SPX), int(MY+(p[1]+MGY)*MH/SPY))
LINES = [(0,1),(1,3),(3,2),(2,0),(4,5),(6,7),(8,9),(10,11),(12,13)]
COL = {1: (255,170,60), 2: (80,80,255)}


def clean(seq, jump=2.5):
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


cap = cv2.VideoCapture(VIDEO); cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
vw = cv2.VideoWriter(f"{OUT}/final.mp4", cv2.VideoWriter_fourcc(*"mp4v"), 1/dt, (W, H))
trail = {1: [], 2: []}; last_sp = {1: 0.0, 2: 0.0}; cur_rally = (0, 0, 0)
for i in range(NF):
    ok = False
    for _ in range(STRIDE):
        ok, v = cap.read()
    if not ok:
        break
    if i in rally_of:
        cur_rally = rally_of[i]
    for s in shots:
        if s["i"] == i:
            last_sp[s["who"]] = s["speed"]

    for j, (x, y) in enumerate(KP):                       # 코트 키포인트
        if 0 <= x < W and 0 <= y < H:
            cv2.circle(v, (int(x), int(y)), 7, (0,0,255), -1)
            cv2.circle(v, (int(x), int(y)), 20, (0,0,255), 2)
            cv2.putText(v, str(j), (int(x)-7, int(y)+5),
                        cv2.FONT_HERSHEY_SIMPLEX, .48, (255,255,255), 1)
    for w_, q in ((1, persons[i][0]), (2, persons[i][1])):  # 선수 트래킹
        if q:
            trail[w_].append(q["world"])
            x1, y1, x2, y2 = map(int, q["box"])
            cv2.rectangle(v, (x1,y1), (x2,y2), COL[w_], 3)
            cv2.rectangle(v, (x1, y1-34), (x1+112, y1), COL[w_], -1)
            cv2.putText(v, f"P{w_}", (x1+8, y1-9), cv2.FONT_HERSHEY_SIMPLEX, .8, (0,0,0), 2)
    k0 = max(0, i-TRAIL_N)                                 # 공 궤적
    for k in range(k0+1, i+1):
        if np.hypot(bx[k]-bx[k-1], by[k]-by[k-1]) < 220:
            a = (k-k0)/max(i-k0, 1)
            cv2.line(v, (int(bx[k-1]), int(by[k-1])), (int(bx[k]), int(by[k])),
                     (0, int(140+100*a), int(200+55*a)), max(1, int(1+3*a)), cv2.LINE_AA)
    cv2.circle(v, (int(bx[i]), int(by[i])), 14,
               (0,255,255) if seen[i] else (150,150,150), 3)

    ov = v.copy()                                          # 코트맵
    cv2.rectangle(ov, (MX-24, MY-52), (MX+MW+24, MY+MH+24), (250,250,250), -1)
    cv2.addWeighted(ov, .85, v, .15, 0, v)
    cv2.putText(v, "COURT MAP", (MX-4, MY-20), cv2.FONT_HERSHEY_SIMPLEX, .72, (40,40,40), 2)
    for a, b_ in LINES:
        cv2.line(v, mini(WORLD[a]), mini(WORLD[b_]), (95,95,95), 2)
    cv2.line(v, mini([0, NET]), mini([WD, NET]), (200,60,60), 3)
    for w_ in (1, 2):
        for sg in clean(trail[w_]):
            cv2.polylines(v, [np.int32([mini(q) for q in sg])], False, COL[w_], 1, cv2.LINE_AA)
    for b in BOUNCE:
        if b["t"]-T0 <= i*dt:
            cv2.drawMarker(v, mini(b["pos"]), (20,140,20), cv2.MARKER_TILTED_CROSS, 18, 3)
    for n, s in enumerate(shots, 1):
        if s["i"] <= i and s["pos"]:
            p = mini(s["pos"])
            cv2.circle(v, p, 11, COL[s["who"]], -1); cv2.circle(v, p, 11, (255,255,255), 2)
            cv2.putText(v, str(n), (p[0]-5, p[1]+5), cv2.FONT_HERSHEY_SIMPLEX, .42, (255,255,255), 1)
    for w_, q in ((1, persons[i][0]), (2, persons[i][1])):
        if q:
            cv2.circle(v, mini(q["world"]), 8, COL[w_], -1)
            cv2.circle(v, mini(q["world"]), 8, (255,255,255), 2)

    px, py = 24, H-206                                     # 패널
    ov = v.copy(); cv2.rectangle(ov, (px,py), (px+560, py+176), (32,32,32), -1)
    cv2.addWeighted(ov, .80, v, .20, 0, v)
    cv2.putText(v, f"t={T0+i*dt:6.1f}s", (px+18, py+40), cv2.FONT_HERSHEY_SIMPLEX, .8, (0,255,0), 2)
    rn, rk, rt = cur_rally
    cv2.putText(v, f"Rally {rn}   shot {rk}/{rt}", (px+18, py+88),
                cv2.FONT_HERSHEY_SIMPLEX, .78, (255,255,255), 2)
    cv2.putText(v, "Stroke", (px+18, py+136), cv2.FONT_HERSHEY_SIMPLEX, .72, (190,190,190), 2)
    cv2.putText(v, f"P1 ~{last_sp[1]:.0f}", (px+150, py+136),
                cv2.FONT_HERSHEY_SIMPLEX, .72, COL[1], 2)
    cv2.putText(v, f"P2 ~{last_sp[2]:.0f}", (px+310, py+136),
                cv2.FONT_HERSHEY_SIMPLEX, .72, COL[2], 2)
    cv2.putText(v, "km/h", (px+470, py+136), cv2.FONT_HERSHEY_SIMPLEX, .6, (190,190,190), 2)
    vw.write(v)
vw.release(); cap.release()
_h264(f"{OUT}/final.mp4")
print(f"{OUT}/final.mp4", flush=True)
