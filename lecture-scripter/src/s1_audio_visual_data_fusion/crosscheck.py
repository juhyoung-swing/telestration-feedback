#!/usr/bin/env python3
"""오디오 패스 ↔ 시각 패스 교차검증.

Gemini 가 잘라내라고 한 구간에 발화가 얼마나 있었나?
Gemini 가 놓친 무음 구간은 어디인가?

판정하지 않는다. 숫자만 낸다. 판단은 사람이 한다.
"""
import json
import sys
from pathlib import Path

RUN = Path(sys.argv[1] if len(sys.argv) > 1 else "runs/001")
OUT = RUN / "s1_audio_visual_data_fusion" / "output"
GAP_MIN = 1.5  # 무음으로 볼 최소 공백


def tc(s: float) -> str:
    return f"{int(s // 60)}:{s % 60:04.1f}"


def overlap(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def main() -> None:
    tr = json.loads((OUT / "transcript.json").read_text())
    vis = json.loads((OUT / "visual_events.json").read_text())
    segs = [s for s in tr["segments"] if s["text"].strip()]
    dur = vis.get("_meta", {}).get("duration_sec", segs[-1]["end"])
    covered = vis.get("_meta", {}).get("covered_until_sec", dur)

    L = []
    add = L.append
    add("# s1 교차검증 — 오디오 ↔ 시각\n")
    add(f"원본 {dur:.1f}초 · 발화 세그먼트 {len(segs)}개 · "
        f"시각 패스 분석 범위 0~{covered:.0f}초 "
        f"({covered/dur*100:.0f}%)\n")

    # 1. exclusion 에 겹치는 발화
    add("\n## exclusions — 잘라낸 구간에 발화가 있었나\n")
    add("| 구간 | 길이 | 겹친 발화 | 비율 | reason | 겹친 문장 |")
    add("|---|---|---|---|---|---|")
    for e in vis["exclusions"]:
        ln = e["end"] - e["start"]
        hits = [(s, overlap(e["start"], e["end"], s["start"], s["end"]))
                for s in segs]
        hits = [(s, o) for s, o in hits if o > 0]
        spoken = sum(o for _, o in hits)
        txt = " / ".join(s["text"].strip() for s, _ in hits[:3]) or "—"
        if len(hits) > 3:
            txt += f" … (+{len(hits)-3})"
        add(f"| {tc(e['start'])}–{tc(e['end'])} | {ln:.1f}초 | **{spoken:.1f}초** | "
            f"{spoken/ln*100:.0f}% | {e['reason']} | {txt} |")

    # 2. protected 에 겹치는 발화
    add("\n## protected — 보호 구간의 발화량\n")
    add("| 구간 | 길이 | 겹친 발화 | 비율 | reason |")
    add("|---|---|---|---|---|")
    for p in vis["protected"]:
        ln = p["end"] - p["start"]
        spoken = sum(overlap(p["start"], p["end"], s["start"], s["end"])
                     for s in segs)
        add(f"| {tc(p['start'])}–{tc(p['end'])} | {ln:.1f}초 | {spoken:.1f}초 | "
            f"{spoken/ln*100:.0f}% | {p['reason']} |")

    # 3. 전사상 무음 구간 ↔ 시각 패스가 잡았나
    gaps = []
    if segs[0]["start"] >= GAP_MIN:
        gaps.append((0.0, segs[0]["start"]))
    for a, b in zip(segs, segs[1:]):
        if b["start"] - a["end"] >= GAP_MIN:
            gaps.append((a["end"], b["start"]))
    if dur - segs[-1]["end"] >= GAP_MIN:
        gaps.append((segs[-1]["end"], dur))

    add(f"\n## 무음 구간 {len(gaps)}개 — 시각 패스가 판정했나\n")
    add("| 무음 구간 | 길이 | protected 겹침 | exclusion 겹침 | 판정 |")
    add("|---|---|---|---|---|")
    missed = 0
    for g0, g1 in gaps:
        ln = g1 - g0
        po = sum(overlap(g0, g1, p["start"], p["end"]) for p in vis["protected"])
        eo = sum(overlap(g0, g1, e["start"], e["end"]) for e in vis["exclusions"])
        if g0 >= covered:
            verdict = "미분석 구간"
        elif po > ln * 0.5:
            verdict = "보호됨"
        elif eo > ln * 0.5:
            verdict = "제외됨"
        else:
            verdict = "**판정 없음**"
            missed += 1
        add(f"| {tc(g0)}–{tc(g1)} | {ln:.1f}초 | {po:.1f}초 | {eo:.1f}초 | {verdict} |")

    # 4. 요약
    ex_total = sum(e["end"] - e["start"] for e in vis["exclusions"])
    ex_spoken = sum(
        sum(overlap(e["start"], e["end"], s["start"], s["end"]) for s in segs)
        for e in vis["exclusions"])
    add("\n## 요약\n")
    add(f"- 제외 합계 **{ex_total:.0f}초** ({ex_total/dur*100:.0f}%) — "
        f"그중 발화가 **{ex_spoken:.0f}초**")
    add(f"- 무음 구간 {len(gaps)}개 중 **{missed}개가 판정 없음**")
    add(f"- 미분석 {dur-covered:.0f}초 ({(dur-covered)/dur*100:.0f}%)")

    p = OUT / "crosscheck.md"
    p.write_text("\n".join(L) + "\n")
    print("\n".join(L))
    print(f"\n→ {p}")


if __name__ == "__main__":
    main()
