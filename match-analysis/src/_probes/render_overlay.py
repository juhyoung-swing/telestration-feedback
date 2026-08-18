"""데모와 같은 오버레이 영상 생성 (코트 키포인트 + 공 + 선수 + 미니코트 + 속도).

SPEC §7 제약(공 속도 금지)을 사용자 지시로 해제하고 진행.
속도값은 노이즈가 있는 참고치다 — 근거는 리포트 참조.

  python render_overlay.py <시작초> <길이초>
"""
import sys, json
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
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 35.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
STRIDE = 2            # 2프레임당 1장 -> 출력 약 30fps
BALL_CONF = 0.10      # 오탐은 정적 필터로 거르므로 낮게 잡는다
IMGSZ = 1280          # MPS 상한

# 실제 코트 치수(m). 키포인트 14개의 세계 좌표.
L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC = (WD - WS) / 2, 6.40
NET = L / 2
WORLD = np.float32([
    [0, 0], [WD, 0], [0, L], [WD, L],                      # 0,1,2,3  더블스 코너
    [INSET, 0], [INSET, L], [WD-INSET, 0], [WD-INSET, L],  # 4,5,6,7  싱글스 코너
    [INSET, NET-SVC], [WD-INSET, NET-SVC],                 # 8,9      건너편 서비스라인
    [INSET, NET+SVC], [WD-INSET, NET+SVC],                 # 10,11    가까운 서비스라인
    [WD/2, NET-SVC], [WD/2, NET+SVC],                      # 12,13    서비스 중앙
])

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
dt = STRIDE / fps

# ---------- 1. 코트 키포인트 (카메라 고정이므로 1회만) ----------
court = torchvision.models.resnet50()
court.fc = torch.nn.Linear(court.fc.in_features, 28)
court.load_state_dict(torch.load("models/keypoints_model.pth", map_location="cpu"))
court.eval()
tf = transforms.Compose([
    transforms.ToPILImage(), transforms.Resize((224, 224)), transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])

cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0 * fps))
ok, first = cap.read()
with torch.no_grad():
    kp = court(tf(cv2.cvtColor(first, cv2.COLOR_BGR2RGB)).unsqueeze(0))[0].numpy()
KP = (kp.reshape(14, 2) * [W / 224.0, H / 224.0]).astype(np.float32)

Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)      # 화면 -> 코트(m)
err = np.abs(cv2.perspectiveTransform(KP.reshape(-1, 1, 2), Hm).reshape(-1, 2) - WORLD)
print(f"호모그래피 재투영 오차: 평균 {err.mean():.3f}m 최대 {err.max():.3f}m")


def to_court(pt):
    return cv2.perspectiveTransform(np.float32([[pt]]), Hm).reshape(2)


# ---------- 2. 프레임별 검출 ----------
ball_model = YOLO("models/yolo5_last.pt")
person_model = YOLO("yolov8n.pt")

cap.set(cv2.CAP_PROP_POS_FRAMES, int(T0 * fps))
frames, ball_raw, players = [], [], []
n = 0
while True:
    ok = cap.grab()
    if not ok or cap.get(cv2.CAP_PROP_POS_FRAMES) / fps > T0 + DUR:
        break
    if n % STRIDE == 0:
        ok, f = cap.retrieve()
        if ok:
            frames.append(f)
            b = ball_model.predict(f, device="mps", imgsz=IMGSZ,
                                   conf=BALL_CONF, verbose=False)[0].boxes
            cand = []
            for k in range(len(b)):
                x1, y1, x2, y2 = b.xyxy[k].tolist()
                cand.append(((x1+x2)/2, (y1+y2)/2, float(b.conf[k])))
            ball_raw.append(cand)

            p = person_model.predict(f, device="mps", imgsz=960, conf=0.35,
                                     classes=[0], verbose=False)[0].boxes
            ppl = []
            for k in range(len(p)):
                x1, y1, x2, y2 = p.xyxy[k].tolist()
                cx, cy = (x1+x2)/2, y2          # 발 위치
                wx, wy = to_court((cx, cy))
                # 코트 안(여유 2m)에 발이 있는 사람만 선수로 본다
                if -2 < wx < WD+2 and -2 < wy < L+2:
                    ppl.append(dict(box=(x1, y1, x2, y2), world=(float(wx), float(wy))))
            players.append(ppl)
    n += 1
cap.release()
N = len(frames)
print(f"{N}프레임 처리 ({T0}~{T0+DUR}초, {1/dt:.0f}fps 샘플)")

# ---------- 3. 공: 정적 오탐 제거 후 보간 ----------
allpts = np.array([[c[0], c[1]] for fr in ball_raw for c in fr]) if any(ball_raw) else np.empty((0, 2))
static = []
for p in allpts:
    if (np.abs(allpts - p).max(axis=1) < 10).sum() >= N * 0.2:   # 20% 이상 프레임에서 같은 자리
        static.append(p)
static = np.array(static) if static else np.empty((0, 2))
print(f"정적 오탐 위치 {len(np.unique(static.round(-1), axis=0)) if len(static) else 0}곳 제외")

track = []
for fr in ball_raw:
    best = None
    for cx, cy, cf in sorted(fr, key=lambda c: -c[2]):
        if len(static) and (np.abs(static - [cx, cy]).max(axis=1) < 10).any():
            continue
        best = (cx, cy, cf); break
    track.append(best)

xs = np.array([t[0] if t else np.nan for t in track])
ys = np.array([t[1] if t else np.nan for t in track])
idx = np.arange(N)
good = ~np.isnan(xs)
print(f"공 검출 {good.sum()}/{N} 프레임 ({good.mean()*100:.0f}%) — 나머지는 보간")
if good.sum() >= 2:
    xs = np.interp(idx, idx[good], xs[good])
    ys = np.interp(idx, idx[good], ys[good])

