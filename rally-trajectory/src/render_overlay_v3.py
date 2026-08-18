"""오버레이 v3 — 랠리 수 / P1·P2 스트로크 속도 / P1·P2 마지막 스윙.

v2에서 바뀐 것:
  - 샷을 궤적 반전이 아니라 '타격음'으로 정의 (v2는 3배 부풀었음)
  - 샷마다 P1/P2 귀속 (v2엔 주인 개념이 아예 없었음)
  - 공 검출에 TTA 적용 (실측 42% -> 50%)
  - 칼만 필터로 궤적 안정화
  - 선수 크롭 확대 후 자세 추정, P2는 좌우 반전
  - 속도 복구, 바운스/인아웃 제거

  python render_overlay_v3.py <시작초> <길이초>
"""
import sys, json, os
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
OUT = "output/demo_v3"
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 33.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
STRIDE = 2                      # 30fps 처리·출력
BALL_CONF, IMGSZ = 0.05, 1280
RALLY_GAP = 4.0                 # 이보다 길게 조용하면 새 랠리
os.makedirs(OUT, exist_ok=True)

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
NF = int(DUR*fps/STRIDE)
dt = STRIDE/fps

# ---------- 코트 (카메라 고정, 1회) ----------
court = torchvision.models.resnet50()
court.fc = torch.nn.Linear(court.fc.in_features, 28)
court.load_state_dict(torch.load("models/keypoints_model.pth", map_location="cpu"))
court.eval()
tfm = transforms.Compose([transforms.ToPILImage(), transforms.Resize((224,224)),
                          transforms.ToTensor(),
                          transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps)); _, first = cap.read()
with torch.no_grad():
    kk = court(tfm(cv2.cvtColor(first, cv2.COLOR_BGR2RGB)).unsqueeze(0))[0].numpy()
KP = (kk.reshape(14,2) * [W/224.0, H/224.0]).astype(np.float32)
Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
rerr = float(np.abs(cv2.perspectiveTransform(KP.reshape(-1,1,2), Hm).reshape(-1,2)-WORLD).mean())
print(f"[court] 재투영 오차 {rerr:.3f}m", flush=True)
to_court = lambda p: cv2.perspectiveTransform(np.float32([[p]]), Hm).reshape(2)

# ---------- PASS 1 : 검출 ----------
ball_model = YOLO("models/yolo5_last.pt")
person_model = YOLO("yolov8n.pt")
pose_model = YOLO("yolov8n-pose.pt")

ball_raw, persons, pose_by_player = [], [], []
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
n = 0
while len(ball_raw) < NF:
    ok = cap.grab()
    if not ok:
        break
    if n % STRIDE == 0:
        ok, f = cap.retrieve()
        if not ok:
            break
        b = ball_model.predict(f, device="mps", imgsz=IMGSZ, conf=BALL_CONF,
                               augment=True, verbose=False)[0].boxes      # TTA
        ball_raw.append([((float(b.xyxy[k][0])+float(b.xyxy[k][2]))/2,
                          (float(b.xyxy[k][1])+float(b.xyxy[k][3]))/2,
                          float(b.conf[k])) for k in range(len(b))])

        p = person_model.predict(f, device="mps", imgsz=960, conf=.35,
                                 classes=[0], verbose=False)[0].boxes
        cands = []
        for k in range(len(p)):
            x1, y1, x2, y2 = p.xyxy[k].tolist()
            wx, wy = to_court(((x1+x2)/2, y2))
            if -2 < wx < WD+2 and -2 < wy < L+2:
                cands.append(dict(box=(x1,y1,x2,y2), world=(float(wx), float(wy))))
        near = max((q for q in cands if q["world"][1] > NET), key=lambda q: q["world"][1], default=None)
        far = min((q for q in cands if q["world"][1] <= NET), key=lambda q: q["world"][1], default=None)
        persons.append((near, far))

        # 선수 상자를 잘라 확대한 뒤 자세 추정 (P2는 화면에서 작아 그냥은 안 잡힘)
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
            ks = max(r.keypoints.xy.cpu().numpy(), key=lambda a: (a[:,1].max()-a[:,1].min()))
            sw.append(ks)
        pose_by_player.append(sw)
    n += 1
    if len(ball_raw) % 200 == 0 and n % STRIDE == 0:
        print(f"[pass1] {len(ball_raw)}/{NF}", flush=True)
cap.release()
NF = len(ball_raw)
print(f"[pass1] 완료 {NF}프레임", flush=True)

