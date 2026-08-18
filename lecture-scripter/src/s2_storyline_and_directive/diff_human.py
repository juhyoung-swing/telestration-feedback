#!/usr/bin/env python3
"""사람 편집본이 원본에서 무엇을 잘라냈는지 알아내고, 우리 지시서와 대조한다.

편집본 analysis.json 은 편집 타임코드라 원본 좌표로 바로 못 옮긴다.
대신 두 전사의 '단어 나열'을 정렬한다. 편집본에 남은 단어 = 사람이 살린 말,
정렬에서 빠진 원본 단어 = 사람이 버린 말. 이게 컷의 정답지다.

그 다음 우리 directive_D 의 a_roll 구간과 겹쳐서
  사람도 버리고 우리도 버림  → 맞춘 컷
  사람은 버렸는데 우리는 남김 → 놓친 컷
  사람은 남겼는데 우리가 버림 → 과잉 컷
를 센다.

output/human_diff.json + human_diff.md

usage: python diff_human.py [run_dir]
"""
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ORDER = ["c01_01", "c01_02", "c01_03", "c01_04"]   # 무발화 클립은 뺀다
MIN_CUT = 0.4                                       # 이보다 짧은 틈은 컷으로 세지 않는다


def norm(w: str) -> str:
    return re.sub(r"[^\w가-힣]", "", w.strip())


def raw_words(run_dir: Path) -> list:
    """글자 하나를 원소로 둔다. 두 전사의 띄어쓰기가 달라도('거리 잡기'/'거리잡기')
    정렬이 흔들리지 않게 하려는 것이다. 단어 단위로 맞추면 안 잘린 말이
    잘렸다고 나온다."""
    out = []
    for c in ORDER:
        segs = json.loads(
            (run_dir / f"s1_audio_visual_data_fusion/output/{c}.json").read_text())["segments"]
        for s in segs:
            for w in s.get("words", []):
                t = norm(w["word"])
                n = len(t)
                for k, ch in enumerate(t):
                    out.append({"t": ch, "clip": c,
                                "a": w["start"] + (w["end"] - w["start"]) * k / n,
                                "b": w["start"] + (w["end"] - w["start"]) * (k + 1) / n,
                                "w": t})
    return out


def edited_words() -> list:
    segs = json.loads(
        (ROOT / "edited/lecture_forehand.transcript.json").read_text())["segments"]
    out = []
    for s in segs:
        for ch in norm(s["text"].replace(" ", "")):
            out.append({"t": ch, "a": s["start"], "b": s["end"]})
    return out


def runs_of(flags: list, want: bool):
    i = 0
    while i < len(flags):
        if flags[i] is want:
            j = i
            while j + 1 < len(flags) and flags[j + 1] is want:
                j += 1
            yield i, j
            i = j + 1
        else:
            i += 1


