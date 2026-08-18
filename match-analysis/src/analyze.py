"""임의 구간 분석 일괄 실행 — 트랙·샷·랠리·낙구·JSON·오버레이 영상.

앞서 흩어져 있던 render_final / bounce3d / rally_map 을 하나로 합치고
구간을 인자로 받도록 정리했다. 검출 캐시(render_any.py 가 만든 것)를 읽는다.

  python analyze.py <태그> <시작초> <길이초>
     예) python analyze.py match_b 45 67
"""
import json, os, pickle, sys
import cv2
import numpy as np
import librosa
from scipy.optimize import least_squares

TAG = sys.argv[1] if len(sys.argv) > 1 else "match_b"
T0 = float(sys.argv[2]) if len(sys.argv) > 2 else 45.0
DUR = float(sys.argv[3]) if len(sys.argv) > 3 else 67.0
VIDEO = f"input/{TAG}.mp4"
CACHE = f"output/multi/{TAG}/det_{int(T0)}_{int(DUR)}_x.pkl"
OUT = f"output/analysis/{TAG}_{int(T0)}_{int(DUR)}"
os.makedirs(OUT, exist_ok=True)
STRIDE, PERSON_H, RALLY_GAP, TRAIL_N = 2, 1.75, 4.0, 14
G, RESTITUTION = 9.81, 0.80

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])
KP = np.float32(json.load(open(f"kp_{TAG}.json")))
H_i2w, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
H_w2i = np.linalg.inv(H_i2w)
to_court = lambda p: cv2.perspectiveTransform(np.float32([[p]]), H_i2w).reshape(2)

cap = cv2.VideoCapture(VIDEO); fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
cap.release()
dt = STRIDE/fps
D = pickle.load(open(CACHE, "rb"))
ball_raw, persons, poses = D["ball"], D["persons"], D["poses"]
NF = len(ball_raw)
print(f"[cache] {NF}프레임 {T0}~{T0+DUR}초", flush=True)

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
print(f"[ball] {seen.sum()}/{NF} ({seen.mean()*100:.0f}%)", flush=True)

# ---------- 샷: 공-선수 최근접 ----------
# 소리 기준은 바운스를 타격으로 오인했다(정답 17타 랠리에서 23타로 +35%).
# 근접법은 같은 랠리에서 18타로 오차 6%. 귀속도 '공에 가까운 쪽'으로 바로 나오므로
# 교대 규칙을 강제하지 않는다.
bd = lambda p, b: np.hypot(max(b[0]-p[0], 0, p[0]-b[2]), max(b[1]-p[1], 0, p[1]-b[3]))
dist = np.full((NF, 2), np.nan)
for i, (a_, b_) in enumerate(persons):
    for k, q in enumerate((a_, b_)):
        if q:
            dist[i, k] = bd((bx[i], by[i]), q["box"])
_d = np.where(np.isnan(dist), 1e4, dist)
near_px, near_who = _d.min(axis=1), _d.argmin(axis=1)+1
sm_px = np.convolve(near_px, np.ones(3)/3, mode="same")
# 타격 순간에는 공이 라켓·몸에 가려져 검출이 안 되는 일이 잦다(P2는 48%).
# 그래서 미검출(예측) 프레임도 후보로 받되, 예측 구간에서 국소최소가 여러 번
# 생겨 한 타격이 쪼개지는 것을 막으려 최소 간격을 0.9초로 둔다.
# 손으로 센 17타 랠리로 검증: 이 조합이 오차 0 (기존 검출만+0.45s는 +1).
SHOT_GAP = 0.9
shots = []
for i in range(3, NF-3):
    if sm_px[i] == min(sm_px[max(0, i-9):i+10]) and sm_px[i] < 150:
        if not shots or (i-shots[-1]["i"])*dt > SHOT_GAP:
            shots.append(dict(t=round(T0+i*dt, 2), i=i, who=int(near_who[i]),
                              px=round(float(sm_px[i]), 1), ball_seen=bool(seen[i])))
print(f"[shot] 근접법 {len(shots)}개 (P1 {sum(s['who']==1 for s in shots)} / "
      f"P2 {sum(s['who']==2 for s in shots)})", flush=True)

