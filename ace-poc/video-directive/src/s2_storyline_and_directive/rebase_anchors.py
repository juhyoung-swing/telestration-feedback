#!/usr/bin/env python3
"""오버레이 앵커를 원본 타임코드로 옮긴다.

지금 자막·그래픽·줌·SFX 는 '씬 시작 + n초' 로 붙어 있다.
컷을 바꾸면 그 n초가 가리키는 순간이 달라진다. 오른발을 가리키던 원이
엉뚱한 동작에 얹힌다. 지시서마다 앵커를 다시 잡아야 하는 것도 이 때문이다.

가리키는 대상은 원본 영상의 한 순간이다. 그러니 좌표도 원본이어야 한다.
  {"source_anchor": {"clip": "c01_03", "at": 31.06}}
컷이 어떻게 바뀌든 이 값은 그대로다. 편집 타임라인 위 위치는 s6/s7 이 그때그때 푼다.

A-roll 이 없는 씬(챕터 카드·전환 카드)의 항목은 원본에 대응이 없으므로 씬 앵커로 둔다.

usage: python rebase_anchors.py <timeline.json> <directive.json> [...]
"""
import json
import sys
from pathlib import Path

KINDS = ("subtitles", "graphics", "zoom", "sfx")


def main() -> None:
    tl = json.loads(Path(sys.argv[1]).read_text())
    scene = {s["scene_id"]: s for s in tl["scenes"]}
    blocks = [b for s in tl["scenes"] for b in s["blocks"] if b["kind"] == "a_roll"]

    for path in sys.argv[2:]:
        p = Path(path)
        d = json.loads(p.read_text())
        moved = kept = 0
        for k in KINDS:
            for it in d.get(k, []):
                a = it["anchor"]
                sid = a["scene_id"]
                if sid not in scene:
                    kept += 1
                    continue
                t = scene[sid]["abs_start"] + a["offset_sec"]
                b = next((b for b in blocks if b["abs_start"] <= t < b["abs_end"]), None)
                if b is None:
                    kept += 1          # 검은 카드 위 문구 등. 원본에 대응이 없다
                    continue
                it["source_anchor"] = {"clip": b["file"],
                                       "at": round(b["src_start"] + (t - b["abs_start"]), 2)}
                moved += 1
        d.setdefault("meta", {})["anchor_note"] = (
            "source_anchor 가 있으면 그쪽이 우선이다. 원본 타임코드라 컷이 바뀌어도 따라온다. "
            "없는 항목은 원본에 대응이 없는 것(챕터 카드 등)이라 씬 앵커를 쓴다")
        p.write_text(json.dumps(d, ensure_ascii=False, indent=1))
        print(f"{p.name}  원본 좌표로 옮김 {moved}개 · 씬 앵커 유지 {kept}개")


if __name__ == "__main__":
    main()
