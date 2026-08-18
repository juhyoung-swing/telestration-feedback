"""3D 포물선 복원으로 바운스 지점 추정.

이미지상의 약한 신호(기울기 꺾임)를 찾는 대신, 물리 법칙을 근거로 쓴다.

  1) 바닥 호모그래피에서 카메라 투영 행렬을 복원한다.
     H = K[r1 r2 t] 이므로 r3 = r1 x r2 로 높이 축을 얻는다.
  2) 타격~타격 구간마다 포물선 운동을 맞춘다. 미지수 6개:
        바운스 지점 (Xb, Yb), 바운스 시각 tau, 수평 속도 (Vx, Vy), 입사 수직속도 w
     바운스를 '찾는' 게 아니라 '미지수로 놓고 푼다'.
  3) 로버스트 손실(soft_l1)로 추적 이상치를 흡수한다.

  python bounce3d.py [시작초] [길이초]
"""
import json, os, sys
import cv2
import numpy as np
from scipy.optimize import least_squares

TAG, VIDEO = "match_b", "input/match_b.mp4"
T0 = float(sys.argv[1]) if len(sys.argv) > 1 else 300.0
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
OUT = "output/rally_map"
G, RESTITUTION = 9.81, 0.80

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])
KP = np.float32(json.load(open(f"kp_{TAG}.json")))
H_i2w, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
H_w2i = np.linalg.inv(H_i2w)

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
cap.release()
dt = 2/fps


# ---------- 1. 호모그래피 -> 카메라 투영 행렬 ----------
def camera_from_homography(Hw2i, W, H):
    """H = K[r1 r2 t] 를 분해해 P = K[r1 r2 r3 t] 를 만든다.
    주점은 이미지 중앙, 정사각 픽셀, 스큐 0 가정."""
    cx, cy = W/2.0, H/2.0
    h1, h2, h3 = Hw2i[:, 0], Hw2i[:, 1], Hw2i[:, 2]
    a1 = np.array([h1[0]-cx*h1[2], h1[1]-cy*h1[2]])
    a2 = np.array([h2[0]-cx*h2[2], h2[1]-cy*h2[2]])
    denom = h1[2]*h2[2]
    f2 = -(a1 @ a2) / denom if abs(denom) > 1e-12 else -1
    f = float(np.sqrt(f2)) if f2 > 0 else 1.2*max(W, H)   # 실패 시 통상값
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    Ki = np.linalg.inv(K)
    r1_, r2_, t_ = Ki @ h1, Ki @ h2, Ki @ h3
    lam = 1.0/np.linalg.norm(r1_)
    r1, r2, t = r1_*lam, r2_*lam, t_*lam
    if t[2] < 0:                                          # 코트가 카메라 앞쪽에 오도록
        r1, r2, t = -r1, -r2, -t
    # 직교화는 하지 않는다 — SVD로 R을 손대면 K[r1 r2 t] 와 H 의 일치가 깨진다.
    r3 = np.cross(r1, r2)
    R = np.column_stack([r1, r2, r3])
    P = K @ np.column_stack([r1, r2, r3, t])
    # 높이 축 방향을 경험적으로 확인: Z가 커지면 화면에서 위로(y 감소) 가야 한다
    c = np.float32([WD/2, L/2])
    p0 = P @ np.array([c[0], c[1], 0, 1.0]); p0 = p0[:2]/p0[2]
    p1 = P @ np.array([c[0], c[1], 1.0, 1.0]); p1 = p1[:2]/p1[2]
    if p1[1] > p0[1]:                                     # 아래로 가면 뒤집힌 것
        r3 = -r3
        R = np.column_stack([r1, r2, r3])
        P = K @ np.column_stack([r1, r2, r3, t])
    return P, K, R, t, f


P, K, R, tvec, focal = camera_from_homography(H_w2i, W, H)
cam_pos = -R.T @ tvec
print(f"[cam] 초점거리 {focal:.0f}px | 카메라 위치 (코트기준) "
      f"x={cam_pos[0]:.1f}m y={cam_pos[1]:.1f}m 높이={cam_pos[2]:.1f}m")

# 검증: Z=0 평면에서 호모그래피와 투영 행렬이 일치하는가
chk = []
for w in WORLD:
    a = cv2.perspectiveTransform(np.float32([[w]]), H_w2i).reshape(2)
    v = P @ np.array([w[0], w[1], 0, 1.0]); b = v[:2]/v[2]
    chk.append(np.hypot(*(a-b)))
