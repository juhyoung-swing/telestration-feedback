"""코트 키포인트 보정 — 모델 예측을 실제 흰 라인 교차점으로 스냅한다.

모델이 T자 교차점에서 30px쯤 어긋나는 것을 관측. 코트 라인은 화면에 실제로
보이므로, 예측 지점 주변에서 직선 두 개를 찾아 교차점으로 옮긴다.
카메라가 고정이면 1회 계산해 영상 전체에 재사용 가능.
"""
import cv2
import numpy as np

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, 23.77/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])


def _lines_in_patch(gray):
    """패치 안의 흰 라인을 (rho, theta) 목록으로."""
    g = cv2.GaussianBlur(gray, (3, 3), 0)
    # 흰 라인은 주변보다 밝다 — 상위 밝기만 남긴다
    thr = np.percentile(g, 88)
    mask = (g >= thr).astype(np.uint8) * 255
    edges = cv2.Canny(mask, 40, 120)
    lines = cv2.HoughLines(edges, 1, np.pi/180, threshold=28)
    return [] if lines is None else [tuple(l[0]) for l in lines]


def _intersect(l1, l2):
    (r1, t1), (r2, t2) = l1, l2
    A = np.array([[np.cos(t1), np.sin(t1)], [np.cos(t2), np.sin(t2)]])
    if abs(np.linalg.det(A)) < 1e-6:
        return None
    return np.linalg.solve(A, np.array([r1, r2]))


def refine_point(img, pt, win=55, max_shift=45):
    """예측점 주변에서 서로 다른 방향의 직선 2개를 찾아 교차점으로 스냅."""
    H, W = img.shape[:2]
    x, y = float(pt[0]), float(pt[1])
    if not (win < x < W-win and win < y < H-win):
        return None                                   # 프레임 가장자리는 건너뜀
    x1, y1 = int(x-win), int(y-win)
    patch = img[y1:y1+2*win, x1:x1+2*win]
    gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
    lines = _lines_in_patch(gray)
    if len(lines) < 2:
        return None
    base = lines[0]
    # 첫 직선과 30도 이상 벌어진 것 중 가장 강한 것
    other = next((l for l in lines[1:]
                  if min(abs(l[1]-base[1]), np.pi-abs(l[1]-base[1])) > np.pi/6), None)
    if other is None:
        return None
    p = _intersect(base, other)
    if p is None:
        return None
    gx, gy = x1 + p[0], y1 + p[1]
    if np.hypot(gx-x, gy-y) > max_shift:              # 너무 멀면 오검출로 보고 버림
        return None
    return np.float32([gx, gy])


def refine_all(img, KP, verbose=False):
    """14점을 보정하고, 성공한 점들로 호모그래피를 다시 맞춘 뒤
    코트 규격을 역투영해 기하학적으로 일관된 14점을 돌려준다."""
    refined, used = [], []
    for i, p in enumerate(KP):
        q = refine_point(img, p)
        if q is not None:
            refined.append(q); used.append(i)
            if verbose:
                print(f"    kp{i:2d} 보정 {np.hypot(*(q-p)):5.1f}px")
    if len(used) < 6:
        return KP, 0, None
    src = np.float32(refined).reshape(-1, 1, 2)
    dst = WORLD[used].reshape(-1, 1, 2)
    Hm, _ = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if Hm is None:
        return KP, 0, None
    Hinv = np.linalg.inv(Hm)
    KP2 = cv2.perspectiveTransform(WORLD.reshape(-1, 1, 2), Hinv).reshape(-1, 2)
    return KP2.astype(np.float32), len(used), Hm


def reproj_error(KP, Hm=None):
    if Hm is None:
        Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)
    if Hm is None:
        return float("nan")
    return float(np.abs(cv2.perspectiveTransform(KP.reshape(-1,1,2), Hm).reshape(-1,2)-WORLD).mean())


if __name__ == "__main__":
    import sys, torch, torchvision
    from torchvision import transforms
    VIDEO = sys.argv[1] if len(sys.argv) > 1 else "input/match_b.mp4"
    T = float(sys.argv[2]) if len(sys.argv) > 2 else 300.0
    m = torchvision.models.resnet50(); m.fc = torch.nn.Linear(m.fc.in_features, 28)
    m.load_state_dict(torch.load("models/keypoints_model.pth", map_location="cpu")); m.eval()
    tf = transforms.Compose([transforms.ToPILImage(), transforms.Resize((224,224)),
                             transforms.ToTensor(),
                             transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
    c = cv2.VideoCapture(VIDEO); fps = c.get(cv2.CAP_PROP_FPS)
    c.set(cv2.CAP_PROP_POS_FRAMES, int(T*fps)); _, f = c.read(); c.release()
    H, W = f.shape[:2]
    with torch.no_grad():
        o = m(tf(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)).unsqueeze(0))[0].numpy()
    KP = (o.reshape(14,2) * [W/224., H/224.]).astype(np.float32)
    print(f"보정 전 재투영 오차: {reproj_error(KP):.4f} m")
    KP2, n, Hm = refine_all(f, KP, verbose=True)
    print(f"라인 스냅 성공 {n}/14")
    print(f"보정 후 재투영 오차: {reproj_error(KP2, Hm):.4f} m")
    print(f"평균 이동량: {np.hypot(*(KP2-KP).T).mean():.1f} px")
    vis = f.copy()
    for i in range(14):
        cv2.circle(vis, tuple(KP[i].astype(int)), 7, (0,0,255), 2)      # 빨강 = 이전
        cv2.circle(vis, tuple(KP2[i].astype(int)), 7, (0,255,0), -1)    # 초록 = 보정
        cv2.putText(vis, str(i), tuple((KP2[i]+[10,-10]).astype(int)),
                    cv2.FONT_HERSHEY_SIMPLEX, .7, (0,255,0), 2)
    cv2.imwrite("output/screenshots/kp_refined.jpg", vis)
    print("output/screenshots/kp_refined.jpg (빨강=이전, 초록=보정)")
