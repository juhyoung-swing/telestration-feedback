"""타격 검출 v2 — 공-선수 최근접 + 궤적 방향 반전 + 타격음(바운스와 분리).

소리만 쓰던 방식은 바운스를 타격으로 오인했다(간격 0.8초 미만 27%).
세 신호를 각자 잘하는 일에만 쓰고 합친다.

  1) 근접  : 칠 때 공이 라켓에 붙는다 -> 후보 생성
  2) 반전  : 라켓에 맞으면 코트 진행 방향이 뒤집힌다. 바운스는 안 뒤집힌다 -> 판별
  3) 소리  : onset 을 스펙트럼으로 2군집. 근접 후보와 더 잘 맞는 쪽이 타격음 -> 보강

  python shots_v2.py <태그> <시작초> <길이초>
"""
import json, os, pickle, sys
import cv2
import numpy as np
import librosa
from sklearn.cluster import KMeans

TAG = sys.argv[1] if len(sys.argv) > 1 else "match_b"
T0 = float(sys.argv[2]) if len(sys.argv) > 2 else 45.0
DUR = float(sys.argv[3]) if len(sys.argv) > 3 else 67.0
VIDEO = f"input/{TAG}.mp4"
OUT = f"output/analysis/{TAG}_{int(T0)}_{int(DUR)}"
STRIDE = 2

L, WD, WS = 23.77, 10.97, 8.23
INSET, SVC, NET = (WD-WS)/2, 6.40, L/2
WORLD = np.float32([[0,0],[WD,0],[0,L],[WD,L],[INSET,0],[INSET,L],[WD-INSET,0],[WD-INSET,L],
                    [INSET,NET-SVC],[WD-INSET,NET-SVC],[INSET,NET+SVC],[WD-INSET,NET+SVC],
                    [WD/2,NET-SVC],[WD/2,NET+SVC]])
KP = np.float32(json.load(open(f"kp_{TAG}.json")))
Hm, _ = cv2.findHomography(KP, WORLD, cv2.RANSAC, 5.0)

cap = cv2.VideoCapture(VIDEO); fps = cap.get(cv2.CAP_PROP_FPS); cap.release()
dt = STRIDE/fps
D = pickle.load(open(f"output/multi/{TAG}/det_{int(T0)}_{int(DUR)}_x.pkl", "rb"))
persons = D["persons"]
tr = np.load(f"{OUT}/track.npz")
bx, by, seen = tr["bx"], tr["by"], tr["seen"]
NF = len(bx)
bw = cv2.perspectiveTransform(np.column_stack([bx, by]).reshape(-1,1,2).astype(np.float32),
                              Hm).reshape(-1, 2)

# ---------- 1) 근접 후보 ----------
bd = lambda p, b: np.hypot(max(b[0]-p[0], 0, p[0]-b[2]), max(b[1]-p[1], 0, p[1]-b[3]))
dist = np.full((NF, 2), np.nan)
for i, (a, b) in enumerate(persons):
    for k, q in enumerate((a, b)):
        if q:
            dist[i, k] = bd((bx[i], by[i]), q["box"])
best = np.where(np.isnan(dist), 1e4, dist).min(axis=1)
whoN = np.where(np.isnan(dist), 1e4, dist).argmin(axis=1) + 1
sm = np.convolve(best, np.ones(3)/3, mode="same")
cands = []
for i in range(3, NF-3):
    if seen[i] and sm[i] == min(sm[max(0,i-9):i+10]) and sm[i] < 150:
        if not cands or (i-cands[-1]["i"])*dt > 0.45:
            cands.append(dict(i=i, t=round(T0+i*dt, 2), px=float(sm[i]), who=int(whoN[i])))
print(f"[1 근접] 후보 {len(cands)}개", flush=True)

# ---------- 2) 방향 반전 (타격 vs 바운스) ----------
cy = np.convolve(bw[:, 1], np.ones(3)/3, mode="same")     # 코트 길이 방향 위치


def reversal(i, w=6):
    a, b = max(i-w, 0), min(i+w, NF-1)
    if seen[a:i].sum() < 2 or seen[i:b].sum() < 2:
        return None
    v1 = np.mean(np.diff(cy[a:i+1])); v2 = np.mean(np.diff(cy[i:b+1]))
    if abs(v1) < 0.02 or abs(v2) < 0.02:
        return None
    return bool(v1*v2 < 0)


for c in cands:
    c["rev"] = reversal(c["i"])
nrev = sum(1 for c in cands if c["rev"] is True)
print(f"[2 반전] 후보 중 방향 반전 확인 {nrev}/{len(cands)} "
      f"(판정불가 {sum(1 for c in cands if c['rev'] is None)})", flush=True)