for s in shots:                     # 위치·속도
    q = persons[s["i"]][s["who"]-1]
    s["pos"] = None if q is None else [round(float(v), 2) for v in q["world"]]
    if q is None:
        s["speed"] = 0.0
    else:
        ppm = (q["box"][3]-q["box"][1])/PERSON_H
        j = min(s["i"]+int(round(0.30/dt)), NF-1)
        st = [np.hypot(bx[k+1]-bx[k], by[k+1]-by[k])/ppm/dt*3.6 for k in range(s["i"], j)]
        s["speed"] = round(min(float(np.median(st)) if st else 0.0, 200.0), 1)

# 스윙 종류 — 타격 시점 자세로 판정.
# COCO 10=오른손목, 5/6=어깨, 11/12=엉덩이.
# P1은 카메라를 등지고 P2는 마주 보므로 P2는 좌우가 뒤집힌다.
def classify_swing(ks, who):
    if ks is None or ks[10][0] == 0:
        return None
    pts = [ks[j][0] for j in (5, 6, 11, 12) if ks[j][0] > 0]
    if len(pts) < 2:
        return None
    right_of_body = ks[10][0] > float(np.mean(pts))
    fore = right_of_body if who == 1 else (not right_of_body)
    return "Forehand" if fore else "Backhand"


for s_ in shots:
    s_["swing"] = classify_swing(poses[s_["i"]][s_["who"]-1], s_["who"])
_sw = [s_ for s_ in shots if s_["swing"]]
print(f"[swing] 판정 {len(_sw)}/{len(shots)}건 | "
      f"P1 {sum(1 for x in _sw if x['who']==1 and x['swing']=='Forehand')}FH/"
      f"{sum(1 for x in _sw if x['who']==1 and x['swing']=='Backhand')}BH  "
      f"P2 {sum(1 for x in _sw if x['who']==2 and x['swing']=='Forehand')}FH/"
      f"{sum(1 for x in _sw if x['who']==2 and x['swing']=='Backhand')}BH", flush=True)

# 랠리 경계는 선수 정지 구간에서 온다 (rally_scan.py).
# 소리 간격은 포인트를 못 가른다 — 이 경기 최대 간격이 2.8초라 어떤 임계값도 안 통한다.
RF = f"output/rallies_{TAG}.json"
if not os.path.exists(RF):
    raise SystemExit(f"{RF} 없음 — 먼저 'python rally_scan.py {TAG}' 실행")
GR = json.load(open(RF))["rallies"]
rallies, rally_of, used = [], {}, set()
for r in GR:
    inside = [s for s in shots
              if r["start"]-0.5 <= s["t"] <= r["end"]+0.5 and s["i"] not in used]
    if not inside:
        continue
    used.update(s["i"] for s in inside)
    # 화면에는 이 클립 안에서 1부터 매긴 번호를, JSON에는 전체 경기 번호도 남긴다
    local = len(rallies)+1
    rallies.append(dict(no=local, global_no=r["no"], start=r["start"],
                        end=r["end"], shots=inside))
    for x, s in enumerate(inside, 1):
        rally_of[s["i"]] = (local, x, len(inside))
orphan = len(shots) - sum(len(r["shots"]) for r in rallies)
print(f"[rally] 이 구간에 랠리 {len(rallies)}개: "
      f"{[(r['no'], r['global_no'], len(r['shots'])) for r in rallies]}"
      f"{f'  (랠리 밖 타격 {orphan}개)' if orphan else ''}", flush=True)
print(f"[rally] 랠리별 타수 {[len(r['shots']) for r in rallies]}", flush=True)


# ---------- 낙구 계산용 구간 (샷과 분리) ----------
# 낙구는 '구간마다 포물선 1개'로 푸는 구조라 구간이 많을수록 후보가 늘어난다.
# 샷 검출을 근접법으로 바꿔도 낙구 구간은 종전대로 오디오 onset 을 쓴다.
wav = f"{OUT}/audio.wav"
if not os.path.exists(wav):
    os.system(f'ffmpeg -v error -ss {T0} -t {DUR} -i "{VIDEO}" -ac 1 -ar 22050 "{wav}" -y')
_y, _sr = librosa.load(wav, sr=22050)
_S = librosa.feature.melspectrogram(y=_y, sr=_sr, n_fft=2048, hop_length=512,
                                    fmin=2000, fmax=8000, n_mels=64)
