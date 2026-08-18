#!/usr/bin/env python3
"""편집본 참조 자료 3종을 씬 단위로 합친다.

analysis.json (구조·자막·그래픽·SFX·줌·전환) +
composition.json (구도) +
transcript.json (발화)
  → merged.json + sheet.md

발화 자막의 실제 화면 문구는 어디에도 없다. 그 자리는 비었다고 표시한다.
"""
import json
from pathlib import Path

E = Path("edited")


def sec(tc: str) -> float:
    m, s = tc.split(":")
    return int(m) * 60 + float(s)


def tc(s: float) -> str:
    return f"{int(s // 60)}:{s % 60:04.1f}"


def main() -> None:
    an = json.loads((E / "lecture_forehand.analysis.json").read_text())
    co = {c["scene_id"]: c["composition"]
          for c in json.loads((E / "lecture_forehand.composition.json").read_text())["scenes"]}
    tr = json.loads((E / "lecture_forehand.transcript.json").read_text())["segments"]

    merged, L = [], []
    add = L.append
    add("# 편집본 씬 시트 — lecture_forehand 8:03\n")
    add("analysis + composition + transcript 를 씬 단위로 합친 것. "
        "**하단 발화 자막의 실제 화면 문구는 자료에 없다** — 그 줄은 비어 있다.\n")

    for s in an["scenes"]:
        a, b = sec(s["span"]["start"]), sec(s["span"]["end"])
        speech = [t["text"].strip() for t in tr
                  if t["text"].strip() and t["end"] > a and t["start"] < b]
        c = co.get(s["scene_id"], {})
        sp = c.get("subject_position", {})
        sz = c.get("subject_size", {})
        ns = c.get("negative_space", {})
        rf = c.get("reframe_trace", {})

        merged.append({**s, "composition": c, "speech": speech,
                       "speech_subtitle_text": None})

        add(f"\n---\n\n## {s['scene_id']} · {s['type']} · {s['span']['start']}–{s['span']['end']} "
            f"({b-a:.1f}초) · 밀도 {s['density']}\n")
        add(f"**{s['function']}**\n")

        add(f"| 구도 | 인물 {sp.get('horizontal_pct','—')}% · "
            f"키 {sz.get('height_ratio_pct','—')}% · 헤드룸 {sz.get('headroom_pct','—')}% · "
            f"{sz.get('shot_scale','—')} |")
        add("|---|---|")
        add(f"| 여백 | {ns.get('zone','—')} → {ns.get('occupied_by','—')} |")
        add(f"| 리프레임 | {rf.get('type','—')} {('· ' + rf['note']) if rf.get('note') else ''} |")
        add(f"| 오디오 | {s['audio_source']['type']} — {s['audio_source']['note']} |")
        add(f"| 전환 | in {s['transition_in']['type']} / out {s['transition_out']['type']} "
            f"{s['transition_out']['elements'] or ''} |")
        add(f"| BGM | {s['bgm']['character']} |\n")

        if c.get("internal_shifts"):
            for sh in c["internal_shifts"]:
                add(f"- 구도 이동 `{sh['at']}` {sh['from_pct']}% → {sh['to_pct']}% — {sh['trigger']}")
            add("")

        add("**발화**")
        add("```")
        add("\n".join(speech) if speech else "(무발화)")
        add("```")
        add("**하단 발화 자막 문구** — `자료 없음` (편집본 화면에서 옮겨 적어야 함)\n")

        if s["subtitles"]:
            add("**자막**")
            for x in s["subtitles"]:
                add(f"- `{x['span']['start']}` **{x['text']}** "
                    f"· {x['kind']} · {x['position']} · {x['size']} · {x['style_note']}")
            add("")
        if s["graphics"]:
            add("**그래픽**")
            for g in s["graphics"]:
                add(f"- `{g['span']['start']}` {g['shape']} → {g['target']} "
                    f"· {g['color']} · {g['position']}")
            add("")
        if s["zoom"]:
            add("**줌**")
            for z in s["zoom"]:
                add(f"- `{z['at']}` {z['direction']} {z['intensity']} ({z['style']}) — {z['context']}")
            add("")
        if s["sfx"]:
            add("**SFX** " + " / ".join(f"`{x['at']}` {x['kind']}" for x in s["sfx"]) + "\n")

    (E / "lecture_forehand.merged.json").write_text(
        json.dumps({"meta": an["meta"], "scenes": merged,
                    "scene_type_patterns": an["scene_type_patterns"],
                    "transition_map": an["transition_map"],
                    "zoom_grammar": an["zoom_grammar"],
                    "density_map": an["density_map"],
                    "composition_grammar": json.loads(
                        (E / "lecture_forehand.composition.json").read_text())["composition_grammar"]},
                   ensure_ascii=False, indent=1))
    (E / "lecture_forehand.sheet.md").write_text("\n".join(L) + "\n")
    print(f"씬 {len(merged)} · 발화 있는 씬 {sum(1 for m in merged if m['speech'])}")
    print("→ edited/lecture_forehand.merged.json")
    print("→ edited/lecture_forehand.sheet.md")


if __name__ == "__main__":
    main()