# ---------- 공: 정적 오탐 제거 + 칼만 추적 ----------
allp = np.array([[c[0], c[1]] for fr in ball_raw for c in fr]) if any(ball_raw) else np.empty((0,2))
static = np.array([p for p in allp if (np.abs(allp-p).max(axis=1) < 10).sum() >= NF*0.15]) \
    if len(allp) else np.empty((0,2))

kf = cv2.KalmanFilter(4, 2)
kf.transitionMatrix = np.array([[1,0,1,0],[0,1,0,1],[0,0,1,0],[0,0,0,1]], np.float32)
kf.measurementMatrix = np.eye(2, 4, dtype=np.float32)
kf.processNoiseCov = np.eye(4, dtype=np.float32) * 3.0
kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 12.0

bx, by, seen = np.zeros(NF), np.zeros(NF), np.zeros(NF, bool)
init = False
for i, fr in enumerate(ball_raw):
    cand = [c for c in fr
            if not (len(static) and (np.abs(static-[c[0],c[1]]).max(axis=1) < 10).any())]
    pred = kf.predict() if init else None
    pick = None
    if cand:
        if pred is not None:
            near_c = [c for c in cand if np.hypot(c[0]-pred[0,0], c[1]-pred[1,0]) < 260]
            cand = near_c or cand
            pick = min(cand, key=lambda c: np.hypot(c[0]-pred[0,0], c[1]-pred[1,0]) - c[2]*150)
        else:
            pick = max(cand, key=lambda c: c[2])
    if pick:
        m = np.float32([[pick[0]], [pick[1]]])
        if not init:
            kf.statePost = np.float32([[pick[0]], [pick[1]], [0], [0]]); init = True
        else:
            kf.correct(m)
        bx[i], by[i], seen[i] = pick[0], pick[1], True
    elif init:
        bx[i], by[i] = float(pred[0,0]), float(pred[1,0])
    elif i:
        bx[i], by[i] = bx[i-1], by[i-1]
print(f"[ball] 검출 {seen.sum()}/{NF} ({seen.mean()*100:.0f}%) — TTA 적용", flush=True)
bw = np.array([to_court((x, y)) for x, y in zip(bx, by)])

# ---------- 샷: 타격음 기준 + P1/P2 귀속 ----------
audio = sorted(h["t"] for h in json.load(open("output/trackB_hits.json"))
               if T0 <= h["t"] <= T0+DUR)
shots = []
for t in audio:
    i = int(round((t-T0)/dt))
    if not 0 <= i < NF:
        continue
    who = 1 if bw[i][1] > NET else 2          # 타격 순간 공이 있던 쪽이 친 사람
    j = min(i + int(round(0.30/dt)), NF-1)    # 직후 0.3초 이동거리로 속도
    if j > i:
        step = [np.hypot(*(bw[k+1]-bw[k]))/dt*3.6 for k in range(i, j)]
        spd = float(np.median(step)) if step else 0.0
    else:
        spd = 0.0
    shots.append(dict(t=t, i=i, who=who, speed=min(spd, 250.0)))
print(f"[shot] {len(shots)}개 (P1 {sum(s['who']==1 for s in shots)} / "
      f"P2 {sum(s['who']==2 for s in shots)})", flush=True)

rallies = []
for s in shots:
    if rallies and s["t"] - rallies[-1][-1]["t"] < RALLY_GAP:
        rallies[-1].append(s)
    else:
        rallies.append([s])
rallies = [r for r in rallies if len(r) >= 2]
print(f"[rally] {len(rallies)}개 (샷 {[len(r) for r in rallies]})", flush=True)

# ---------- 스윙: 타격 시점에만, P2는 좌우 반전 ----------
# COCO: 5/6 어깨, 10 오른손목, 11/12 엉덩이
def classify(ks, who):
    if ks is None or ks[10][0] == 0:
        return None
    pts = [ks[j][0] for j in (5, 6, 11, 12) if ks[j][0] > 0]
    if len(pts) < 2:
        return None
    body = float(np.mean(pts))
    right_of_body = ks[10][0] > body
    # P1은 카메라를 등지고, P2는 마주 본다 -> P2는 좌우가 뒤집힌다
    fore = right_of_body if who == 1 else (not right_of_body)
    return "Forehand" if fore else "Backhand"


swing_at = {}
for s in shots:
    ks = pose_by_player[s["i"]][s["who"]-1]
    c = classify(ks, s["who"])
    if c:
        swing_at[s["i"]] = (s["who"], c)
print(f"[swing] 판정 {len(swing_at)}/{len(shots)}건", flush=True)