_e = librosa.onset.onset_strength(S=librosa.power_to_db(_S, ref=np.max), sr=_sr)
_e = _e/(_e.max()+1e-9)
seg_t = [T0+t for t in librosa.onset.onset_detect(onset_envelope=_e, sr=_sr,
                                                  units="time", delta=0.28, wait=8)]
seg_i = [int(round((t-T0)/dt)) for t in seg_t if 0 <= int(round((t-T0)/dt)) < NF]
print(f"[bounce] 구간 경계 {len(seg_i)}개 (오디오 기준, 샷과 무관)", flush=True)


# ---------- 카메라 · 3D 낙구 ----------
def camera_from_homography(Hw2i):
    cx, cy = W/2.0, H/2.0
    h1, h2, h3 = Hw2i[:, 0], Hw2i[:, 1], Hw2i[:, 2]
    a1 = np.array([h1[0]-cx*h1[2], h1[1]-cy*h1[2]])
    a2 = np.array([h2[0]-cx*h2[2], h2[1]-cy*h2[2]])
    den = h1[2]*h2[2]
    f2 = -(a1 @ a2)/den if abs(den) > 1e-12 else -1
    f = float(np.sqrt(f2)) if f2 > 0 else 1.2*max(W, H)
    K = np.array([[f,0,cx],[0,f,cy],[0,0,1.0]]); Ki = np.linalg.inv(K)
    r1_, r2_, t_ = Ki@h1, Ki@h2, Ki@h3
    lam = 1.0/np.linalg.norm(r1_)
    r1, r2, t = r1_*lam, r2_*lam, t_*lam
    if t[2] < 0:
        r1, r2, t = -r1, -r2, -t
    r3 = np.cross(r1, r2)
    P = K @ np.column_stack([r1, r2, r3, t])
    c = np.array([WD/2, L/2])
    p0 = P@np.array([c[0], c[1], 0, 1.0]); p0 = p0[:2]/p0[2]
    p1 = P@np.array([c[0], c[1], 1.0, 1.0]); p1 = p1[:2]/p1[2]
    if p1[1] > p0[1]:
        r3 = -r3; P = K @ np.column_stack([r1, r2, r3, t])
    return P, np.column_stack([r1, r2, r3]), t, f


P, R, tv, focal = camera_from_homography(H_w2i)
chk = np.mean([np.hypot(*(cv2.perspectiveTransform(np.float32([[w]]), H_w2i).reshape(2) -
                          (lambda v: v[:2]/v[2])(P@np.array([w[0], w[1], 0, 1.0]))))
               for w in WORLD])
print(f"[cam] f={focal:.0f}px  Z=0 검증 {chk:.3f}px", flush=True)
project = lambda X: (lambda v: (v[:2]/v[2]).T)(P @ np.hstack([X, np.ones((len(X), 1))]).T)


def fit_bounce(ts, uv):
    g = cv2.perspectiveTransform(uv.reshape(-1,1,2).astype(np.float32), H_i2w).reshape(-1,2)
    m = len(ts)//2
    v0 = (g[-1]-g[0])/max(ts[-1]-ts[0], 1e-3)
    q0 = np.array([g[m][0], g[m][1], v0[0], v0[1], -6.0, ts[m]])
    lo = [-8,-8,-60,-60,-30, ts[0]]; hi = [WD+8, L+8, 60, 60, -0.5, ts[-1]]

    def res(q):
        Xb, Yb, Vx, Vy, w, tau = q
        s = ts-tau
        Z = np.where(s < 0, w*s-0.5*G*s**2, -RESTITUTION*w*s-0.5*G*s**2)
        return (project(np.column_stack([Xb+Vx*s, Yb+Vy*s, Z])) - uv).ravel()

    r = least_squares(res, np.clip(q0, lo, hi), bounds=(lo, hi),
                      loss="soft_l1", f_scale=8.0, max_nfev=400)
    e = np.abs(r.fun).reshape(-1, 2)
    return dict(pos=[round(float(r.x[0]), 2), round(float(r.x[1]), 2)],
                t=round(T0+float(r.x[5]), 2),
                med_px=round(float(np.median(np.hypot(e[:,0], e[:,1]))), 1), n=len(ts))


