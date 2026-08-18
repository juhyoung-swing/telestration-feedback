#!/usr/bin/env python3
"""s4 — A-roll 물리적 컷 1회. 자르기만 한다.

오디오와 영상을 따로 만든다.
조각마다 AAC 로 굽고 concat 하면 이음매마다 프레임 경계 때문에 딸깍거린다.
오디오는 조각을 무손실 PCM 으로 떼어 앞뒤 15ms 페이드를 건 뒤
파이썬에서 샘플 단위로 이어붙이고, 마지막에 한 번만 인코딩한다.

  output/aroll.mp4     — 이어붙인 A-roll
  output/timeline.json — 씬/블록의 절대 시각
  output/cut_log.json  — 컷 하나하나의 근거

usage: python cut.py [run_dir] [directive.json] [--with-cg]
       --with-cg 를 주면 챕터 카드·검은 전환도 넣는다. 기본은 A-roll 만.
"""
import json
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
W, H, FPS, SR = 1920, 1080, 30, 48000
FADE = 0.015                     # 이음매 딸깍 방지
VENC = ["-c:v", "h264_videotoolbox", "-b:v", "14M", "-pix_fmt", "yuv420p"]


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(" ".join(str(c) for c in cmd))
        print(r.stderr[-2000:])
        raise SystemExit(1)
    return r


def dur(p: Path) -> float:
    return float(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(p)]).stdout.strip())


def seek(a: float):
    """앞쪽 3초는 빠른 탐색으로 건너뛰고 거기서부터 정확히 자른다.
    -ss 를 -i 뒤에만 두면 매번 처음부터 디코딩해서 느리다."""
    coarse = max(0.0, a - 3.0)
    return coarse, a - coarse


def cut_video(src: Path, a: float, b: float, out: Path):
    c, off = seek(a)
    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{c:.3f}", "-i", str(src),
        "-ss", f"{off:.3f}", "-to", f"{off + (b - a):.3f}", "-an",
        "-vf", f"scale={W}:{H},fps={FPS},setsar=1", *VENC, str(out)])


def cut_audio(src: Path, a: float, b: float, out: Path):
    """페이드는 ffmpeg 필터로 걸지 않는다.

    afade 의 st 는 '빠른 탐색으로 건너뛰기 전' 타임라인을 본다. 그래서
    -ss 3초앞 -i 파일 -ss 3 식으로 자르면 페이드아웃이 실제 끝보다 3초 먼저 걸리고,
    페이드아웃 뒤는 게인이 0이라 그 뒤가 통째로 무음이 된다.
    3초보다 짧은 조각은 아예 전부 무음이 된다. 실제로 그렇게 나왔다.

    여기서는 PCM 만 떼어 오고 페이드는 파이썬에서 샘플에 직접 건다."""
    c, off = seek(a)
    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{c:.3f}", "-i", str(src),
        "-ss", f"{off:.3f}", "-to", f"{off + (b - a):.3f}", "-vn",
        "-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", str(out)])


def silent_pcm(seconds: float) -> bytes:
    return b"\0" * (int(SR * seconds) * 4)


def pcm_of(wav: Path) -> bytes:
    b = wav.read_bytes()
    i = b.find(b"data")
    return b[i + 8:]


