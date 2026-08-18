#!/usr/bin/env python3
"""s3 — 러프컷. 말 사이의 쉼을 줄여 A-roll 조각을 만든다.

사람 편집본을 c01_01 로 맞춰보면 통편집은 컷 하나뿐인데 길이가 2.4초 더 짧다.
사라진 곳은 말 사이다. 쉼을 지운 게 아니라 짧게 줄였다.
말은 바로 이어지는데 숨은 남아 있다 — 그게 편집본이 무편집본과 다른 점이다.

두 가지를 지킨다.

  1. 쉼은 없애지 않고 KEEP_PAUSE 로 줄인다.
     다 지우면 기관총처럼 들린다.

  2. 컷 지점은 '화면이 가장 안 튀는 곳'으로 고른다.
     컷의 값은 아낀 시간이 아니라 인물이 얼마나 튀느냐다. 쉼 구간 안에서
     앞 프레임과 뒤 프레임이 제일 비슷해지는 지점을 찾아 거기서 자른다.
     아무리 찾아도 많이 튀면 그 컷은 포기한다.

무음 탐지는 ffmpeg silencedetect 를 쓴다. 직접 만든 백분위수 기준은
룸톤을 침묵으로 못 봐서 c01_01 에서 17곳 중 3곳만 찾았다.

output/directive_tight.json + lint.json

usage: python tighten.py [run_dir] [directive.json] [--only c01_01]
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
NOISE_DB = -30          # 이보다 조용하면 무음
MIN_SIL = 0.25          # 이보다 짧은 무음은 무시
KILL_GAP = 0.40         # 이보다 긴 쉼만 손댄다. 짧은 쉼은 말의 리듬이다

# 쉼에는 두 종류가 있다.
#   문장 안의 머뭇거림  "마무리 (쉬고) 피니시까지"  → 거의 없앤다. 말이 바로 붙어야 한다
#   문장 사이의 호흡                              → 짧게 남긴다. 다 지우면 기관총이 된다
KEEP_INTRA = 0.18
KEEP_INTER = 0.30
GUARD = 0.06            # 무음 양끝은 건드리지 않는다 (말꼬리·들숨 보호)
# 한 문장 안에서 컷은 이만큼까지. 넘으면 긴 쉼부터 자르고 나머지는 둔다.
# 제한이 없었을 때 "거리를 정확하게 멀리 두게 돼요" 3.1초짜리 한 문장이
# 세 조각이 나면서 버벅이게 들렸다.
MAX_CUTS_PER_SENTENCE = 2
MOTION_MAX = 0.055      # 컷 앞뒤 프레임 차이가 이보다 크면 컷을 포기한다
FRAME_HZ = 10           # 화면 비교용 프레임 샘플링
FW, FH = 64, 36


def silences(clip: Path) -> list:
    r = subprocess.run(["ffmpeg", "-i", str(clip), "-af",
                        f"silencedetect=noise={NOISE_DB}dB:d={MIN_SIL}", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return list(zip(starts, ends))


def frames(clip: Path) -> np.ndarray:
    """저해상도 회색 프레임을 통째로 메모리에 올린다.
    컷 후보마다 ffmpeg 를 부르면 느리다. 한 번 풀고 numpy 로 비교한다."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(clip), "-an",
                        "-vf", f"fps={FRAME_HZ},scale={FW}:{FH},format=gray",
                        "-f", "rawvideo", "-"], capture_output=True)
    a = np.frombuffer(r.stdout, dtype=np.uint8).astype(np.float32) / 255
    return a[: len(a) // (FW * FH) * (FW * FH)].reshape(-1, FH, FW)


def pause_kind(segs: list, gs: float, ge: float):
    """이 쉼이 문장 안의 머뭇거림인지, 문장과 문장 사이의 호흡인지.
    문장 안이면 몇 번째 문장인지도 같이 돌려준다 (문장별 컷 상한에 쓴다)."""
    mid = (gs + ge) / 2
    for i, s in enumerate(segs):
        if s["start"] < mid < s["end"]:
            if gs >= s["start"] - 0.05 and ge <= s["end"] + 0.05:
                return "intra", i
            return "inter", i
    return "inter", -1


def diff(fr: np.ndarray, t1: float, t2: float) -> float:
    i, j = int(t1 * FRAME_HZ), int(t2 * FRAME_HZ)
    if not (0 <= i < len(fr) and 0 <= j < len(fr)):
        return 1.0
    return float(np.abs(fr[i] - fr[j]).mean())


def best_cut(fr: np.ndarray, s: float, e: float, remove: float):
    """무음 [s,e] 안에서 remove 초를 들어낼 때, 화면이 제일 안 튀는 지점.

    들어낼 구간은 무음 안쪽(양끝 GUARD 제외)에 통째로 들어가야 한다.
    그보다 많이 지우라고 하면 지울 수 있는 만큼만 지운다 — 그래야 말꼬리가 안 잘린다.

    반환: (자르는 지점, 다시 붙는 지점, 튐 정도)"""
    room = (e - s) - 2 * GUARD
    if room <= 0.02:
        return None
    remove = min(remove, room)
    lo, hi = s + GUARD, e - GUARD - remove
    best, t = None, lo
    while t <= hi + 1e-9:
        d = diff(fr, t, t + remove)
        if best is None or d < best[2]:
            best = (t, t + remove, d)
        t += 1.0 / FRAME_HZ
    return best


def main() -> None:
    argv = sys.argv[1:]
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    argv = [a for a in argv if a != "--only" and a != only]
    run_dir = Path(argv[0]) if argv and not argv[0].endswith(".json") else ROOT / "runs/002"
    src = Path(argv[-1]) if argv and argv[-1].endswith(".json") else \
        run_dir / "s2_storyline_and_directive/output/directive_H.json"

    step = run_dir / "s3_rough_cut_lint"
    inp, out = step / "input", step / "output"
    for p in (inp, out):
        p.mkdir(parents=True, exist_ok=True)
    (inp / "directive.json").write_text(src.read_text())
    d = json.loads((inp / "directive.json").read_text())

    # 무발화 시범 클립은 손대지 않는다. 기획서의 '무음 ≠ 삭제'.
    silent = {f["id"] for f in d["meta"]["source"]["files"] if f.get("speech") is False}
    used = {r["file"] for s in d["scenes"] for r in (s.get("a_roll") or [])} - silent
    if only:
        used &= {only}
    sil = {c: silences(ROOT / "raw" / f"{c}.mp4") for c in sorted(used)}
    fr = {c: frames(ROOT / "raw" / f"{c}.mp4") for c in sorted(used)}
    segs = {c: [x for x in json.loads(
        (run_dir / f"s1_audio_visual_data_fusion/output/{c}.json").read_text())["segments"]
        if x.get("no_speech_prob", 0) <= 0.5] for c in sorted(used)}

    lint = {"noise_db": NOISE_DB, "kill_gap": KILL_GAP, "keep_intra": KEEP_INTRA, "keep_inter": KEEP_INTER,
            "motion_max": MOTION_MAX, "trimmed": [], "skipped": [], "scenes": []}
    before = after = 0.0

    for s in d["scenes"]:
        rolls = s.get("a_roll") or []
        if not rolls:
            continue
        new = []
        for r in rolls:
            c, a, b = r["file"], r["start"], r["end"]
            if c not in fr:
                new.append(dict(r))
                continue
            before += b - a
            # 먼저 후보를 다 모은다
            cand = []
            for gs, ge in sil[c]:
                gs, ge = max(gs, a), min(ge, b)
                if ge - gs <= KILL_GAP:
                    continue
                kind, si = pause_kind(segs[c], gs, ge)
                remove = (ge - gs) - (KEEP_INTRA if kind == "intra" else KEEP_INTER)
                if remove <= 0.05:
                    continue
                cand.append({"gs": gs, "ge": ge, "kind": kind, "si": si, "remove": remove})

            # 문장 안 컷은 문장마다 MAX_CUTS_PER_SENTENCE 개까지. 긴 쉼이 우선이다.
            keep = {id(x) for x in cand if x["kind"] != "intra"}
            by_sent = {}
            for x in cand:
                if x["kind"] == "intra":
                    by_sent.setdefault(x["si"], []).append(x)
            for si, lst in by_sent.items():
                lst.sort(key=lambda x: -x["remove"])
                keep |= {id(x) for x in lst[:MAX_CUTS_PER_SENTENCE]}
                for x in lst[MAX_CUTS_PER_SENTENCE:]:
                    lint["skipped"].append(
                        {"clip": c, "at": round(x["gs"], 2), "sec": round(x["remove"], 2),
                         "kind": "intra", "motion": 0.0,
                         "why": f"한 문장에 컷 {MAX_CUTS_PER_SENTENCE}개까지 — 더 자르면 버벅인다"})

            cuts = []
            for x in [x for x in cand if id(x) in keep]:
                gs, ge, kind, remove = x["gs"], x["ge"], x["kind"], x["remove"]
                hit = best_cut(fr[c], gs, ge, remove)
                if hit is None:
                    continue
                t0, t1, motion = hit
                if motion > MOTION_MAX:
                    lint["skipped"].append(
                        {"clip": c, "at": round(gs, 2), "sec": round(remove, 2),
                         "kind": kind, "motion": round(motion, 4),
                         "why": "쉼 안에서도 인물이 움직인다 — 컷이 보여서 포기"})
                    continue
                cuts.append((t0, t1))
                lint["trimmed"].append(
                    {"clip": c, "kind": kind, "silence": [round(gs, 2), round(ge, 2)],
                     "cut": [round(t0, 2), round(t1, 2)], "saved": round(remove, 2),
                     "motion": round(motion, 4)})
            cur = a
            for t0, t1 in cuts:
                if t0 > cur:
                    new.append({"file": c, "start": round(cur, 2), "end": round(t0, 2)})
                    after += t0 - cur
                cur = t1
            if b > cur:
                new.append({"file": c, "start": round(cur, 2), "end": round(b, 2)})
                after += b - cur
        # s6 가 두 종류의 삭제를 구분할 수 있게, 들어온 구간을 남긴다.
        #   여기 안쪽에서 사라진 것 = 무음 (말은 그대로 → 자막에 살아 있어야 한다)
        #   여기 바깥            = s2 가 내용으로 들어낸 것 (자막에도 없어야 한다)
        s["a_roll_scope"] = [{"file": r["file"], "start": r["start"], "end": r["end"]}
                             for r in rolls]
        s["a_roll"] = new
        lint["scenes"].append({"scene_id": s["scene_id"], "cuts": len(new),
                               "sec": round(sum(x["end"] - x["start"] for x in new), 1)})

    d["meta"]["directive_variant"] = d["meta"].get("directive_variant", "?") + "-tight"
    (out / "directive_tight.json").write_text(json.dumps(d, ensure_ascii=False, indent=1))
    lint.update({"sec_before": round(before, 1), "sec_after": round(after, 1),
                 "saved_sec": round(before - after, 1)})
    (out / "lint.json").write_text(json.dumps(lint, ensure_ascii=False, indent=1))

    print(f"쉼 {len(lint['trimmed'])}곳 줄임 · 포기 {len(lint['skipped'])}곳 · "
          f"{before:.1f}s → {after:.1f}s ({before-after:+.1f}s)")
    for x in lint["scenes"]:
        print(f"  {x['scene_id']}  조각 {x['cuts']:3d}개  {x['sec']:6.1f}s")
    print(f"→ {(out / 'directive_tight.json').resolve()}")


if __name__ == "__main__":
    main()