def track_ok(a, b):
    """구간의 공 궤적이 믿을 만한가.
    재투영 오차만으로는 '가짜 점들에 잘 맞은' 경우를 못 거른다."""
    win = range(a, min(b+1, NF))
    det = [k for k in win if seen[k]]
    if len(list(win)) < 6 or len(det)/max(len(list(win)), 1) < 0.65:
        return False, "검출부족"
    for u, v in zip(det, det[1:]):
        gap = (v-u)*dt
        if gap < 0.25 and np.hypot(bx[v]-bx[u], by[v]-by[u]) > 200:
            return False, "궤적점프"
    return True, ""


bounces = []
for a, b in zip(seg_i, seg_i[1:]):
    good, why = track_ok(a, b)
    if not good:
        continue
    idx = [k for k in range(a+2, b-1) if seen[k] and 0 <= bx[k] < W and 0 <= by[k] < H]
    if len(idx) < 8:
        continue
    f = fit_bounce(np.array(idx, float)*dt, np.column_stack([bx[idx], by[idx]]))
    f["inside"] = bool(-1 < f["pos"][0] < WD+1 and -1 < f["pos"][1] < L+1)
    f["ok"] = bool(f["med_px"] < 25 and f["inside"])
    bounces.append(f)
# 랠리의 첫 타격~마지막 타격 사이에 있는 것만 남긴다.
# 죽은 시간에 잡히는 것은 서브 전 공 튀기기·굴러다니는 공이라 랠리 낙구가 아니다.
_spans = [(r["shots"][0]["t"], r["shots"][-1]["t"]) for r in rallies if len(r["shots"]) >= 2]
def _in_rally(t):
    return any(a-0.2 <= t <= b+1.5 for a, b in _spans)
_before = sum(1 for b in bounces if b["ok"])
for b in bounces:
    b["in_rally"] = bool(_in_rally(b["t"]))
    b["ok"] = bool(b["ok"] and b["in_rally"])
ok = [b for b in bounces if b["ok"]]
print(f"[bounce] 랠리 밖 제외 {_before} -> {len(ok)}개", flush=True)
print(f"[bounce] {len(ok)}/{len(bounces)}구간 성공", flush=True)

# 검증: 랠리에선 낙구가 네트 양쪽에 번갈아 떨어져야 한다
alt = sum(1 for a, b in zip(ok, ok[1:])
          if (a["pos"][1] < NET) != (b["pos"][1] < NET))
print(f"[verify] 좌우 교대 {alt}/{max(len(ok)-1,1)}회", flush=True)

sp = {w: [s["speed"] for s in shots if s["who"] == w and s["speed"] > 0] for w in (1, 2)}
result = dict(
    video=VIDEO, window=[T0, T0+DUR], fps=round(fps, 2),
    quality=dict(court_reproj_err_m=round(float(np.abs(
        cv2.perspectiveTransform(KP.reshape(-1,1,2), H_i2w).reshape(-1,2)-WORLD).mean()), 4),
        ball_detect_rate=round(float(seen.mean()), 3),
        p1_detect_rate=round(sum(1 for a, b in persons if a)/NF, 3),
        p2_detect_rate=round(sum(1 for a, b in persons if b)/NF, 3),
        bounce_success=f"{len(ok)}/{len(bounces)}",
        bounce_side_alternation=f"{alt}/{max(len(ok)-1,1)}"),
    totals=dict(shots=len(shots), rallies=len(rallies),
                rally_sizes=[len(r["shots"]) for r in rallies],
                longest_rally=max((len(r["shots"]) for r in rallies), default=0),
                bounces=len(ok)),
    players={f"P{w}": dict(shots=sum(1 for s in shots if s["who"] == w),
                           stroke_kmh_median=round(float(np.median(sp[w])), 1) if sp[w] else None,
                           stroke_kmh_max=round(float(np.max(sp[w])), 1) if sp[w] else None)
             for w in (1, 2)},
    rallies=[dict(no=r["no"], global_no=r["global_no"], start=r["start"],
                  end=r["end"], shots=len(r["shots"]),
                  # 선수 이동 경로 (초당 5회로 줄여 저장). 리포트 코트맵용.
                  track={f"P{w}": [[round(float(persons[k][w-1]["world"][0]), 2),
                                    round(float(persons[k][w-1]["world"][1]), 2)]
                                   for k in range(max(int((r["start"]-T0)/dt), 0),
                                                  min(int((r["end"]-T0)/dt), NF), 3)
                                   if persons[k][w-1]] for w in (1, 2)})
             for r in rallies],
    shots=[dict({k: v for k, v in s.items() if k not in ("i", "d1", "d2")},
                rally_shot_no=rally_of.get(s["i"], (0, 0, 0))[1]) for s in shots],
    bounces=ok, bounces_all=bounces,
    court=dict(length_m=L, width_doubles_m=WD, width_singles_m=WS))
