"""Track C — 프레임 차분 모션 스코어로 플레이 구간 검출. SPEC §3 Track C."""
import cv2, json, time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

VIDEO = "input/match_amateur.mp4"
SAMPLE_HZ = 10        # 초당 10회 샘플 (SPEC §2: 10fps 유효 샘플링이면 충분)
SMALL = (160, 90)     # 차분 계산용 다운샘플
MIN_SEG = 3.0         # 최소 구간 길이(초)
GAP_TOL = 1.5         # 끊김 허용(초)

# 스코어보드 오버레이가 계속 변해 모션 점수를 오염시키므로 마스킹.
# 좌상단 스코어보드 + 우상단 방송국 로고 (1920x1080 기준 비율)
MASKS = [(0.00, 0.00, 0.26, 0.20),   # 좌상단 스코어보드
         (0.78, 0.00, 1.00, 0.20)]   # 우상단 로고

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
dur = total / fps
step = max(1, round(fps / SAMPLE_HZ))
print(f"{VIDEO}: {dur:.1f}s, {fps:.2f}fps, {total} frames -> {step}프레임당 1회 = {fps/step:.1f}Hz 샘플")

mask = np.ones(SMALL[::-1], np.float32)
for x1, y1, x2, y2 in MASKS:
    mask[int(y1*SMALL[1]):int(y2*SMALL[1]), int(x1*SMALL[0]):int(x2*SMALL[0])] = 0

times, scores = [], []
prev = None
i = 0
t0 = time.time()
while True:
    ok = cap.grab()
    if not ok:
        break
    if i % step == 0:
        ok, frame = cap.retrieve()
        if ok:
            g = cv2.cvtColor(cv2.resize(frame, SMALL), cv2.COLOR_BGR2GRAY).astype(np.float32)
            if prev is not None:
                d = np.abs(g - prev) * mask
                scores.append(float(d.sum() / mask.sum()))
                times.append(i / fps)
            prev = g
    i += 1
cap.release()
times, scores = np.array(times), np.array(scores)
print(f"샘플 {len(scores)}개, {time.time()-t0:.1f}s 소요")

# 임계값: 중앙값 + (90퍼센타일 - 중앙값) * 0.35  — 분포 기반, 영상별 자동
med, p90 = np.median(scores), np.percentile(scores, 90)
thr = med + (p90 - med) * 0.35
print(f"모션 스코어: median={med:.2f} p90={p90:.2f} -> 임계값={thr:.2f}")

# 구간화: 임계 초과 -> gap 병합 -> 최소 길이 필터
above = scores > thr
segs = []
s = None
for k, on in enumerate(above):
    if on and s is None:
        s = times[k]
    if not on and s is not None:
        segs.append([s, times[k]])
        s = None
if s is not None:
    segs.append([s, times[-1]])

merged = []
for a, b in segs:
    if merged and a - merged[-1][1] <= GAP_TOL:
        merged[-1][1] = b
    else:
        merged.append([a, b])
final = [{"start": round(a, 2), "end": round(b, 2)} for a, b in merged if b - a >= MIN_SEG]

json.dump(final, open("output/trackC_segments.json", "w"), indent=2)
cov = sum(s["end"] - s["start"] for s in final)
print(f"구간 {len(final)}개, 총 {cov:.1f}s / {dur:.1f}s = 압축률 {cov/dur*100:.1f}%")

np.savez("output/trackC_scores.npz", times=times, scores=scores, thr=thr)

# 장면 전환(타이틀/아웃트로)은 스코어가 수십 배 튀어 축을 망가뜨리므로 클리핑해서 표시
cuts = times[scores > med * 10]
ymax = np.percentile(scores, 99.5) * 1.3
fig, ax = plt.subplots(figsize=(14, 4))
ax.plot(times, np.clip(scores, 0, ymax), lw=0.6, color="#333")
ax.axhline(thr, color="crimson", ls="--", lw=1, label=f"threshold={thr:.2f}")
for s_ in final:
    ax.axvspan(s_["start"], s_["end"], color="#3c3", alpha=0.25)
for c in cuts:
    ax.axvline(c, color="#06c", lw=0.8, alpha=0.7)
ax.plot([], [], color="#06c", lw=0.8, label=f"scene cut ({len(cuts)})")
ax.set_xlabel("time (s)"); ax.set_ylabel("motion score (clipped)")
ax.set_title(f"Track C — frame-difference motion score (green = detected play, {len(final)} segments)")
ax.legend(loc="upper right"); ax.set_xlim(0, dur); ax.set_ylim(0, ymax)
fig.tight_layout(); fig.savefig("output/fig_motion_score.png", dpi=110)
print(f"장면 전환 {len(cuts)}회: {np.round(cuts,1).tolist()}")
print("output/trackC_segments.json, output/trackC_scores.npz, output/fig_motion_score.png")
