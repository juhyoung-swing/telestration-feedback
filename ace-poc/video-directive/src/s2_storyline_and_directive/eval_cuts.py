#!/usr/bin/env python3
"""지시서의 컷을 사람 편집본과 대조해 채점한다.

판정 단위는 '원본의 단어 하나'다. 침묵은 채점하지 않는다 —
글자 정렬로는 사람이 침묵을 얼마나 줄였는지 알 수 없고,
모르는 걸 맞았다고 세면 점수가 부풀기 때문이다.

각 단어에 두 판정이 붙는다.
  사람  : 편집본 전사에 살아남았나 (글자 단위 정렬)
  지시서 : a_roll 구간 안에 들어 있나

  둘 다 살림 → TP   둘 다 버림 → TN
  사람만 버림 → 놓친 컷(FN)   사람만 살림 → 잘라먹음(FP)

usage: python eval_cuts.py [run_dir] [directive.json ...]
"""
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ORDER = ["c01_01", "c01_02", "c01_03", "c01_04"]


def norm(s: str) -> str:
    return re.sub(r"[^\w가-힣]", "", s)


def raw_chars(run_dir: Path):
    """글자 하나가 원소. 어느 단어에 속했는지 함께 들고 다닌다."""
    chars, words = [], []
    for c in ORDER:
        segs = json.loads(
            (run_dir / f"s1_audio_visual_data_fusion/output/{c}.json").read_text())["segments"]
        for s in segs:
            for w in s.get("words", []):
                t = norm(w["word"])
                if not t:
                    continue
                wi = len(words)
                words.append({"clip": c, "a": w["start"], "b": w["end"], "t": t,
                              "hallu": s.get("no_speech_prob", 0) > 0.5})
                chars.extend({"ch": ch, "w": wi} for ch in t)
    return chars, words


def edited_chars():
    segs = json.loads(
        (ROOT / "edited/lecture_forehand.transcript.json").read_text())["segments"]
    return [ch for s in segs for ch in norm(s["text"].replace(" ", ""))]


def spans_of(directive: Path):
    d = json.loads(directive.read_text())
    out = []
    for s in d["scenes"]:
        for r in s.get("a_roll") or []:
            if r["file"] in ORDER:
                out.append((r["file"], r["start"], r["end"]))
    return out


def main() -> None:
    argv = sys.argv[1:]
    run_dir = Path(argv[0]) if argv and not argv[0].endswith(".json") else ROOT / "runs/002"
    given = [Path(a) for a in argv if a.endswith(".json")]
    out_dir = run_dir / "s2_storyline_and_directive/output"
    targets = given or [out_dir / "directive_D.json", out_dir / "directive_E.json"]

    chars, words = raw_chars(run_dir)
    sm = SequenceMatcher(None, [c["ch"] for c in chars], edited_chars(), autojunk=False)
    hit = [False] * len(chars)
    for a, _b, n in sm.get_matching_blocks():
        for k in range(a, a + n):
            hit[k] = True
    # 단어의 글자 절반 이상이 편집본에 남았으면 그 단어는 사람이 살린 것으로 본다.
    tally = [[0, 0] for _ in words]
    for c, ok in zip(chars, hit):
        tally[c["w"]][ok] += 1
    for w, (no, yes) in zip(words, tally):
        w["human"] = yes >= no

    # 환각 단어는 채점에서 뺀다. 원래 말이 아니라 whisper 가 지어낸 것이라
    # 이걸 자른 걸 편집 실력으로 셀 수 없다.
    real = [w for w in words if not w["hallu"]]
    hallu_sec = sum(w["b"] - w["a"] for w in words if w["hallu"])

    report = {"words_total": len(words), "words_scored": len(real),
              "hallucination_sec_excluded": round(hallu_sec, 1), "directives": {}}
    rows = []
    for t in targets:
        if not t.exists():
            continue
        sp = spans_of(t)

        def kept(w):
            return any(c == w["clip"] and a <= w["a"] and w["b"] <= b for c, a, b in sp)

        tp = tn = fp = fn = 0.0
        misses, overs = [], []
        for w in real:
            sec = w["b"] - w["a"]
            k = kept(w)
            if w["human"] and k:
                tp += sec
            elif not w["human"] and not k:
                tn += sec
            elif not w["human"] and k:
                fn += sec
                misses.append(w)
            else:
                fp += sec
                overs.append(w)
        tot = tp + tn + fp + fn
        cut_h = tn + fn                       # 사람이 자른 양
        cut_o = tn + fp                       # 우리가 자른 양
        prec = tn / cut_o if cut_o else 0.0   # 우리가 자른 것 중 사람도 자른 비율
        rec = tn / cut_h if cut_h else 0.0    # 사람이 자른 것 중 우리도 자른 비율
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        report["directives"][t.stem] = {
            "agree_pct": round((tp + tn) / tot * 100, 1),
            "kept_by_both_sec": round(tp, 1), "cut_by_both_sec": round(tn, 1),
            "missed_cut_sec": round(fn, 1), "overcut_sec": round(fp, 1),
            "human_cut_sec": round(cut_h, 1), "our_cut_sec": round(cut_o, 1),
            "cut_precision": round(prec, 3), "cut_recall": round(rec, 3),
            "cut_f1": round(f1, 3),
            "top_missed": [{"clip": w["clip"], "at": round(w["a"], 1), "t": w["t"]}
                           for w in misses[:30]],
            "top_overcut": [{"clip": w["clip"], "at": round(w["a"], 1), "t": w["t"]}
                            for w in overs[:30]]}
        rows.append((t.stem, report["directives"][t.stem]))

    (out_dir / "eval_cuts.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))

    print(f"채점 단위: 원본 발화 단어 {len(real)}개 "
          f"(환각 {hallu_sec:.0f}초는 제외)\n")
    print(f'{"":10s} {"일치율":>7s} {"둘다살림":>9s} {"둘다버림":>9s} '
          f'{"놓친컷":>8s} {"잘라먹음":>9s} {"정밀도":>7s} {"재현율":>7s} {"F1":>6s}')
    for name, r in rows:
        print(f'{name:10s} {r["agree_pct"]:6.1f}% {r["kept_by_both_sec"]:8.1f}s '
              f'{r["cut_by_both_sec"]:8.1f}s {r["missed_cut_sec"]:7.1f}s '
              f'{r["overcut_sec"]:8.1f}s {r["cut_precision"]:7.2f} '
              f'{r["cut_recall"]:7.2f} {r["cut_f1"]:6.2f}')
    print(f'\n→ {out_dir / "eval_cuts.json"}')


if __name__ == "__main__":
    main()
