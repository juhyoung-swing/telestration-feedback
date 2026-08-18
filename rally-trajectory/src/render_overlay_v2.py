"""오버레이 v2 — 랠리 수 / 샷 카운트 / 포핸드·백핸드 / 바운스 추정 추가.

2패스 구조 (1분치 프레임을 메모리에 들면 21GB라 분리):
  PASS 1  검출만. 공은 60fps 전부, 선수·자세는 30fps.
  PASS 2  영상을 다시 읽으며 렌더링.

  python render_overlay_v2.py <시작초> <길이초>
"""
import sys, json, os
import cv2
import numpy as np
import torch, torchvision
from torchvision import transforms
from ultralytics import YOLO

VIDEO = "input/match_amateur.mp4"
OUT = "output/demo_1min"
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 33.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
BALL_CONF, IMGSZ = 0.10, 1280
RSTRIDE = 2                      # 렌더링/선수검출 간격 (출력 30fps)
os.makedirs(OUT, exist_ok=True)

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([
    [0, 0], [WD, 0], [0, L], [WD, L],
    [INSET, 0], [INSET, L], [WD-INSET, 0], [WD-INSET, L],
    [INSET, NET-SVC], [WD-INSET, NET-SVC],
    [INSET, NET+SVC], [WD-INSET, NET+SVC],
    [WD/2, NET-SVC], [WD/2, NET+SVC]])

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
NF = int(DUR * fps)
dt = 1.0 / fps

# ---------- 코트 (카메라 고정, 1회) ----------
court = torchvision.models.resnet50()
court.fc = torch.nn.Linear(court.fc.in_features, 28)
court.load_state_dict(torch.load("models/keypoints_model.pth", map_location="cpu"))
court.eval()
tf = transforms.Compose([transforms.ToPILImage(), transforms.Resize((224, 224)),
                         transforms.ToTensor(),
                         transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps)); _, first = cap.read()
with torch.no_grad():
    kp = court(tf(cv2.cvtColor(first, cv2.COLOR_BGR2RGB)).unsqueeze(0))[0].numpy()
KP = (kp.reshape(14, 2) * [W/224.0, H/224.0]).astype(np.float32)
Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
rerr = np.abs(cv2.perspectiveTransform(KP.reshape(-1,1,2), Hm).reshape(-1,2) - WORLD).mean()
print(f"[court] 재투영 오차 {rerr:.3f}m")
to_court = lambda p: cv2.perspectiveTransform(np.float32([[p]]), Hm).reshape(2)

# ---------- PASS 1 : 검출 ----------
ball_model = YOLO("models/yolo5_last.pt")
person_model = YOLO("yolov8n.pt")
pose_model = YOLO("yolov8n-pose.pt")

ball_dets, persons, poses = {}, {}, {}
cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
for i in range(NF):
    ok, f = cap.read()
    if not ok:
        NF = i; break
    b = ball_model.predict(f, device="mps", imgsz=IMGSZ, conf=BALL_CONF, verbose=False)[0].boxes
    ball_dets[i] = [((float(b.xyxy[k][0])+float(b.xyxy[k][2]))/2,
                     (float(b.xyxy[k][1])+float(b.xyxy[k][3]))/2,
                     float(b.conf[k])) for k in range(len(b))]
    if i % RSTRIDE == 0:
        p = person_model.predict(f, device="mps", imgsz=960, conf=0.35,
                                 classes=[0], verbose=False)[0].boxes
        pl = []
        for k in range(len(p)):
            x1, y1, x2, y2 = p.xyxy[k].tolist()
            wx, wy = to_court(((x1+x2)/2, y2))
            if -2 < wx < WD+2 and -2 < wy < L+2:
                pl.append(dict(box=(x1, y1, x2, y2), world=(float(wx), float(wy))))
        persons[i] = pl
        r = pose_model.predict(f, device="mps", imgsz=960, conf=0.35, verbose=False)[0]
        poses[i] = r.keypoints.xy.cpu().numpy() if r.keypoints is not None else np.empty((0, 17, 2))
    if i % 300 == 0:
        print(f"[pass1] {i}/{NF}", flush=True)
print(f"[pass1] 완료 {NF}프레임")

# ---------- 공 트랙: 정적 오탐 제거 + 연속성 + 보간 ----------
allp = np.array([[c[0], c[1]] for fr in ball_dets.values() for c in fr])
static = np.array([p for p in allp
                   if (np.abs(allp-p).max(axis=1) < 10).sum() >= NF*0.15]) if len(allp) else np.empty((0,2))
print(f"[ball] 정적 오탐 {len(static)}건 제외")

