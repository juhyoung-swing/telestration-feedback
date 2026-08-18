"""아무 영상에나 같은 파이프라인을 거는 범용 버전 (v4 로직 + 오디오 자동 추출).

  python render_any.py <영상경로> <시작초> <길이초> [--rerun]

화각이 다른 영상에서 코트 키포인트/호모그래피가 버티는지 보는 게 주 목적이라,
진단 지표(키포인트 프레임 내 개수, 재투영 오차, 코트 세로 픽셀)를 함께 출력한다.
"""
import sys, json, os, pickle, subprocess, hashlib
import cv2
import numpy as np
import torch, torchvision
from torchvision import transforms
from ultralytics import YOLO
import librosa

args = [a for a in sys.argv[1:] if not a.startswith("--")]
VIDEO = args[0]
T0 = float(args[1]) if len(args) > 1 else 35.0
DUR = float(args[2]) if len(args) > 2 else 10.0
RERUN = "--rerun" in sys.argv
TAG = os.path.splitext(os.path.basename(VIDEO))[0]
SZ = "x" if "--big" in sys.argv else "n"      # 선수·자세 모델 크기 (n=3.3M, x=69M)
OUT = f"output/multi/{TAG}"
os.makedirs(OUT, exist_ok=True)
STRIDE, BALL_CONF, IMGSZ = 2, 0.05, 1280
RALLY_GAP, PERSON_H = 4.0, 1.75
CACHE = f"{OUT}/det_{int(T0)}_{int(DUR)}_{SZ}.pkl"

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
cap.release()
NF = int(DUR*fps/STRIDE); dt = STRIDE/fps
print(f"=== {TAG}  {W}x{H} @{fps:.1f}fps  구간 {T0}~{T0+DUR}초", flush=True)

