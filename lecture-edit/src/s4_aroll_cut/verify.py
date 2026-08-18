#!/usr/bin/env python3
"""s4 검사 — 잘라낸 결과가 원본과 맞는지 블록마다 확인한다.

이 파일은 실제 사고에서 나왔다. 오디오 페이드를 잘못된 타임라인에 걸어서
블록 뒤쪽이 통째로 무음이 됐는데, 길이는 정확히 맞아서 컷 로그로는 안 잡혔다.
길이만 보면 안 된다. 내용을 봐야 한다.

블록마다 두 가지를 비교한다.
  소리 : 원본 구간의 RMS vs 결과물 같은 구간의 RMS
  그림 : 원본 프레임 vs 결과물 프레임의 밝기 분포 차이

output/verify.json

usage: python verify.py [run_dir]
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ASR = 8000          # 검사용 샘플레이트
TOL_QUIET = 0.35    # 원본 대비 이보다 조용하면 무음 사고로 본다
TOL_FRAME = 0.14    # 밝기 히스토그램 거리. 이보다 멀면 다른 그림으로 본다


def audio(path: Path, extra=()) -> np.ndarray:
    r = subprocess.run(["ffmpeg", "-v", "error", *extra, "-i", str(path), "-vn",
                        "-ac", "1", "-ar", str(ASR), "-f", "s16le", "-"],
                       capture_output=True)
    return np.frombuffer(r.stdout, dtype="<i2").astype(np.float32) / 32768


def rms(x: np.ndarray, a: float, b: float) -> float:
    i, j = max(0, int(a * ASR)), min(len(x), int(b * ASR))
    return float(np.sqrt((x[i:j] ** 2).mean() + 1e-12)) if j > i else 0.0


def hist(path: Path, t: float) -> np.ndarray:
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path),
                        "-frames:v", "1", "-vf", "scale=64:36,format=gray",
                        "-f", "rawvideo", "-"], capture_output=True)
    a = np.frombuffer(r.stdout, dtype=np.uint8)
    if not len(a):
        return np.zeros(32)
    h = np.bincount(a // 8, minlength=32).astype(np.float32)
    return h / h.sum()


def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "runs/002"
    out = run_dir / "s4_aroll_cut/output"
    tl = json.loads((out / "timeline.json").read_text())
    aroll = out / "aroll.mp4"

    got = audio(aroll)
    src_audio, bad = {}, []
    rows = []
    for s in tl["scenes"]:
        for b in s["blocks"]:
            if b["kind"] != "a_roll":
                continue
            c = b["file"]
            if c not in src_audio:
                src_audio[c] = audio(ROOT / "raw" / f"{c}.mp4")
            want = rms(src_audio[c], b["src_start"], b["src_end"])
            have = rms(got, b["abs_start"], b["abs_end"])
            ratio = have / want if want > 1e-6 else 1.0
            # 그림은 블록 가운데에서 한 장씩 비교한다
            mid = (b["abs_end"] - b["abs_start"]) / 2
            h1 = hist(ROOT / "raw" / f"{c}.mp4", b["src_start"] + mid)
            h2 = hist(aroll, b["abs_start"] + mid)
            dist = float(np.abs(h1 - h2).sum() / 2)
            row = {"block_id": b["block_id"], "clip": c,
                   "src": [b["src_start"], b["src_end"]],
                   "abs": [b["abs_start"], b["abs_end"]],
                   "rms_src": round(want, 5), "rms_out": round(have, 5),
                   "rms_ratio": round(ratio, 3), "frame_dist": round(dist, 3)}
            rows.append(row)
            if ratio < TOL_QUIET:
                bad.append({**row, "why": "결과가 원본보다 훨씬 조용하다 — 무음 사고"})
            elif dist > TOL_FRAME:
                bad.append({**row, "why": "블록 가운데 그림이 원본과 다르다 — 컷 위치가 어긋났다"})

    (out / "verify.json").write_text(json.dumps(
        {"blocks": len(rows), "failed": len(bad),
         "rms_ratio_median": round(float(np.median([r["rms_ratio"] for r in rows])), 3),
         "frame_dist_median": round(float(np.median([r["frame_dist"] for r in rows])), 3),
         "failures": bad, "all": rows}, ensure_ascii=False, indent=1))

    print(f"블록 {len(rows)}개 검사 · 실패 {len(bad)}개")
    print(f"  소리 비율 중앙값 {np.median([r['rms_ratio'] for r in rows]):.3f} (1.0 이 정상)")
    print(f"  그림 거리 중앙값 {np.median([r['frame_dist'] for r in rows]):.3f} (0.0 이 정상)")
    for x in bad[:12]:
        print(f"  ✕ {x['block_id']:10s} {x['clip']} {x['src'][0]:.2f}–{x['src'][1]:.2f}  "
              f"소리 {x['rms_ratio']:.2f} 그림 {x['frame_dist']:.2f}  {x['why']}")
    print(f"→ {(out / 'verify.json').resolve()}")


if __name__ == "__main__":
    main()