# ---------- 4. 선수 2명 확정 (근/원 코트) ----------
p1, p2 = [], []      # Player1 = 가까운 쪽, Player2 = 건너편
for ppl in players:
    near = max((q for q in ppl if q["world"][1] > NET), key=lambda q: q["world"][1], default=None)
    far = min((q for q in ppl if q["world"][1] <= NET), key=lambda q: q["world"][1], default=None)
    p1.append(near); p2.append(far)


def speed_series(seq):
    """코트 좌표 기준 이동속도(km/h). 3프레임 이동평균."""
    out = [0.0] * len(seq)
    for i in range(1, len(seq)):
        a, b = seq[i-1], seq[i]
        if a and b:
            d = np.hypot(*(np.array(b["world"]) - np.array(a["world"])))
            out[i] = min(d / dt * 3.6, 40)     # 사람 속도 상한
    k = np.ones(3) / 3
    return np.convolve(out, k, mode="same")


s1, s2 = speed_series(p1), speed_series(p2)

wb = np.array([to_court((x, y)) for x, y in zip(xs, ys)])
bspeed = np.zeros(N)
for i in range(1, N):
    bspeed[i] = np.hypot(*(wb[i] - wb[i-1])) / dt * 3.6
bspeed = np.convolve(bspeed, np.ones(5)/5, mode="same")

# ---------- 5. 렌더링 ----------
MW, MH, MX, MY = 210, 440, W - 260, 60      # 미니코트 위치/크기
sx, sy = MW / WD, MH / L


def mini(pt):
    return int(MX + pt[0]*sx), int(MY + pt[1]*sy)


writer = cv2.VideoWriter("output/overlay_demo.mp4",
                         cv2.VideoWriter_fourcc(*"mp4v"), 1/dt, (W, H))
for i, f in enumerate(frames):
    v = f.copy()
    for j, (x, y) in enumerate(KP):
        cv2.circle(v, (int(x), int(y)), 9, (0, 0, 255), -1)
        cv2.circle(v, (int(x), int(y)), 26, (0, 0, 255), 3)
        cv2.putText(v, str(j), (int(x)-8, int(y)+7), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, (255, 255, 255), 2)
    for who, seq, col in ((1, p1, (0, 0, 255)), (2, p2, (0, 0, 255))):
        q = seq[i]
        if q:
            x1, y1, x2, y2 = map(int, q["box"])
            cv2.rectangle(v, (x1, y1), (x2, y2), col, 3)
            cv2.putText(v, f"Player ID: {who}", (x1, y1-12),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, col, 2)
    bx, by = int(xs[i]), int(ys[i])
    cv2.rectangle(v, (bx-12, by-12), (bx+12, by+12), (0, 255, 255), 3)
    cv2.putText(v, "Ball ID: 1", (bx-40, by-22), cv2.FONT_HERSHEY_SIMPLEX,
                0.9, (0, 255, 255), 2)

    ov = v.copy()                                   # 미니코트
    cv2.rectangle(ov, (MX-18, MY-18), (MX+MW+18, MY+MH+18), (255, 255, 255), -1)
    cv2.addWeighted(ov, 0.55, v, 0.45, 0, v)
    for a, b in [(0, 1), (1, 3), (3, 2), (2, 0), (4, 5), (6, 7), (8, 9), (10, 11), (12, 13)]:
        cv2.line(v, mini(WORLD[a]), mini(WORLD[b]), (0, 0, 0), 2)
    cv2.line(v, mini([0, NET]), mini([WD, NET]), (255, 0, 0), 2)
    for q, c in ((p1[i], (0, 200, 0)), (p2[i], (0, 200, 0))):
        if q:
            cv2.circle(v, mini(q["world"]), 7, c, -1)
    cv2.circle(v, mini(wb[i]), 6, (0, 255, 255), -1)

    px, py = W - 620, H - 260                       # 속도표
    ov = v.copy()
    cv2.rectangle(ov, (px, py), (px+600, py+230), (40, 40, 40), -1)
    cv2.addWeighted(ov, 0.75, v, 0.25, 0, v)
    rows = [("", "Player 1", "Player 2"),
            ("Shot Speed", f"{bspeed[i]:.1f} km/h", ""),
            ("Player Speed", f"{s1[i]:.1f} km/h", f"{s2[i]:.1f} km/h"),
            ("avg. B. Speed", f"{bspeed[:i+1].mean():.1f} km/h", ""),
            ("avg. P. Speed", f"{s1[:i+1].mean():.1f} km/h", f"{s2[:i+1].mean():.1f} km/h")]
    for r, (a, b, c) in enumerate(rows):
        yy = py + 40 + r*42
        cv2.putText(v, a, (px+16, yy), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (220, 220, 220), 2)
        cv2.putText(v, b, (px+270, yy), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(v, c, (px+450, yy), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

    cv2.putText(v, f"Frame: {i}", (20, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 255, 0), 2)
    writer.write(v)
writer.release()
_h264("output/overlay_demo.mp4")

json.dump(dict(window=[T0, T0+DUR], n_frames=N,
               ball_detect_rate=round(float(good.mean()), 3),
               reproj_err_m=round(float(err.mean()), 3),
               ball_speed_kmh=dict(mean=round(float(bspeed.mean()), 1),
                                   p95=round(float(np.percentile(bspeed, 95)), 1)),
               player_speed_kmh=dict(p1=round(float(s1.mean()), 1),
                                     p2=round(float(s2.mean()), 1))),
          open("output/overlay_stats.json", "w"), indent=2)
print("output/overlay_demo.mp4, output/overlay_stats.json")