print(f"[cam] Z=0 검증: 호모그래피 대비 평균 {np.mean(chk):.3f}px (0에 가까워야 정상)")


def project(XYZ):
    v = P @ np.hstack([XYZ, np.ones((len(XYZ), 1))]).T
    return (v[:2]/v[2]).T


# ---------- 2. 궤적 모델 ----------
def path(params, s):
    """바운스 시각 기준 상대시각 s에서의 3D 위치. s<0 낙하, s>0 반등."""
    Xb, Yb, Vx, Vy, w = params
    Z = np.where(s < 0, w*s - 0.5*G*s**2, -RESTITUTION*w*s - 0.5*G*s**2)
    return np.column_stack([Xb + Vx*s, Yb + Vy*s, Z])


def fit_interval(ts, uv, t_lo, t_hi):
    """관측 (시각, 화면좌표)에 포물선을 맞춰 바운스 지점을 구한다."""
    ground = cv2.perspectiveTransform(uv.reshape(-1,1,2).astype(np.float32),
                                      H_i2w).reshape(-1, 2)
    mid = len(ts)//2
    tau0 = ts[mid]
    span = max(ts[-1]-ts[0], 1e-3)
    v0 = (ground[-1]-ground[0])/span
    p0 = np.array([ground[mid][0], ground[mid][1], v0[0], v0[1], -6.0])

    def resid(q):
        Xb, Yb, Vx, Vy, w, tau = q
        pr = project(path([Xb, Yb, Vx, Vy, w], ts-tau))
        return (pr - uv).ravel()

    lo = [-8, -8, -60, -60, -30, t_lo]
    hi = [WD+8, L+8, 60, 60, -0.5, t_hi]
    q0 = np.clip(np.append(p0, tau0), lo, hi)
    r = least_squares(resid, q0, bounds=(lo, hi), loss="soft_l1", f_scale=8.0,
                      max_nfev=400)
    px = np.abs(r.fun).reshape(-1, 2)
    return dict(pos=(float(r.x[0]), float(r.x[1])), tau=float(r.x[5]),
                vz=float(r.x[4]), rms=float(np.sqrt((r.fun**2).mean())),
                med_px=float(np.median(np.hypot(px[:,0], px[:,1]))), n=len(ts))


# ---------- 3. 구간별 실행 ----------
d = np.load(f"{OUT}/track.npz")
bx, by, seen = d["bx"], d["by"], d["seen"]
st = json.load(open(f"{OUT}/rally_stats.json"))
shots = st["shots"]
sh_i = [int(round((s["t"]-T0)/dt)) for s in shots]

print(f"\n{'구간':>12} {'점':>4} {'바운스 좌표(m)':>18} {'시각':>7} {'재투영오차':>10}  판정")
res = []
for a, b in zip(sh_i, sh_i[1:]):
    i0, i1 = a+2, b-2
    idx = [k for k in range(i0, i1+1) if seen[k] and 0 <= bx[k] < W and 0 <= by[k] < H]
    if len(idx) < 8:
        print(f"{a*dt:5.1f}~{b*dt:5.1f} {len(idx):4d}      점 부족")
        continue
    ts = np.array(idx, float)*dt
    uv = np.column_stack([bx[idx], by[idx]])
    f = fit_interval(ts, uv, ts[0], ts[-1])
    inside = (-1.0 < f["pos"][0] < WD+1.0) and (-1.0 < f["pos"][1] < L+1.0)
    good = f["med_px"] < 25 and inside
    f.update(t=T0+f["tau"], inside=bool(inside), ok=bool(good))
    res.append(f)
    print(f"{a*dt:5.1f}~{b*dt:5.1f} {len(idx):4d} "
          f"({f['pos'][0]:7.2f},{f['pos'][1]:7.2f}) {f['tau']:6.2f}s "
          f"{f['med_px']:8.1f}px  {'OK' if good else ('코트밖' if not inside else '오차큼')}")

ok = [r for r in res if r["ok"]]
print(f"\n성공 {len(ok)}/{len(res)}구간")
json.dump(dict(camera=dict(focal_px=focal, pos_m=[float(v) for v in cam_pos]),
               bounces=res), open(f"{OUT}/bounce3d.json", "w"), indent=2)
print(f"{OUT}/bounce3d.json")
