"""오버레이 v4 — 선수별 귀속을 화면 좌표로 교체, 스트로크 속도 재설계.

v3에서 바뀐 것:
  - 귀속: 코트 좌표 변환을 버리고 '화면상 공-선수 거리'로 판정
          (공중의 공은 바닥 투영이 크게 어긋나 P2로 쏠렸음: 5 vs 13)
  - 스트로크 속도: 바닥 평면 대신 '선수 키(1.75m)'를 자로 사용
  - 검출 결과를 캐시에 저장 -> 표시만 바꿀 땐 재검출 생략

  python render_overlay_v4.py <시작초> <길이초> [--rerun]
"""
import sys, json, os, pickle
import cv2
import numpy as np
import torch, torchvision
from torchvision import transforms
from ultralytics import YOLO


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


VIDEO = "input/match_amateur.mp4"
OUT = "output/demo_v4"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
T0 = float(args[0]) if args else 33.0
DUR = float(args[1]) if len(args) > 1 else 60.0
RERUN = "--rerun" in sys.argv
STRIDE, BALL_CONF, IMGSZ = 2, 0.05, 1280
RALLY_GAP, PERSON_H = 4.0, 1.75      # 사람 키를 자로 쓴다
os.makedirs(OUT, exist_ok=True)
CACHE = f"{OUT}/detections.pkl"

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
NF = int(DUR*fps/STRIDE); dt = STRIDE/fps
cap.release()

