#!/usr/bin/env python3
"""사람이 살린 구간 그대로를 a_roll 로 쓰는 지시서를 만든다 (directive_H).

판단을 우리가 하지 않는다. 편집본 전사에 살아남은 단어의 원본 시각을 그대로 쓴다.
컷 판단에 관해서는 정의상 만점이다.

이걸 왜 만드나. 파이프라인에서 '컷 판단'만 정답으로 바꿔놓고 나머지를 보기 위해서다.
지금 결과가 어색하다면 그게 컷 탓인지, 자막·그래픽·음량 탓인지 갈라야 한다.
이 지시서로 뽑은 영상이 사람 편집본만큼 보인다면 남은 문제는 컷이고,
여전히 어색하다면 문제는 다른 데 있다.

새 영상에는 못 쓴다. 정답지가 없으니까. 그래서 이건 목표지 방법이 아니다.

usage: python make_oracle.py [run_dir]
"""
import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_cuts import ORDER, edited_chars, raw_chars   # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PAD_IN, PAD_OUT = 0.12, 0.25
JOIN_GAP = 0.45     # 이보다 가까우면 한 컷으로 둔다. 잦은 컷은 숨을 끊는다
MIN_SPAN = 0.35     # 이보다 짧게 남은 조각은 버린다. 정렬 노이즈다

# 클립을 어느 씬이 쓰는지. c01_04 만 소품(sc10)과 요약(sc11)으로 갈린다.
SCENE_OF = {"c01_01": "sc02", "c01_02": "sc04", "c01_03": "sc07"}
C04_SPLIT = 110.0


def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "runs/002"
    out = run_dir / "s2_storyline_and_directive/output"

    chars, words = raw_chars(run_dir)
    sm = SequenceMatcher(None, [c["ch"] for c in chars], edited_chars(), autojunk=False)
    hit = [False] * len(chars)
    for a, _b, n in sm.get_matching_blocks():
        for k in range(a, a + n):
            hit[k] = True
    tally = [[0, 0] for _ in words]
    for c, ok in zip(chars, hit):
        tally[c["w"]][ok] += 1

    spans = {c: [] for c in ORDER}
    for w, (no, yes) in zip(words, tally):
        if w["hallu"] or yes < no:
            continue
        a, b = w["a"] - PAD_IN, w["b"] + PAD_OUT
        lst = spans[w["clip"]]
        if lst and a - lst[-1][1] < JOIN_GAP:
            lst[-1][1] = b
        else:
            lst.append([max(0.0, a), b])

    rolls = {}
    for clip, lst in spans.items():
        for a, b in lst:
            if b - a < MIN_SPAN:
                continue
            sid = SCENE_OF.get(clip) or ("sc10" if a < C04_SPLIT else "sc11")
            rolls.setdefault(sid, []).append(
                {"file": clip, "start": round(a, 2), "end": round(b, 2)})

    d = json.loads((out / "directive_E.json").read_text())
    d["meta"]["directive_variant"] = "H"
    d["meta"]["derived_from"] = "사람 편집본 전사와의 글자 정렬. 컷 판단은 우리가 하지 않았다"
    d["meta"]["not_generalizable"] = ("정답지가 있는 이 영상에서만 만들 수 있다. "
                                      "새 영상에는 쓸 수 없다 — 목표지 방법이 아니다")
    d.pop("trim_rules", None)
    d.pop("trim_score_vs_human", None)
    total = 0.0
    for s in d["scenes"]:
        if s["scene_id"] in rolls:
            s["a_roll"] = rolls[s["scene_id"]]
            total += sum(r["end"] - r["start"] for r in s["a_roll"])
    (out / "directive_H.json").write_text(json.dumps(d, ensure_ascii=False, indent=1))

    n = sum(len(v) for v in rolls.values())
    print(f"컷 {n}개 · 발화 구간 {total:.1f}s ({int(total//60)}:{total%60:04.1f})")
    for sid in ("sc02", "sc04", "sc07", "sc10", "sc11"):
        v = rolls.get(sid, [])
        print(f"  {sid}  컷 {len(v):3d}개  "
              f"{sum(r['end']-r['start'] for r in v):6.1f}s")
    print(f"→ {out / 'directive_H.json'}")


if __name__ == "__main__":
    main()