# ---------- 선수 이동 속도 ----------
def pspeed(which):
    out = np.zeros(NF)
    for i in range(1, NF):
        a, b_ = persons[i-1][which], persons[i][which]
        if a and b_:
            out[i] = min(np.hypot(*(np.array(b_["world"])-np.array(a["world"])))/dt*3.6, 40)
    return np.convolve(out, np.ones(5)/5, mode="same")


sp1, sp2 = pspeed(0), pspeed(1)

# ---------- PASS 2 : 렌더링 ----------
MW, MH, MX, MY = 210, 440, W-260, 60
mini = lambda p: (int(MX + p[0]*MW/WD), int(MY + p[1]*MH/L))
LINES = [(0,1),(1,3),(3,2),(2,0),(4,5),(6,7),(8,9),(10,11),(12,13)]

cap = cv2.VideoCapture(VIDEO)
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
vw = cv2.VideoWriter(f"{OUT}/overlay_v3.mp4", cv2.VideoWriter_fourcc(*"mp4v"),
                     1/dt, (W, H))
last_sw = {1: "-", 2: "-"}
last_st = {1: 0.0, 2: 0.0}
n = 0
for i in range(NF):
    for _ in range(STRIDE):
        ok, v = cap.read()
        if not ok:
            break
    if not ok:
        break
    if i in swing_at:
        who, c = swing_at[i]; last_sw[who] = c
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
            cv2.putText(v, f"Player ID: {w_}", (x1, y1-12),
                        cv2.FONT_HERSHEY_SIMPLEX, .9, (0,0,255), 2)
    col = (0,255,255) if seen[i] else (140,140,140)      # 회색 = 예측(미검출)
    cv2.rectangle(v, (int(bx[i])-12, int(by[i])-12), (int(bx[i])+12, int(by[i])+12), col, 3)
    cv2.putText(v, "Ball ID: 1", (int(bx[i])-40, int(by[i])-22),
                cv2.FONT_HERSHEY_SIMPLEX, .85, col, 2)

    ov = v.copy()
    cv2.rectangle(ov, (MX-18, MY-18), (MX+MW+18, MY+MH+18), (255,255,255), -1)
    cv2.addWeighted(ov, .55, v, .45, 0, v)
    for a, b_ in LINES:
        cv2.line(v, mini(WORLD[a]), mini(WORLD[b_]), (0,0,0), 2)
    cv2.line(v, mini([0, NET]), mini([WD, NET]), (255,0,0), 2)
    for q in persons[i]:
        if q:
            cv2.circle(v, mini(q["world"]), 6, (0,150,0), -1)
    cv2.circle(v, mini(bw[i]), 5, (0,255,255), -1)

    n_rally = sum(1 for r in rallies if r[0]["i"] <= i)
    n1 = sum(1 for s in shots if s["i"] <= i and s["who"] == 1)
    n2 = sum(1 for s in shots if s["i"] <= i and s["who"] == 2)
    px, py = W-700, H-330
    ov = v.copy(); cv2.rectangle(ov, (px,py), (px+680, py+300), (35,35,35), -1)
    cv2.addWeighted(ov, .78, v, .22, 0, v)
    rows = [("", "Player 1", "Player 2"),
            ("Rally", f"{n_rally}", ""),
            ("Shots", f"{n1}", f"{n2}"),
            ("Stroke speed", f"{last_st[1]:.0f} km/h", f"{last_st[2]:.0f} km/h"),
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
_h264(f"{OUT}/overlay_v3.mp4")

json.dump(dict(window=[T0, T0+DUR], frames=NF, reproj_err_m=round(rerr, 3),
               ball_detect_rate=round(float(seen.mean()), 3),
               shots=len(shots), shots_p1=sum(s["who"]==1 for s in shots),
               shots_p2=sum(s["who"]==2 for s in shots),
               rallies=len(rallies), rally_sizes=[len(r) for r in rallies],
               swing_judged=len(swing_at),
               swings={f"P{w}": {c: sum(1 for a, b_ in swing_at.values() if a==w and b_==c)
                                 for c in ("Forehand", "Backhand")} for w in (1, 2)},
               stroke_speed_kmh={f"P{w}": round(float(np.median(
                   [s["speed"] for s in shots if s["who"]==w] or [0])), 1) for w in (1, 2)},
               player_speed_kmh=dict(P1=round(float(sp1.mean()), 1),
                                     P2=round(float(sp2.mean()), 1))),
          open(f"{OUT}/stats.json", "w"), indent=2)
print(f"{OUT}/overlay_v3.mp4, {OUT}/stats.json", flush=True)