json.dump(result, open(f"{OUT}/results.json", "w"), indent=2, ensure_ascii=False)
np.savez(f"{OUT}/track.npz", bx=bx, by=by, seen=seen)
print(f"{OUT}/results.json", flush=True)

# ---------- 오버레이 영상 ----------
MGX, MGY = 2.0, 3.5
SPX, SPY = WD+2*MGX, L+2*MGY
MW, MH, MX, MY = 290, 600, W-350, 130
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


# 렌더할 때마다 새 버전 번호를 붙인다 (이전 결과를 덮어쓰지 않는다)
import glob as _glob
_ver = 1 + max([int(os.path.basename(f).split("_v")[1].split(".")[0])
                for f in _glob.glob(f"{OUT}/overlay_v*.mp4")] or [0])
VID = f"{OUT}/overlay_v{_ver}.mp4"
# --rally N 이 주어지면 그 랠리 구간만 렌더한다 (공유용 클립)
ONLY = None
if "--rally" in sys.argv:
    _n = int(sys.argv[sys.argv.index("--rally")+1])
    _r = next((r for r in rallies if r["no"] == _n), None)
    if _r is None:
        raise SystemExit(f"랠리 {_n} 없음")
    ONLY = (max(int((_r["start"]-T0)/dt)-15, 0),
            min(int((_r["end"]-T0)/dt)+25, NF-1))
    print(f"[render] 랠리 {_n}만 렌더: 클립 {ONLY[0]*dt:.1f}~{ONLY[1]*dt:.1f}초 "
          f"({(ONLY[1]-ONLY[0])*dt:.1f}초)", flush=True)
RLABEL = _n if ONLY else None