# ---------- 3) 소리: 타격음 / 바운스 분리 ----------
wav = f"{OUT}/audio.wav"
if not os.path.exists(wav):
    os.system(f'ffmpeg -v error -ss {T0} -t {DUR} -i "{VIDEO}" -ac 1 -ar 22050 "{wav}" -y')
y, sr = librosa.load(wav, sr=22050)
S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=512,
                                   fmin=2000, fmax=8000, n_mels=64)
env = librosa.onset.onset_strength(S=librosa.power_to_db(S, ref=np.max), sr=sr)
env = env/(env.max()+1e-9)
ons = librosa.onset.onset_detect(onset_envelope=env, sr=sr, units="time", delta=0.28, wait=8)

feat, keep = [], []
for t in ons:
    a = int(t*sr); b = min(a+int(0.06*sr), len(y))       # 어택 60ms
    seg = y[max(a-int(0.005*sr), 0):b]
    if len(seg) < 256:
        continue
    Sx = np.abs(librosa.stft(seg, n_fft=512, hop_length=128))
    f_ = librosa.fft_frequencies(sr=sr, n_fft=512)
    p = Sx.mean(axis=1) + 1e-9
    cen = float((f_*p).sum()/p.sum())                     # 스펙트럼 무게중심
    hi = float(p[f_ > 4000].sum()/p.sum())                # 고역 비중
    flat = float(np.exp(np.log(p).mean())/p.mean())       # 평탄도(타격은 넓은 대역)
    rms = float(np.sqrt((seg**2).mean()))
    feat.append([cen, hi*4000, flat*4000, rms*4000]); keep.append(float(t))
feat = np.array(feat)
fz = (feat - feat.mean(0))/(feat.std(0)+1e-9)
km = KMeans(n_clusters=2, n_init=10, random_state=0).fit(fz)
lab = km.labels_

ct = [T0+t for t in keep]
agree = []
for g in (0, 1):
    ts = [ct[i] for i in range(len(ct)) if lab[i] == g]
    m = sum(1 for t in ts if any(abs(t-c["t"]) < 0.3 for c in cands))
    agree.append(m/max(len(ts), 1))
hit_g = int(np.argmax(agree))
hits_audio = sorted(ct[i] for i in range(len(ct)) if lab[i] == hit_g)
other = sorted(ct[i] for i in range(len(ct)) if lab[i] != hit_g)
print(f"[3 소리] onset {len(ct)}개 -> 2군집. 근접 후보 일치율 "
      f"{agree[0]*100:.0f}% vs {agree[1]*100:.0f}%", flush=True)
print(f"          타격음 {len(hits_audio)}개 / 나머지(바운스 등) {len(other)}개", flush=True)
print(f"          타격음 중심주파수 {feat[lab==hit_g,0].mean():.0f}Hz  "
      f"나머지 {feat[lab!=hit_g,0].mean():.0f}Hz", flush=True)

# ---------- 융합 ----------
for c in cands:
    s = 1.0                                              # 근접은 후보 생성 조건
    if c["rev"] is True:
        s += 1.0
    elif c["rev"] is False:
        s -= 0.7
    if any(abs(c["t"]-t) < 0.30 for t in hits_audio):
        s += 1.0
    elif any(abs(c["t"]-t) < 0.30 for t in other):
        s -= 0.4
    c["score"] = round(s, 2)
shots = [c for c in cands if c["score"] >= 1.5]
g = np.diff([s["t"] for s in shots])
print(f"\n[융합] 채택 {len(shots)}/{len(cands)}개 (score>=1.5)", flush=True)
if len(g):
    print(f"        간격 중앙값 {np.median(g):.2f}s  0.8초 미만 {(g<0.8).sum()}/{len(g)}", flush=True)
print(f"        선수별 P1 {sum(1 for s in shots if s['who']==1)} / "
      f"P2 {sum(1 for s in shots if s['who']==2)}", flush=True)
prev = json.load(open(f"{OUT}/results.json"))["shots"]
print(f"        (소리만 쓰던 이전: {len(prev)}개, 간격 0.8초 미만 "
      f"{(np.diff([s['t'] for s in prev])<0.8).sum()}/{len(prev)-1})", flush=True)
json.dump(dict(window=[T0, T0+DUR], method="proximity+reversal+audio",
               n_candidates=len(cands), n_audio_hit=len(hits_audio),
               n_audio_other=len(other), shots=shots),
          open(f"{OUT}/shots_v2.json", "w"), indent=2)
print(f"{OUT}/shots_v2.json", flush=True)
