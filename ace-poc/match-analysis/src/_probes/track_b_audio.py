"""Track B — 오디오 타격음 onset 검출. SPEC §3 Track B.

SPEC §7 "기본값 + 1회 조정"에 따라 두 설정을 모두 기록한다.
  default : librosa 기본 파라미터
  tuned   : 고주파 대역(2~8kHz)만으로 onset 계산 + delta 상향
            (타격음은 광대역 고주파 트랜지언트, 관중/발소리/환경음은 중저역)
"""
import json, subprocess, time
import numpy as np
import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

VIDEO = "input/match_amateur.mp4"
WAV = "output/audio.wav"
SR = 22050
WIN = 10.0        # 밀도 판정 창 (초)
MIN_HITS = 3      # 창당 최소 onset 수 (SPEC §3 Track B-3)
MIN_SEG = 3.0
GAP_TOL = 1.5

subprocess.run(["ffmpeg", "-v", "error", "-i", VIDEO, "-ac", "1", "-ar", str(SR), WAV, "-y"], check=True)
y, sr = librosa.load(WAV, sr=SR)
dur = len(y) / sr
print(f"오디오 {dur:.1f}s @ {sr}Hz")


def onsets_default():
    env = librosa.onset.onset_strength(y=y, sr=sr)
    t = librosa.onset.onset_detect(onset_envelope=env, sr=sr, units="time")
    return env, t


def onsets_tuned():
    # 2~8kHz 대역만 남긴 멜 스펙트로그램으로 onset envelope 계산
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=2048, hop_length=512,
                                       fmin=2000, fmax=8000, n_mels=64)
    env = librosa.onset.onset_strength(S=librosa.power_to_db(S, ref=np.max), sr=sr)
    env = env / (env.max() + 1e-9)
    t = librosa.onset.onset_detect(onset_envelope=env, sr=sr, units="time",
                                   delta=0.28, wait=8)   # wait=8프레임 ≈ 0.19s 최소 간격
    return env, t


def segments_from(times):
    """10초 창에서 onset MIN_HITS회 이상이면 플레이로 본다."""
    if len(times) == 0:
        return []
    edges = np.arange(0, dur + WIN, WIN)
    cnt, _ = np.histogram(times, bins=edges)
    segs = []
    for k, c in enumerate(cnt):
        if c >= MIN_HITS:
            segs.append([float(edges[k]), float(min(edges[k + 1], dur))])
    merged = []
    for a, b in segs:
        if merged and a - merged[-1][1] <= GAP_TOL:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [{"start": round(a, 2), "end": round(b, 2)} for a, b in merged if b - a >= MIN_SEG]


results = {}
for name, fn in (("default", onsets_default), ("tuned", onsets_tuned)):
    t0 = time.time()
    env, times = fn()
    segs = segments_from(times)
    cov = sum(s["end"] - s["start"] for s in segs)
    results[name] = dict(env=env, times=times, segs=segs)
    print(f"[{name:7s}] onset {len(times)}개 ({len(times)/dur*60:.1f}/분) | "
          f"구간 {len(segs)}개 {cov:.1f}s = 압축률 {cov/dur*100:.1f}% | {time.time()-t0:.1f}s")

best = results["tuned"]
json.dump([{"t": round(float(t), 3)} for t in best["times"]],
          open("output/trackB_hits.json", "w"), indent=2)
json.dump(best["segs"], open("output/trackB_segments.json", "w"), indent=2)
json.dump({k: dict(n_onsets=len(v["times"]), per_min=round(len(v["times"])/dur*60, 1),
                   n_segments=len(v["segs"]),
                   compression=round(sum(s["end"]-s["start"] for s in v["segs"])/dur*100, 1))
           for k, v in results.items()},
          open("output/trackB_param_comparison.json", "w"), indent=2)

fig, axes = plt.subplots(2, 1, figsize=(14, 6), sharex=True)
for ax, name in zip(axes, ("default", "tuned")):
    r = results[name]
    et = librosa.times_like(r["env"], sr=sr, hop_length=512)
    ax.plot(et, r["env"] / (r["env"].max() + 1e-9), lw=0.5, color="#333")
    ax.vlines(r["times"], 0, 1, color="crimson", alpha=0.35, lw=0.6)
    for s in r["segs"]:
        ax.axvspan(s["start"], s["end"], color="#3c3", alpha=0.22)
    ax.set_ylabel("onset strength")
    cov = sum(s["end"] - s["start"] for s in r["segs"])
    ax.set_title(f"Track B [{name}] — {len(r['times'])} onsets "
                 f"({len(r['times'])/dur*60:.0f}/min), {len(r['segs'])} segments, "
                 f"compression {cov/dur*100:.0f}%")
axes[-1].set_xlabel("time (s)"); axes[-1].set_xlim(0, dur)
fig.tight_layout(); fig.savefig("output/fig_audio_onset.png", dpi=110)
print("output/trackB_hits.json, output/trackB_segments.json, "
      "output/trackB_param_comparison.json, output/fig_audio_onset.png")