cap = cv2.VideoCapture(VIDEO)
cap.set(cv2.CAP_PROP_POS_FRAMES, int((T0 + (ONLY[0]*dt if ONLY else 0))*fps))
vw = cv2.VideoWriter(VID, cv2.VideoWriter_fourcc(*"mp4v"), 1/dt, (W, H))
trail = {1: [], 2: []}; last_sp = {1: 0.0, 2: 0.0}; cur = (0, 0, 0)
last_sw = {1: "-", 2: "-"}
_lo, _hi = ONLY if ONLY else (0, NF)
for i in range(_lo, _hi):
    ok_ = False
    for _ in range(STRIDE):
        ok_, v = cap.read()
    if not ok_:
        break
    if i in rally_of:
        cur = rally_of[i]
    for s in shots:
        if s["i"] == i:
            last_sp[s["who"]] = s["speed"]
    for j, (x, y) in enumerate(KP):
        if 0 <= x < W and 0 <= y < H:
            cv2.circle(v, (int(x), int(y)), 6, (0,0,255), -1)
            cv2.circle(v, (int(x), int(y)), 18, (0,0,255), 2)
    for w_, q in ((1, persons[i][0]), (2, persons[i][1])):
        if q:
            trail[w_].append(q["world"])
            x1, y1, x2, y2 = map(int, q["box"])
            cv2.rectangle(v, (x1,y1), (x2,y2), COL[w_], 3)
            cv2.rectangle(v, (x1, y1-32), (x1+96, y1), COL[w_], -1)
            cv2.putText(v, f"P{w_}", (x1+8, y1-8), cv2.FONT_HERSHEY_SIMPLEX, .75, (0,0,0), 2)
    k0 = max(0, i-TRAIL_N)
    for k in range(k0+1, i+1):
        if seen[k] and seen[k-1] and np.hypot(bx[k]-bx[k-1], by[k]-by[k-1]) < 200:
            a = (k-k0)/max(i-k0, 1)
            cv2.line(v, (int(bx[k-1]), int(by[k-1])), (int(bx[k]), int(by[k])),
                     (0, int(150+90*a), 255), max(1, int(1+3*a)), cv2.LINE_AA)
    cv2.circle(v, (int(bx[i]), int(by[i])), 13,
               (0,255,255) if seen[i] else (150,150,150), 3)
    ov = v.copy()
    cv2.rectangle(ov, (MX-24, MY-50), (MX+MW+24, MY+MH+24), (250,250,250), -1)
    cv2.addWeighted(ov, .85, v, .15, 0, v)
    cv2.putText(v, "COURT MAP", (MX-4, MY-18), cv2.FONT_HERSHEY_SIMPLEX, .68, (40,40,40), 2)
    for a, b_ in LINES:
        cv2.line(v, mini(WORLD[a]), mini(WORLD[b_]), (95,95,95), 2)
    cv2.line(v, mini([0, NET]), mini([WD, NET]), (200,60,60), 3)
    for w_ in (1, 2):
        for sg in clean(trail[w_]):
            cv2.polylines(v, [np.int32([mini(q) for q in sg])], False, COL[w_], 1, cv2.LINE_AA)
    for b in ok:
        if (ONLY is None or _lo*dt <= b["t"]-T0 <= _hi*dt) and b["t"] <= T0+i*dt:
            cv2.drawMarker(v, mini(b["pos"]), (20,140,20), cv2.MARKER_TILTED_CROSS, 17, 3)
    for s in shots:
        if not ((ONLY is None or _lo <= s["i"] <= _hi) and s["i"] <= i and s["pos"]):
            continue
        p = mini(s["pos"])
        cv2.circle(v, p, 13, COL[s["who"]], -1); cv2.circle(v, p, 13, (255, 255, 255), 2)
        nn = rally_of.get(s["i"], (0, 0, 0))[1]
        cv2.putText(v, str(nn), (p[0]-5 if nn < 10 else p[0]-10, p[1]+5),
                    cv2.FONT_HERSHEY_SIMPLEX, .42, (255, 255, 255), 1, cv2.LINE_AA)
        if s.get("swing"):
            cv2.putText(v, s["swing"][0], (p[0]+15, p[1]+5), cv2.FONT_HERSHEY_SIMPLEX,
                        .42, (30, 30, 30), 3, cv2.LINE_AA)
            cv2.putText(v, s["swing"][0], (p[0]+15, p[1]+5), cv2.FONT_HERSHEY_SIMPLEX,
                        .42, COL[s["who"]], 1, cv2.LINE_AA)
    for w_, q in ((1, persons[i][0]), (2, persons[i][1])):
        if q:
            cv2.circle(v, mini(q["world"]), 8, COL[w_], -1)
            cv2.circle(v, mini(q["world"]), 8, (255,255,255), 2)
    for s in shots:
        if s["i"] == i and s.get("swing"):
            last_sw[s["who"]] = s["swing"]
    if RLABEL is not None:
        def _t(txt, org, sc, col):
            cv2.putText(v, txt, org, cv2.FONT_HERSHEY_SIMPLEX, sc, (0, 0, 0), 6, cv2.LINE_AA)
            cv2.putText(v, txt, org, cv2.FONT_HERSHEY_SIMPLEX, sc, col, 2, cv2.LINE_AA)
        _t(f"Rally {RLABEL}", (40, H-100), 1.25, (255, 255, 255))
        cv2.circle(v, (52, H-56), 11, COL[1], -1)
        cv2.circle(v, (52, H-56), 11, (255, 255, 255), 2)
        _t(f"P1  {last_sw[1]}", (74, H-48), .82, (255, 255, 255))
        cv2.circle(v, (352, H-56), 11, COL[2], -1)
        cv2.circle(v, (352, H-56), 11, (255, 255, 255), 2)
        _t(f"P2  {last_sw[2]}", (374, H-48), .82, (255, 255, 255))
    vw.write(v)
vw.release(); cap.release()
json.dump(result, open(f"{OUT}/results_v{_ver}.json", "w"), indent=2, ensure_ascii=False)
print(f"{VID}  (+ results_v{_ver}.json)", flush=True)