# ---------- 코트 ----------
def court_kp():
    m = torchvision.models.resnet50()
    m.fc = torch.nn.Linear(m.fc.in_features, 28)
    m.load_state_dict(torch.load("models/keypoints_model.pth", map_location="cpu"))
    m.eval()
    t = transforms.Compose([transforms.ToPILImage(), transforms.Resize((224,224)),
                            transforms.ToTensor(),
                            transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
    c = cv2.VideoCapture(VIDEO); c.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
    _, f = c.read(); c.release()
    with torch.no_grad():
        o = m(t(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)).unsqueeze(0))[0].numpy()
    return (o.reshape(14,2) * [W/224.0, H/224.0]).astype(np.float32)


# ---------- PASS 1 (캐시) ----------
def detect():
    ball_model = YOLO("models/yolo5_last.pt")
    person_model = YOLO("yolov8n.pt")
    pose_model = YOLO("yolov8n-pose.pt")
    KP = court_kp()
    Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
    tc = lambda p: cv2.perspectiveTransform(np.float32([[p]]), Hm).reshape(2)

    ball, persons, poses = [], [], []
    c = cv2.VideoCapture(VIDEO); c.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
    n = 0
    while len(ball) < NF:
        ok = c.grab()
        if not ok:
            break
        if n % STRIDE == 0:
            ok, f = c.retrieve()
            if not ok:
                break
            b = ball_model.predict(f, device="mps", imgsz=IMGSZ, conf=BALL_CONF,
                                   augment=True, verbose=False)[0].boxes
            ball.append([((float(b.xyxy[k][0])+float(b.xyxy[k][2]))/2,
                          (float(b.xyxy[k][1])+float(b.xyxy[k][3]))/2,
                          float(b.conf[k])) for k in range(len(b))])
            p = person_model.predict(f, device="mps", imgsz=960, conf=.35,
                                     classes=[0], verbose=False)[0].boxes
            cand = []
            for k in range(len(p)):
                x1, y1, x2, y2 = p.xyxy[k].tolist()
                wx, wy = tc(((x1+x2)/2, y2))
                if -2 < wx < WD+2 and -2 < wy < L+2:
                    cand.append(dict(box=(x1,y1,x2,y2), world=(float(wx), float(wy))))
            near = max((q for q in cand if q["world"][1] > NET),
                       key=lambda q: q["world"][1], default=None)
            far = min((q for q in cand if q["world"][1] <= NET),
                      key=lambda q: q["world"][1], default=None)
            persons.append((near, far))
            sw = []
            for q in (near, far):
                if q is None:
                    sw.append(None); continue
                x1, y1, x2, y2 = q["box"]
                mx, my = (x2-x1)*.25, (y2-y1)*.15
                cx1, cy1 = max(int(x1-mx), 0), max(int(y1-my), 0)
                cx2, cy2 = min(int(x2+mx), W), min(int(y2+my), H)
                crop = f[cy1:cy2, cx1:cx2]
                if crop.size == 0 or crop.shape[0] < 20:
                    sw.append(None); continue
                s = min(640/max(crop.shape[0], 1), 4.0)
                crop = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
                r = pose_model.predict(crop, device="mps", imgsz=640, conf=.25, verbose=False)[0]
                if r.keypoints is None or len(r.keypoints.xy) == 0:
                    sw.append(None); continue
                sw.append(max(r.keypoints.xy.cpu().numpy(),
                              key=lambda a: (a[:,1].max()-a[:,1].min())))
            poses.append(sw)
            if len(ball) % 200 == 0:
                print(f"[pass1] {len(ball)}/{NF}", flush=True)
        n += 1
    c.release()
    return dict(KP=KP, ball=ball, persons=persons, poses=poses)


if os.path.exists(CACHE) and not RERUN:
    D = pickle.load(open(CACHE, "rb"))
    print(f"[cache] {CACHE} 재사용 ({len(D['ball'])}프레임)", flush=True)
else:
    D = detect()
    pickle.dump(D, open(CACHE, "wb"))
    print(f"[cache] 저장 {CACHE}", flush=True)

KP, ball_raw, persons, poses = D["KP"], D["ball"], D["persons"], D["poses"]
NF = len(ball_raw)
Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
rerr = float(np.abs(cv2.perspectiveTransform(KP.reshape(-1,1,2), Hm).reshape(-1,2)-WORLD).mean())
to_court = lambda p: cv2.perspectiveTransform(np.float32([[p]]), Hm).reshape(2)
print(f"[court] 재투영 오차 {rerr:.3f}m", flush=True)

# ---------- 공: 정적 오탐 제거 + 칼만 ----------
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


def box_dist(pt, box):
    """점에서 사각형까지의 화면상 거리 (안이면 0)."""
    x1, y1, x2, y2 = box
    return np.hypot(max(x1-pt[0], 0, pt[0]-x2), max(y1-pt[1], 0, pt[1]-y2))


# ---------- 샷: 타격음 + 화면 좌표 귀속 ----------
audio = sorted(h["t"] for h in json.load(open("output/trackB_hits.json"))
               if T0 <= h["t"] <= T0+DUR)
shots = []
for t in audio:
    i = int(round((t-T0)/dt))
    if not 0 <= i < NF:
        continue
    p1, p2 = persons[i]
    d1 = box_dist((bx[i], by[i]), p1["box"]) if p1 else None
    d2 = box_dist((bx[i], by[i]), p2["box"]) if p2 else None
    shots.append(dict(t=round(t, 2), i=i, who=None,
                      d1=None if d1 is None else round(float(d1), 1),
                      d2=None if d2 is None else round(float(d2), 1)))

# 랠리 묶기 (귀속 전에 — 교대 제약을 랠리 단위로 걸어야 하므로)
rallies = []
for s in shots:
    if rallies and s["t"] - rallies[-1][-1]["t"] < RALLY_GAP:
        rallies[-1].append(s)
    else:
        rallies.append([s])

# 귀속: 확실한 증거로 기준점을 잡고 교대 제약으로 채운다.
# 단식에서 랠리 안의 샷은 반드시 번갈아 나온다.
def evidence(s):
    """(누구, 확신도). 한쪽만 검출됐거나 둘 다 멀면 확신도가 낮다."""
    d1, d2 = s["d1"], s["d2"]
    if d1 is None and d2 is None:
        return None, 0.0
    if d1 is None:
        return (2, 0.3) if d2 < 120 else (2, 0.0)
    if d2 is None:
        return (1, 0.3) if d1 < 120 else (1, 0.0)
    who, dn, df = (1, d1, d2) if d1 <= d2 else (2, d2, d1)
    conf = 0.0
    if dn <= 5:                      # 공이 상자 안 = 가장 확실
        conf = 1.0
    elif dn < 120 and df > dn * 3:
        conf = 0.7
    elif df > dn * 2:
        conf = 0.4
    return who, conf


for r in rallies:
    ev = [evidence(s) for s in r]
    best = max(range(len(r)), key=lambda k: ev[k][1])
    if ev[best][1] <= 0.0:                      # 근거가 하나도 없으면 거리로만
        for s, (w, _) in zip(r, ev):
            s["who"] = w or 1
        continue
    anchor_who = ev[best][0]
    for k in range(len(r)):                     # 기준점에서 교대로 전파
        r[k]["who"] = anchor_who if (k - best) % 2 == 0 else 3 - anchor_who

for s in shots:                                 # 랠리에 안 묶인 단발 샷
    if s["who"] is None:
        w, _ = evidence(s)
        s["who"] = w or 1

for s in shots:                                 # 귀속 확정 후 속도 계산
    q = persons[s["i"]][s["who"]-1] or persons[s["i"]][0] or persons[s["i"]][1]
    if q is None:
        s["speed"] = 0.0; continue
    ppm = (q["box"][3]-q["box"][1]) / PERSON_H
    j = min(s["i"] + int(round(0.30/dt)), NF-1)
    step = [np.hypot(bx[k+1]-bx[k], by[k+1]-by[k])/ppm/dt*3.6 for k in range(s["i"], j)]
    s["speed"] = round(min(float(np.median(step)) if step else 0.0, 200.0), 1)

print(f"[shot] {len(shots)}개 (P1 {sum(s['who']==1 for s in shots)} / "
      f"P2 {sum(s['who']==2 for s in shots)})", flush=True)
rallies = [r for r in rallies if len(r) >= 2]
print(f"[rally] {len(rallies)}개 {[len(r) for r in rallies]}", flush=True)


def classify(ks, who):
    if ks is None or ks[10][0] == 0:
        return None
    pts = [ks[j][0] for j in (5, 6, 11, 12) if ks[j][0] > 0]
    if len(pts) < 2:
        return None
    right = ks[10][0] > float(np.mean(pts))
    return "Forehand" if (right if who == 1 else not right) else "Backhand"


swing_at = {}
for s in shots:
    c = classify(poses[s["i"]][s["who"]-1], s["who"])
    if c:
        swing_at[s["i"]] = (s["who"], c)
print(f"[swing] {len(swing_at)}/{len(shots)}건 "
      f"P1 {[c for w,c in swing_at.values() if w==1].count('Forehand')}FH/"
      f"{[c for w,c in swing_at.values() if w==1].count('Backhand')}BH  "
      f"P2 {[c for w,c in swing_at.values() if w==2].count('Forehand')}FH/"
      f"{[c for w,c in swing_at.values() if w==2].count('Backhand')}BH", flush=True)


def pspeed(which):
    out = np.zeros(NF)
    for i in range(1, NF):
        a, b_ = persons[i-1][which], persons[i][which]
        if a and b_:
            out[i] = min(np.hypot(*(np.array(b_["world"])-np.array(a["world"])))/dt*3.6, 40)
    return np.convolve(out, np.ones(5)/5, mode="same")


sp1, sp2 = pspeed(0), pspeed(1)
st = {1: [s["speed"] for s in shots if s["who"] == 1],
      2: [s["speed"] for s in shots if s["who"] == 2]}
print(f"[speed] 스트로크 중앙값 P1 {np.median(st[1]) if st[1] else 0:.0f} / "
      f"P2 {np.median(st[2]) if st[2] else 0:.0f} km/h (근사)", flush=True)

# ---------- PASS 2 : 렌더 ----------
MW, MH, MX, MY = 210, 440, W-260, 60
mini = lambda p: (int(MX + p[0]*MW/WD), int(MY + p[1]*MH/L))
LINES = [(0,1),(1,3),(3,2),(2,0),(4,5),(6,7),(8,9),(10,11),(12,13)]
cap = cv2.VideoCapture(VIDEO); cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
vw = cv2.VideoWriter(f"{OUT}/overlay_v4.mp4", cv2.VideoWriter_fourcc(*"mp4v"), 1/dt, (W, H))
last_sw = {1: "-", 2: "-"}; last_st = {1: 0.0, 2: 0.0}
for i in range(NF):
    ok = False
    for _ in range(STRIDE):
        ok, v = cap.read()
    if not ok:
        break
    if i in swing_at:
        w_, c_ = swing_at[i]; last_sw[w_] = c_
    for s in shots:
        if s["i"] == i:
            last_st[s["who"]] = s["speed"]
    for j, (x, y) in enumerate(KP):
        cv2.circle(v, (int(x), int(y)), 8, (0,0,255), -1)
        cv2.circle(v, (int(x), int(y)), 24, (0,0,255), 2)
        cv2.putText(v, str(j), (int(x)-8, int(y)+6), cv2.FONT_HERSHEY_SIMPLEX, .55, (255,255,255), 2)
    for w_, q in ((1, persons[i][0]), (2, persons[i][1])):
        if q:
            x1, y1, x2, y2 = map(int, q["box"])
            cv2.rectangle(v, (x1,y1), (x2,y2), (0,0,255), 3)
            cv2.putText(v, f"Player ID: {w_}", (x1, y1-12), cv2.FONT_HERSHEY_SIMPLEX, .9, (0,0,255), 2)
    col = (0,255,255) if seen[i] else (150,150,150)
    cv2.rectangle(v, (int(bx[i])-12, int(by[i])-12), (int(bx[i])+12, int(by[i])+12), col, 3)
    cv2.putText(v, "Ball ID: 1", (int(bx[i])-40, int(by[i])-22), cv2.FONT_HERSHEY_SIMPLEX, .85, col, 2)
    ov = v.copy(); cv2.rectangle(ov, (MX-18, MY-18), (MX+MW+18, MY+MH+18), (255,255,255), -1)
    cv2.addWeighted(ov, .55, v, .45, 0, v)
    for a, b_ in LINES:
        cv2.line(v, mini(WORLD[a]), mini(WORLD[b_]), (0,0,0), 2)
    cv2.line(v, mini([0, NET]), mini([WD, NET]), (255,0,0), 2)
    for q in persons[i]:
        if q:
            cv2.circle(v, mini(q["world"]), 6, (0,150,0), -1)
    n_rally = sum(1 for r in rallies if r[0]["i"] <= i)
    n1 = sum(1 for s in shots if s["i"] <= i and s["who"] == 1)
    n2 = sum(1 for s in shots if s["i"] <= i and s["who"] == 2)
    px, py = W-700, H-330
    ov = v.copy(); cv2.rectangle(ov, (px,py), (px+680, py+300), (35,35,35), -1)
    cv2.addWeighted(ov, .78, v, .22, 0, v)
    rows = [("", "Player 1", "Player 2"), ("Rally", f"{n_rally}", ""),
            ("Shots", f"{n1}", f"{n2}"),
            ("Stroke (approx)", f"~{last_st[1]:.0f} km/h", f"~{last_st[2]:.0f} km/h"),
            ("Player speed", f"{sp1[i]:.1f} km/h", f"{sp2[i]:.1f} km/h"),
            ("Last swing", last_sw[1], last_sw[2])]
    for r, (a, b_, c_) in enumerate(rows):
        yy = py + 44 + r*46
        cv2.putText(v, a, (px+18, yy), cv2.FONT_HERSHEY_SIMPLEX, .72, (200,200,200), 2)
        cv2.putText(v, b_, (px+330, yy), cv2.FONT_HERSHEY_SIMPLEX, .72, (255,255,255), 2)
        cv2.putText(v, c_, (px+510, yy), cv2.FONT_HERSHEY_SIMPLEX, .72, (255,255,255), 2)
    cv2.putText(v, f"t={T0+i*dt:.1f}s", (20, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,255,0), 2)
    vw.write(v)
vw.release(); cap.release()
_h264(f"{OUT}/overlay_v4.mp4")

json.dump(dict(window=[T0, T0+DUR], frames=NF, reproj_err_m=round(rerr, 3),
               ball_detect_rate=round(float(seen.mean()), 3),
               shots=len(shots), shots_p1=len(st[1]), shots_p2=len(st[2]),
               rallies=len(rallies), rally_sizes=[len(r) for r in rallies],
               swings={f"P{w}": dict(Forehand=[c for x, c in swing_at.values() if x == w].count("Forehand"),
                                     Backhand=[c for x, c in swing_at.values() if x == w].count("Backhand"))
                       for w in (1, 2)},
               stroke_kmh_median={f"P{w}": round(float(np.median(st[w])), 1) if st[w] else None
                                  for w in (1, 2)},
               player_speed_kmh=dict(P1=round(float(sp1.mean()), 1), P2=round(float(sp2.mean()), 1)),
               shot_detail=shots),
          open(f"{OUT}/stats.json", "w"), indent=2)
print(f"{OUT}/overlay_v4.mp4, {OUT}/stats.json", flush=True)