def faded(pcm: bytes) -> bytes:
    """이음매 딸깍 방지. 앞뒤 FADE 만큼 진폭을 선형으로 올리고 내린다."""
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float32).copy()
    n = min(int(SR * FADE) * 2, len(x) // 4)
    if n >= 2:
        ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
        x[:n] *= ramp
        x[-n:] *= ramp[::-1]
    return np.clip(np.round(x), -32768, 32767).astype("<i2").tobytes()


def write_wav(path: Path, data: bytes):
    path.write_bytes(
        b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " +
        struct.pack("<IHHIIHH", 16, 1, 2, SR, SR * 4, 4, 16) +
        b"data" + struct.pack("<I", len(data)) + data)


def black(seconds: float, out: Path):
    sh(["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
        "-i", f"color=c=black:s={W}x{H}:r={FPS}:d={seconds:.3f}", "-an", *VENC, str(out)])


def main() -> None:
    argv = [a for a in sys.argv[1:] if a != "--with-cg"]
    with_cg = "--with-cg" in sys.argv
    run_dir = Path(argv[0]) if argv and not argv[0].endswith(".json") else ROOT / "runs/002"
    src = Path(argv[-1]) if argv and argv[-1].endswith(".json") else \
        run_dir / "s3_rough_cut_lint/output/directive_tight.json"

    step = run_dir / "s4_aroll_cut"
    inp, out = step / "input", step / "output"
    parts = out / "parts"
    for p in (inp, out, parts):
        p.mkdir(parents=True, exist_ok=True)
    (inp / "directive.json").write_text(src.read_text())      # 입력은 복사한다
    d = json.loads((inp / "directive.json").read_text())
    scenes = [s for s in d["scenes"] if s.get("enabled", True)]
    raw = ROOT / "raw"

    log, timeline, vlist, pcm = [], [], [], bytearray()
    t = 0.0

    for i, s in enumerate(scenes):
        sid, blocks = s["scene_id"], []
        for j, r in enumerate(s.get("a_roll") or []):
            bid = f"{sid}_{j:02d}"
            v, w = parts / f"{bid}.mp4", parts / f"{bid}.wav"
            if not v.exists():
                cut_video(raw / f'{r["file"]}.mp4', r["start"], r["end"], v)
            if not w.exists():
                cut_audio(raw / f'{r["file"]}.mp4', r["start"], r["end"], w)
            dd = dur(v)
            blocks.append({"block_id": bid, "kind": "a_roll", "file": r["file"],
                           "src_start": r["start"], "src_end": r["end"],
                           "abs_start": round(t, 3), "abs_end": round(t + dd, 3)})
            log.append({"block_id": bid, "scene": sid,
                        "from": f'{r["file"]} {r["start"]:.2f}–{r["end"]:.2f}',
                        "asked_sec": round(r["end"] - r["start"], 3), "got_sec": round(dd, 3),
                        "drift_sec": round(dd - (r["end"] - r["start"]), 3)})
            vlist.append(v)
            a = faded(pcm_of(w))
            need = int(round(dd * SR)) * 4                     # 영상 길이에 오디오를 맞춘다
            pcm += a[:need] + b"\0" * max(0, need - len(a))
            t += dd

        if with_cg and not s.get("a_roll") and s.get("generated"):
            n = s["duration_sec"]
            v = parts / f"{sid}_cg.mp4"
            if not v.exists():
                black(n, v)
            dd = dur(v)
            blocks.append({"block_id": f"{sid}_cg", "kind": "cg",
                           "asset_id": s["generated"]["asset_id"],
                           "abs_start": round(t, 3), "abs_end": round(t + dd, 3)})
            log.append({"block_id": f"{sid}_cg", "scene": sid,
                        "from": f'생성 카드 {s["generated"]["asset_id"]}',
                        "asked_sec": n, "got_sec": round(dd, 3), "drift_sec": round(dd - n, 3)})
            vlist.append(v)
            pcm += silent_pcm(dd)
            t += dd

        if blocks:
            timeline.append({"scene_id": sid, "role": s["role"],
                             "abs_start": blocks[0]["abs_start"], "abs_end": round(t, 3),
                             "blocks": blocks})

        if with_cg:
            nxt = scenes[i + 1] if i + 1 < len(scenes) else None
            to = s.get("transition_out") or {}
            ti = (nxt.get("transition_in") or {}) if nxt else {}
            gap = ti if ti.get("type") == "black_card" else (to if to.get("type") == "black_card" and nxt else None)
            if gap and gap["duration_sec"] > 0:
                v = parts / f"{sid}_gap.mp4"
                if not v.exists():
                    black(gap["duration_sec"], v)
                dd = dur(v)
                timeline.append({"scene_id": f"{sid}_gap", "role": "black_card",
                                 "abs_start": round(t, 3), "abs_end": round(t + dd, 3),
                                 "blocks": [{"block_id": f"{sid}_gap", "kind": "black_card",
                                             "asset_id": gap.get("card"),
                                             "abs_start": round(t, 3),
                                             "abs_end": round(t + dd, 3)}]})
                vlist.append(v)
                pcm += silent_pcm(dd)
                t += dd

    lst = out / "concat.txt"
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in vlist))
    vonly, wav, aroll = out / "video.mp4", out / "audio.wav", out / "aroll.mp4"
    sh(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
        "-c", "copy", str(vonly)])
    write_wav(wav, bytes(pcm))
    sh(["ffmpeg", "-y", "-v", "error", "-i", str(vonly), "-i", str(wav),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(aroll)])

    total = dur(aroll)
    (out / "timeline.json").write_text(json.dumps(
        {"source": src.name, "width": W, "height": H, "fps": FPS,
         "total_sec": round(total, 3), "scenes": timeline}, ensure_ascii=False, indent=1))
    (out / "cut_log.json").write_text(json.dumps(
        {"blocks": log, "planned_sec": round(t, 3), "actual_sec": round(total, 3),
         "audio_sec": round(len(pcm) / 4 / SR, 3),
         "max_drift_sec": round(max(abs(x["drift_sec"]) for x in log), 3)},
        ensure_ascii=False, indent=1))
    print(f"컷 {len(log)}개 · 영상 {total:.1f}s · 오디오 {len(pcm)/4/SR:.1f}s "
          f"({int(total//60)}:{total%60:04.1f}) · 최대 오차 "
          f"{max(abs(x['drift_sec']) for x in log):.3f}s")
    print(f"→ {aroll.resolve()}")


if __name__ == "__main__":
    main()
