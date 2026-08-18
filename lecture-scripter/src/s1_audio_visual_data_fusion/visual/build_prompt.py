#!/usr/bin/env python3
"""전사 JSON + 프롬프트 템플릿 → 붙여넣기용 프롬프트 파일.

usage: build_prompt.py <transcript.json> <out.txt>

whisper 반복 루프(같은 문장 연속)는 그대로 두지 않고 한 줄로 접는다.
헛소리로 채워진 구간을 Gemini 에게 "여긴 말이 없었다"로 보이게 만들어야
silent_demo 마킹이 걸린다.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent


def tc(s: float) -> str:
    return f"{int(s // 60):02d}:{s % 60:05.2f}"


def lines(segs: list) -> list[str]:
    out, prev, run_start, run_n = [], None, None, 0

    def flush():
        if prev is None:
            return
        if run_n > 1:
            out.append(f"[{tc(run_start)}] (같은 문장 {run_n}회 반복 — 전사 신뢰 불가) {prev}")
        else:
            out.append(f"[{tc(run_start)}] {prev}")

    for s in segs:
        t = s["text"].strip()
        if not t:
            continue
        if t == prev:
            run_n += 1
            continue
        flush()
        prev, run_start, run_n = t, s["start"], 1
    flush()
    return out


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    d = json.loads(src.read_text())
    segs = d.get("segments", [])

    body = "\n".join(lines(segs)) if segs else "(전사 결과가 비어 있다 — 이 영상에는 발화가 없다)"
    tmpl = (HERE / "prompt.txt").read_text()

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(tmpl.replace("{{TRANSCRIPT}}", body))

    print(f"{src.name} → {dst}")
    print(f"  세그먼트 {len(segs)} → 전사 {len(body.splitlines())}줄")


if __name__ == "__main__":
    main()