def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "runs/002"
    out = run_dir / "s2_storyline_and_directive/output"
    rw, ew = raw_words(run_dir), edited_words()

    sm = SequenceMatcher(None, [w["t"] for w in rw], [w["t"] for w in ew], autojunk=False)
    kept = [False] * len(rw)
    for a, _b, n in sm.get_matching_blocks():
        for k in range(a, a + n):
            kept[k] = True

    # 우리 지시서가 남긴 구간
    d = json.loads((out / "directive_D.json").read_text())
    ours = []
    for s in d["scenes"]:
        for r in s.get("a_roll") or []:
            if r["file"] in ORDER:
                ours.append((r["file"], r["start"], r["end"]))

    def we_kept(w) -> bool:
        return any(c == w["clip"] and a <= w["a"] and w["b"] <= b for c, a, b in ours)

    cuts, matched, missed = [], 0.0, 0.0
    for i, j in runs_of(kept, False):
        if rw[i]["clip"] != rw[j]["clip"]:
            continue
        a, b = rw[i]["a"], rw[j]["b"]
        if b - a < MIN_CUT:
            continue
        we = sum(1 for k in range(i, j + 1) if we_kept(rw[k])) / (j - i + 1)
        cuts.append({"clip": rw[i]["clip"], "start": round(a, 2), "end": round(b, 2),
                     "sec": round(b - a, 2), "chars": j - i + 1,
                     "text": "".join(rw[k]["t"] for k in range(i, j + 1)),
                     "we_kept_ratio": round(we, 2)})
        (matched, missed) = (matched, missed + (b - a)) if we > 0.5 else (matched + (b - a), missed)

    over = []
    for i, j in runs_of(kept, True):
        if rw[i]["clip"] != rw[j]["clip"]:
            continue
        dropped = [k for k in range(i, j + 1) if not we_kept(rw[k])]
        if not dropped:
            continue
        a, b = rw[dropped[0]]["a"], rw[dropped[-1]]["b"]
        if b - a < MIN_CUT:
            continue
        over.append({"clip": rw[i]["clip"], "start": round(a, 2), "end": round(b, 2),
                     "sec": round(b - a, 2),
                     "text": "".join(rw[k]["t"] for k in dropped)})

    raw_sec = sum(w["b"] - w["a"] for w in rw)
    cut_sec = sum(c["sec"] for c in cuts)
    res = {"raw_words": len(rw), "edited_words": len(ew),
           "kept_words": sum(kept), "keep_ratio": round(sum(kept) / len(rw), 3),
           "human_cuts": len(cuts), "human_cut_sec": round(cut_sec, 1),
           "we_also_cut_sec": round(matched, 1), "we_missed_sec": round(missed, 1),
           "we_overcut_sec": round(sum(o["sec"] for o in over), 1),
           "cuts": sorted(cuts, key=lambda c: -c["sec"]),
           "overcuts": sorted(over, key=lambda c: -c["sec"])}
    (out / "human_diff.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))

    L = [f"# 사람 편집본이 잘라낸 것 vs 우리 지시서\n",
         f"원본 발화 글자 {len(rw)} · 편집본에 살아남은 글자 {sum(kept)} "
         f"(**{sum(kept)/len(rw)*100:.0f}%**)\n",
         f"사람이 잘라낸 구간 **{len(cuts)}개 / {cut_sec:.0f}초**\n",
         f"- 우리도 잘라낸 것 **{matched:.0f}초**",
         f"- 우리가 놓친 것 **{missed:.0f}초** ← 여기가 할 일",
         f"- 사람은 살렸는데 우리가 버린 것 **{sum(o['sec'] for o in over):.0f}초**\n",
         "## 사람이 잘라낸 구간 (긴 순)\n",
         "| 클립 | 원본 시각 | 길이 | 우리도 잘랐나 | 잘려나간 말 |",
         "|---|---|---|---|---|"]
    for c in cuts[:40]:
        mark = "○ 잘랐음" if c["we_kept_ratio"] <= 0.5 else "**✕ 남겨둠**"
        L.append(f'| {c["clip"]} | {c["start"]:.1f}–{c["end"]:.1f} | {c["sec"]:.1f}s | '
                 f'{mark} | {c["text"][:70]} |')
    if over:
        L += ["\n## 사람은 살렸는데 우리가 버린 구간\n",
              "| 클립 | 원본 시각 | 길이 | 버린 말 |", "|---|---|---|---|"]
        for o in over[:25]:
            L.append(f'| {o["clip"]} | {o["start"]:.1f}–{o["end"]:.1f} | {o["sec"]:.1f}s | '
                     f'{o["text"][:70]} |')
    (out / "human_diff.md").write_text("\n".join(L) + "\n")

    print(f"원본 {len(rw)}자 → 편집본에 {sum(kept)}자 남음 ({sum(kept)/len(rw)*100:.0f}%)")
    print(f"사람 컷 {len(cuts)}개 {cut_sec:.0f}초 · 우리도 자름 {matched:.0f}초 · "
          f"놓침 {missed:.0f}초 · 과잉 {sum(o['sec'] for o in over):.0f}초")
    print(f"→ {(out / 'human_diff.md')}")


if __name__ == "__main__":
    main()