xs = np.full(NF, np.nan); ys = np.full(NF, np.nan)
prev = None
for i in range(NF):
    cand = [c for c in ball_dets.get(i, [])
            if not (len(static) and (np.abs(static-[c[0],c[1]]).max(axis=1) < 10).any())]
    if not cand:
        prev = None; continue
    if prev is not None:      # 직전 위치에 가까운 것 우선 (연속성)
        cand.sort(key=lambda c: np.hypot(c[0]-prev[0], c[1]-prev[1]) - c[2]*200)
    else:
        cand.sort(key=lambda c: -c[2])
    xs[i], ys[i] = cand[0][0], cand[0][1]
    prev = (xs[i], ys[i])
good = ~np.isnan(xs)
print(f"[ball] 검출 {good.sum()}/{NF} ({good.mean()*100:.0f}%)")
idx = np.arange(NF)
xs = np.interp(idx, idx[good], xs[good]); ys = np.interp(idx, idx[good], ys[good])
sm = lambda a, k: np.convolve(a, np.ones(k)/k, mode="same")
xs_s, ys_s = sm(xs, 5), sm(ys, 5)

# ---------- 샷: 궤적 반전 + 오디오 교차검증 ----------
dy = np.gradient(ys_s)
rev = [i for i in range(3, NF-3)
       if np.sign(dy[i-3:i].mean()) != np.sign(dy[i+1:i+4].mean())
       and abs(dy[i-3:i].mean()) > 1.0 and abs(dy[i+1:i+4].mean()) > 1.0]
merged = []
for i in rev:                       # 0.25초 내 중복 제거
    if not merged or (i - merged[-1]) * dt > 0.25:
        merged.append(i)
rev = merged

audio = [h["t"] for h in json.load(open("output/trackB_hits.json"))
         if T0 <= h["t"] <= T0+DUR]
conf_shots = [i for i in rev if any(abs((T0+i*dt) - a) < 0.20 for a in audio)]
print(f"[shot] 궤적반전 {len(rev)} / 오디오 {len(audio)} / 교차확인 {len(conf_shots)}")

# ---------- 랠리: 샷 묶음 (간격 4초 이상이면 새 랠리) ----------
rallies = []
for i in rev:
    if rallies and (i - rallies[-1][-1]) * dt < 4.0:
        rallies[-1].append(i)
    else:
        rallies.append([i])
rallies = [r for r in rallies if len(r) >= 2]
print(f"[rally] {len(rallies)}개")

# ---------- 포핸드/백핸드 (근거리 선수, 오른손잡이 가정) ----------
def near_pose(i):
    """근거리(화면 아래쪽) 사람의 COCO 키포인트."""
    pi = i - (i % RSTRIDE)
    ks = poses.get(pi)
    if ks is None or len(ks) == 0:
        return None
    return max(ks, key=lambda k: k[:, 1].max())

swings = {}
for i in rev:
    k = near_pose(i)
    if k is None or k[10][0] == 0:
        continue
    body = np.mean([k[5][0], k[6][0], k[11][0], k[12][0]])   # 어깨·엉덩이 중앙
    if k[16][1] < H*0.55:        # 발이 화면 위쪽이면 건너편 선수 -> 판정 안 함
        continue
    swings[i] = "Forehand" if k[10][0] > body else "Backhand"
print(f"[swing] 판정 {len(swings)}건 "
      f"(FH {sum(v=='Forehand' for v in swings.values())} / "
      f"BH {sum(v=='Backhand' for v in swings.values())})")

# ---------- 바운스: 궤적 반전 중 타격음 없는 것 ----------
bounces = []
for i in rev:
    if any(abs((T0+i*dt) - a) < 0.20 for a in audio):
        continue                                   # 타격음 있으면 샷
    wx, wy = to_court((xs_s[i], ys_s[i]))
    spd = np.hypot(*(to_court((xs_s[i], ys_s[i])) - to_court((xs_s[i-1], ys_s[i-1])))) / dt
    err = max(spd * dt, 0.15)                      # 1프레임 이동거리 = 위치 불확실성
    inside = (INSET-err < wx < WD-INSET+err) and (-err < wy < L+err)
    clear = (INSET+err < wx < WD-INSET-err) and (err < wy < L-err)
    bounces.append(dict(i=i, world=(float(wx), float(wy)), err=float(err),
                        call="IN" if clear else ("OUT" if not inside else "UNCERTAIN")))
print(f"[bounce] {len(bounces)}건 "
      f"(IN {sum(b['call']=='IN' for b in bounces)} / "
      f"OUT {sum(b['call']=='OUT' for b in bounces)} / "
      f"판정불가 {sum(b['call']=='UNCERTAIN' for b in bounces)})")

# ---------- PASS 2 : 렌더링 ----------
MW, MH, MX, MY = 210, 440, W-260, 60
mini = lambda p: (int(MX + p[0]*MW/WD), int(MY + p[1]*MH/L))
LINES = [(0,1),(1,3),(3,2),(2,0),(4,5),(6,7),(8,9),(10,11),(12,13)]

cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0*fps))
vw = cv2.VideoWriter(f"{OUT}/overlay_1min.mp4", cv2.VideoWriter_fourcc(*"mp4v"),
                     fps/RSTRIDE, (W, H))
last_swing, last_bounce = "-", None
for i in range(NF):
    ok, v = cap.read()
    if not ok:
        break
    if i % RSTRIDE:
        continue
    if i in swings:
        last_swing = swings[i]
    for b in bounces:
        if b["i"] == i:
            last_bounce = b

    for j, (x, y) in enumerate(KP):
        cv2.circle(v, (int(x), int(y)), 8, (0,0,255), -1)
        cv2.circle(v, (int(x), int(y)), 24, (0,0,255), 2)
        cv2.putText(v, str(j), (int(x)-8, int(y)+6), cv2.FONT_HERSHEY_SIMPLEX, .55, (255,255,255), 2)
    pl = persons.get(i, [])
    for q in pl:
        who = 1 if q["world"][1] > NET else 2
        x1, y1, x2, y2 = map(int, q["box"])
        cv2.rectangle(v, (x1, y1), (x2, y2), (0,0,255), 3)
        cv2.putText(v, f"Player ID: {who}", (x1, y1-12), cv2.FONT_HERSHEY_SIMPLEX, .9, (0,0,255), 2)
    bx, by = int(xs_s[i]), int(ys_s[i])
    cv2.rectangle(v, (bx-12, by-12), (bx+12, by+12), (0,255,255), 3)
    cv2.putText(v, "Ball ID: 1", (bx-40, by-22), cv2.FONT_HERSHEY_SIMPLEX, .85, (0,255,255), 2)

    ov = v.copy()                                            # 미니코트
    cv2.rectangle(ov, (MX-18, MY-18), (MX+MW+18, MY+MH+18), (255,255,255), -1)
    cv2.addWeighted(ov, .55, v, .45, 0, v)
    for a, b_ in LINES:
        cv2.line(v, mini(WORLD[a]), mini(WORLD[b_]), (0,0,0), 2)
    cv2.line(v, mini([0, NET]), mini([WD, NET]), (255,0,0), 2)
    for q in pl:
        cv2.circle(v, mini(q["world"]), 6, (0,150,0), -1)
    cv2.circle(v, mini(to_court((xs_s[i], ys_s[i]))), 5, (0,255,255), -1)
    if last_bounce:
        c = {"IN": (0,180,0), "OUT": (0,0,220), "UNCERTAIN": (0,140,220)}[last_bounce["call"]]
        cv2.circle(v, mini(last_bounce["world"]), 5, c, -1)
        cv2.circle(v, mini(last_bounce["world"]),
                   max(int(last_bounce["err"]*MW/WD), 4), c, 2)

    n_shot = sum(1 for s in rev if s <= i)
    n_rally = sum(1 for r in rallies if r[0] <= i)
    px, py = W-660, H-300                                    # 정보 패널
    ov = v.copy(); cv2.rectangle(ov, (px, py), (px+640, py+272), (35,35,35), -1)
    cv2.addWeighted(ov, .78, v, .22, 0, v)
    bcall = f'{last_bounce["call"]}  (+/-{last_bounce["err"]:.2f}m)' if last_bounce else "-"
    rows = [("Rally", f"{n_rally}"), ("Shot count", f"{n_shot}"),
            ("Audio hits", f"{sum(1 for a in audio if a <= T0+i*dt)}"),
            ("Last swing (P1)", last_swing), ("Last bounce", bcall)]
    for r, (a, b_) in enumerate(rows):
        yy = py + 46 + r*48
        cv2.putText(v, a, (px+18, yy), cv2.FONT_HERSHEY_SIMPLEX, .75, (200,200,200), 2)
        cv2.putText(v, b_, (px+330, yy), cv2.FONT_HERSHEY_SIMPLEX, .75, (255,255,255), 2)
    cv2.putText(v, f"Frame: {i}   t={T0+i*dt:.1f}s", (20, 46),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,255,0), 2)
    vw.write(v)
vw.release(); cap.release()

json.dump(dict(window=[T0, T0+DUR], frames=NF, reproj_err_m=round(float(rerr), 3),
               ball_detect_rate=round(float(good.mean()), 3),
               shots_trajectory=len(rev), shots_audio=len(audio),
               shots_confirmed=len(conf_shots), rallies=len(rallies),
               swings={k: v for k, v in
                       zip(("forehand", "backhand"),
                           (sum(v == "Forehand" for v in swings.values()),
                            sum(v == "Backhand" for v in swings.values())))},
               bounces=bounces),
          open(f"{OUT}/stats.json", "w"), indent=2)
print(f"{OUT}/overlay_1min.mp4, {OUT}/stats.json")