# ---------- 코트 키포인트 ----------
cm = torchvision.models.resnet50()
cm.fc = torch.nn.Linear(cm.fc.in_features, 28)
cm.load_state_dict(torch.load("models/keypoints_model.pth", map_location="cpu"))
cm.eval()
tfm = transforms.Compose([transforms.ToPILImage(), transforms.Resize((224,224)),
                          transforms.ToTensor(),
                          transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
c = cv2.VideoCapture(VIDEO); c.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
_, first = c.read(); c.release()
with torch.no_grad():
    o = cm(tfm(cv2.cvtColor(first, cv2.COLOR_BGR2RGB)).unsqueeze(0))[0].numpy()
KP = (o.reshape(14,2) * [W/224.0, H/224.0]).astype(np.float32)
# 사람이 보정한 좌표가 있으면 그걸 쓴다 (카메라 고정 전제, 1회 작업 후 영구 재사용)
KP_SRC = "모델 예측"
if os.path.exists(f"kp_{TAG}.json"):
    KP = np.float32(json.load(open(f"kp_{TAG}.json")))
    KP_SRC = f"수동 보정 (kp_{TAG}.json)"
inside = int(((KP[:,0] >= 0) & (KP[:,0] < W) & (KP[:,1] >= 0) & (KP[:,1] < H)).sum())
print(f"[court] 키포인트 출처: {KP_SRC}", flush=True)
Hm, mask = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
rerr = float(np.abs(cv2.perspectiveTransform(KP.reshape(-1,1,2), Hm).reshape(-1,2)-WORLD).mean()) \
    if Hm is not None else float("nan")
court_px = float(KP[:,1].max() - KP[:,1].min())
print(f"[court] 프레임 안 키포인트 {inside}/14 | 재투영 오차 {rerr:.3f}m | "
      f"코트 세로 {court_px:.0f}px ({court_px/H*100:.0f}% of frame)", flush=True)
vis = first.copy()
for j, (x, y) in enumerate(KP):
    cv2.circle(vis, (int(x), int(y)), 9, (0,0,255), -1)
    cv2.putText(vis, str(j), (int(x)+10, int(y)-10), cv2.FONT_HERSHEY_SIMPLEX, .8, (0,0,255), 2)
cv2.imwrite(f"{OUT}/court_check.jpg", vis)
to_court = lambda p: cv2.perspectiveTransform(np.float32([[p]]), Hm).reshape(2)

# ---------- 오디오 타격음 (구간만) ----------
wav = f"{OUT}/audio.wav"
subprocess.run(["ffmpeg","-v","error","-ss",str(T0),"-t",str(DUR),"-i",VIDEO,
                "-ac","1","-ar","22050",wav,"-y"], check=True)
y, sr = librosa.load(wav, sr=22050)
S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=512,
                                   fmin=2000, fmax=8000, n_mels=64)
env = librosa.onset.onset_strength(S=librosa.power_to_db(S, ref=np.max), sr=sr)
env = env / (env.max() + 1e-9)
audio = [T0 + t for t in librosa.onset.onset_detect(onset_envelope=env, sr=sr,
                                                    units="time", delta=0.28, wait=8)]
print(f"[audio] 타격음 {len(audio)}개 ({len(audio)/DUR*60:.0f}/분)", flush=True)

# ---------- 검출 ----------
def detect():
    bm = YOLO("models/yolo5_last.pt")
    pm = YOLO(f"yolov8{SZ}.pt"); qm = YOLO(f"yolov8{SZ}-pose.pt")
    print(f"[model] 선수 yolov8{SZ} / 자세 yolov8{SZ}-pose "
          f"({sum(p.numel() for p in qm.model.parameters())/1e6:.1f}M)", flush=True)
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
            b = bm.predict(f, device="mps", imgsz=IMGSZ, conf=BALL_CONF,
                           augment=True, verbose=False)[0].boxes
            ball.append([((float(b.xyxy[k][0])+float(b.xyxy[k][2]))/2,
                          (float(b.xyxy[k][1])+float(b.xyxy[k][3]))/2,
                          float(b.conf[k])) for k in range(len(b))])
            p = pm.predict(f, device="mps", imgsz=960, conf=.35, classes=[0],
                           verbose=False)[0].boxes
            cand = []
            for k in range(len(p)):
                x1, y1, x2, y2 = p.xyxy[k].tolist()
                # 발이 화면 아래로 잘린 경우도 살린다 (근거리 선수가 사라지던 원인)
                foot_y = min(y2, H-1)
                wx, wy = to_court(((x1+x2)/2, foot_y))
                cut = y2 >= H-3
                if (-3 < wx < WD+3 and -3 < wy < L+3) or cut:
                    cand.append(dict(box=(x1,y1,x2,y2), world=(float(wx), float(wy)), cut=bool(cut)))
            near = max((q for q in cand if q["world"][1] > NET or q["cut"]),
                       key=lambda q: q["box"][3], default=None)
            far = min((q for q in cand if q["world"][1] <= NET and not q["cut"]),
                      key=lambda q: q["box"][3], default=None)
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
                r = qm.predict(crop, device="mps", imgsz=640, conf=.25, verbose=False)[0]
                sw.append(None if (r.keypoints is None or len(r.keypoints.xy) == 0)
                          else max(r.keypoints.xy.cpu().numpy(),
                                   key=lambda a: (a[:,1].max()-a[:,1].min())))
            poses.append(sw)
        n += 1
    c.release()
    return dict(ball=ball, persons=persons, poses=poses)


if os.path.exists(CACHE) and not RERUN:
    D = pickle.load(open(CACHE, "rb")); print("[cache] 재사용", flush=True)
else:
    D = detect(); pickle.dump(D, open(CACHE, "wb"))
ball_raw, persons, poses = D["ball"], D["persons"], D["poses"]
NF = len(ball_raw)

# ---------- 공 트랙 ----------
allp = np.array([[k[0], k[1]] for fr in ball_raw for k in fr]) if any(ball_raw) else np.empty((0,2))
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
    cand = [k for k in fr
            if not (len(static) and (np.abs(static-[k[0],k[1]]).max(axis=1) < 10).any())]
    pred = kf.predict() if init else None
    pick = None
    if cand:
        if pred is not None:
            nc = [k for k in cand if np.hypot(k[0]-pred[0,0], k[1]-pred[1,0]) < 260]
            cand = nc or cand
            pick = min(cand, key=lambda k: np.hypot(k[0]-pred[0,0], k[1]-pred[1,0]) - k[2]*150)
        else:
            pick = max(cand, key=lambda k: k[2])
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
bw = np.array([to_court((x, y)) for x, y in zip(bx, by)])   # 미니코트용 공 좌표
n_p1 = sum(1 for a, b in persons if a); n_p2 = sum(1 for a, b in persons if b)
print(f"[player] P1 {n_p1/NF*100:.0f}% / P2 {n_p2/NF*100:.0f}%", flush=True)

box_dist = lambda pt, bb: np.hypot(max(bb[0]-pt[0], 0, pt[0]-bb[2]), max(bb[1]-pt[1], 0, pt[1]-bb[3]))

# ---------- 샷 · 랠리 · 귀속 ----------
shots = []
for t in audio:
    i = int(round((t-T0)/dt))
    if not 0 <= i < NF:
        continue
    p1, p2 = persons[i]
    shots.append(dict(t=round(t, 2), i=i, who=None,
                      d1=None if not p1 else round(float(box_dist((bx[i],by[i]), p1["box"])), 1),
                      d2=None if not p2 else round(float(box_dist((bx[i],by[i]), p2["box"])), 1)))
rallies = []
for s in shots:
    if rallies and s["t"] - rallies[-1][-1]["t"] < RALLY_GAP:
        rallies[-1].append(s)
    else:
        rallies.append([s])


def evidence(s):
    d1, d2 = s["d1"], s["d2"]
    if d1 is None and d2 is None:
        return None, 0.0
    if d1 is None:
        return (2, 0.3 if d2 < 120 else 0.0)
    if d2 is None:
        return (1, 0.3 if d1 < 120 else 0.0)
    who, dn, df = (1, d1, d2) if d1 <= d2 else (2, d2, d1)
    conf = 1.0 if dn <= 5 else (0.7 if (dn < 120 and df > dn*3) else (0.4 if df > dn*2 else 0.0))
    return who, conf


for r in rallies:
    ev = [evidence(s) for s in r]
    best = max(range(len(r)), key=lambda k: ev[k][1])
    if ev[best][1] <= 0.0:
        for s, (w, _) in zip(r, ev):
            s["who"] = w or 1
    else:
        for k in range(len(r)):
            r[k]["who"] = ev[best][0] if (k-best) % 2 == 0 else 3-ev[best][0]
for s in shots:
    if s["who"] is None:
        s["who"] = evidence(s)[0] or 1
    q = persons[s["i"]][s["who"]-1] or persons[s["i"]][0] or persons[s["i"]][1]
    if q is None:
        s["speed"] = 0.0; continue
    ppm = (q["box"][3]-q["box"][1]) / PERSON_H
    j = min(s["i"] + int(round(0.30/dt)), NF-1)
    step = [np.hypot(bx[k+1]-bx[k], by[k+1]-by[k])/ppm/dt*3.6 for k in range(s["i"], j)]
    s["speed"] = round(min(float(np.median(step)) if step else 0.0, 200.0), 1)
rallies = [r for r in rallies if len(r) >= 2]
print(f"[shot] {len(shots)}개 (P1 {sum(s['who']==1 for s in shots)} / "
      f"P2 {sum(s['who']==2 for s in shots)}) | 랠리 {len(rallies)}개", flush=True)


def classify(ks, who):
    if ks is None or ks[10][0] == 0:
        return None
    pts = [ks[j][0] for j in (5,6,11,12) if ks[j][0] > 0]
    if len(pts) < 2:
        return None
    right = ks[10][0] > float(np.mean(pts))
    return "Forehand" if (right if who == 1 else not right) else "Backhand"


swing_at = {}
for s in shots:
    cl = classify(poses[s["i"]][s["who"]-1], s["who"])
    if cl:
        swing_at[s["i"]] = (s["who"], cl)
print(f"[swing] {len(swing_at)}/{len(shots)}건", flush=True)

# ---------- 렌더 ----------
MW, MH, MX, MY = 210, 440, W-260, 60
mini = lambda p: (int(MX + p[0]*MW/WD), int(MY + p[1]*MH/L))
LINES = [(0,1),(1,3),(3,2),(2,0),(4,5),(6,7),(8,9),(10,11),(12,13)]
cap = cv2.VideoCapture(VIDEO); cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
vw = cv2.VideoWriter(f"{OUT}/overlay.mp4", cv2.VideoWriter_fourcc(*"mp4v"), 1/dt, (W, H))
last_sw = {1:"-", 2:"-"}; last_st = {1:0.0, 2:0.0}
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
    ov = v.copy(); cv2.rectangle(ov, (MX-18,MY-18), (MX+MW+18,MY+MH+18), (255,255,255), -1)
    cv2.addWeighted(ov, .55, v, .45, 0, v)
    for a, b_ in LINES:
        cv2.line(v, mini(WORLD[a]), mini(WORLD[b_]), (0,0,0), 2)
    cv2.line(v, mini([0,NET]), mini([WD,NET]), (255,0,0), 2)
    for q in persons[i]:
        if q:
            cv2.circle(v, mini(q["world"]), 6, (0,150,0), -1)
    bmp = mini(bw[i])                                  # 공 (미니코트)
    if -40 < bmp[0]-MX < MW+40 and -40 < bmp[1]-MY < MH+40:
        cv2.circle(v, bmp, 5, (0,255,255) if seen[i] else (150,150,150), -1)
    n_r = sum(1 for r in rallies if r[0]["i"] <= i)
    n1 = sum(1 for s in shots if s["i"] <= i and s["who"] == 1)
    n2 = sum(1 for s in shots if s["i"] <= i and s["who"] == 2)
    px, py = W-700, H-280
    ov = v.copy(); cv2.rectangle(ov, (px,py), (px+680, py+250), (35,35,35), -1)
    cv2.addWeighted(ov, .78, v, .22, 0, v)
    rows = [("", "Player 1", "Player 2"), ("Rally", f"{n_r}", ""),
            ("Shots", f"{n1}", f"{n2}"),
            ("Stroke (approx)", f"~{last_st[1]:.0f} km/h", f"~{last_st[2]:.0f} km/h")]
    for r, (a, b_, c_) in enumerate(rows):
        yy = py + 44 + r*46
        cv2.putText(v, a, (px+18, yy), cv2.FONT_HERSHEY_SIMPLEX, .72, (200,200,200), 2)
        cv2.putText(v, b_, (px+330, yy), cv2.FONT_HERSHEY_SIMPLEX, .72, (255,255,255), 2)
        cv2.putText(v, c_, (px+510, yy), cv2.FONT_HERSHEY_SIMPLEX, .72, (255,255,255), 2)
    cv2.putText(v, f"{TAG}  t={T0+i*dt:.1f}s", (20, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,255,0), 2)
    vw.write(v)
vw.release(); cap.release()

json.dump(dict(video=VIDEO, window=[T0, T0+DUR], frames=NF,
               kp_inside=inside, reproj_err_m=round(rerr, 3), court_px=round(court_px),
               ball_rate=round(float(seen.mean()), 3),
               p1_rate=round(n_p1/NF, 3), p2_rate=round(n_p2/NF, 3),
               audio_hits=len(audio), shots=len(shots), rallies=len(rallies),
               swing_judged=len(swing_at)),
          open(f"{OUT}/stats.json", "w"), indent=2)
print(f"{OUT}/overlay.mp4  ({OUT}/court_check.jpg)", flush=True)
