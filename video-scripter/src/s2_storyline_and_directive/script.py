#!/usr/bin/env python3
"""지시서 + 전사 → 사람이 읽는 대본.

G1 검수용. 코치가 영상 도구 없이 텍스트만으로 구성을 승인할 수 있게 한다.

usage: script.py <run_dir>
"""
import json
import sys
from pathlib import Path

RUN = Path(sys.argv[1] if len(sys.argv) > 1 else "runs/002")
TR = RUN / "s1_audio_visual_data_fusion" / "output"
S2 = RUN / "s2_storyline_and_directive" / "output"


def tc(s: float) -> str:
    return f"{int(s // 60)}:{s % 60:04.1f}"


def main() -> None:
    d = json.loads((S2 / "directive_A.json").read_text())
    tr = {f["id"]: json.loads((TR / f"{f['id']}.json").read_text())["segments"]
          for f in d["meta"]["source"]["files"]}

    L, t = [], 0.0
    add = L.append
    add(f"# 대본 — {d['meta']['project_id']} (안 {d['meta']['directive_variant']})\n")
    add(f"원본 {len(tr)}개 파일 · 블록 {len(d['storyline'])}개\n")

    for b in d["storyline"]:
        dur = sum(s["end"] - s["start"] for s in b["a_roll"])
        add(f"\n## {b['block_id']} · {b['role']}  ·  {tc(t)}–{tc(t+dur)} ({dur:.0f}초)\n")
        add(f"> {b['note']}\n")
        for seg in b["a_roll"]:
            hits = [s for s in tr[seg["file"]]
                    if s["text"].strip()
                    and s["end"] > seg["start"] and s["start"] < seg["end"]]
            add(f"`{seg['file']} {seg['start']:.1f}–{seg['end']:.1f}`\n")
            if not hits:
                add("(무발화)\n")
            for s in hits:
                add(s["text"].strip())
            add("")
        t += dur

    add(f"\n---\n\n총 **{tc(t)}**")
    p = S2 / "script_A.md"
    p.write_text("\n".join(L) + "\n")
    print(f"→ {p}  ({tc(t)})")


if __name__ == "__main__":
    main()
