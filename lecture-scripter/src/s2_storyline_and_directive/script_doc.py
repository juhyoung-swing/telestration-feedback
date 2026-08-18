#!/usr/bin/env python3
"""지시서 → 편집자에게 넘기는 대본.

대표의 질문은 "영상을 대본화해서 편집자에게 맡기면 되냐" 였다.
그러려면 대본이 두 가지를 만족해야 한다.

  읽을 수 있어야 한다 — 완성 영상 타임스탬프 순서로, 편집 정보 없이 내용만
  되짚을 수 있어야 한다 — 각 대사가 원본 어느 파일 몇 초에서 왔는지

그래서 이 파일은 하나의 원천(지시서 + 전사)에서 둘 다 뽑는다.
사람이 옮겨 적지 않으니 둘이 어긋날 수 없다.

output: docs/script.md · docs/script.html

usage: python script_doc.py [run_dir] [directive.json]
"""
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLIPS = ("c01_01", "c01_02", "c01_03", "c01_04")

ROLE = {"intro": "인트로", "opening": "목차", "chapter_open": "챕터카드",
        "concept": "개념", "demo": "시범", "drill": "드릴", "prop": "개념·소품",
        "summary": "요약", "montage": "이미지 트레이닝"}
TITLE = {"sc01": "인트로", "sc02": "목차", "sc03": "챕터카드 · 시선(거리잡기)",
         "sc04": "개념 1 · 시선과 거리", "sc05": "시범 1 · 유닛턴",
         "sc06": "챕터카드 · 골반사용(회전)", "sc07": "개념 2 · 골반 회전",
         "sc07b": "시범 2 · 골반 회전", "sc08": "홈트레이닝 드릴",
         "sc09": "챕터카드 · 피니시 자세", "sc10": "개념 3 · 피니시 공간",
         "sc11": "요약", "sc12": "이미지 트레이닝"}


def load_fix():
    """전사 오류 교정 사전. 코드가 아니라 glossary/corrections.json 이 원천이다.
    긴 항목부터 적용해야 짧은 항목이 먼저 걸리는 걸 막는다."""
    p = ROOT / "glossary/corrections.json"
    rules = json.loads(p.read_text())["rules"] if p.exists() else []
    rules = sorted(rules, key=lambda r: -len(r[0]))

    def fix(t: str) -> str:
        for a, b in rules:
            t = t.replace(a, b)
        return t
    return fix


def tc(s: float) -> str:
    return f"{int(s // 60):02d}:{s % 60:04.1f}"


def main() -> None:
    argv = sys.argv[1:]
    run_dir = Path(argv[0]) if argv and not argv[0].endswith(".json") else ROOT / "runs/002"
    src = Path(argv[-1]) if argv and argv[-1].endswith(".json") else \
        run_dir / "s2_storyline_and_directive/output/directive_H.json"
    d = json.loads(src.read_text())
    fix = load_fix()
    tr = {c: json.loads((run_dir / f"s1_audio_visual_data_fusion/output/{c}.json").read_text())["segments"]
          for c in CLIPS}

    def speech(rolls):
        out = []
        for r in rolls:
            if r["file"] not in tr:
                continue
            for s in tr[r["file"]]:
                if s.get("no_speech_prob", 0) > 0.5:
                    continue
                if s["end"] > r["start"] and s["start"] < r["end"]:
                    t = fix(s["text"].strip())
                    if t and (not out or out[-1] != t):
                        out.append(t)
        return out

    rows, t = [], 0.0
    for s in d["scenes"]:
        rolls = s.get("a_roll") or []
        dur = sum(r["end"] - r["start"] for r in rolls) or s.get("duration_sec", 0.0)
        rows.append({"id": s["scene_id"], "role": s["role"], "at": t, "dur": dur,
                     "on": s.get("enabled", True), "blocked": s.get("blocked_by", []),
                     "note": s.get("note", ""), "rolls": rolls, "speech": speech(rolls)})
        t += dur
    total = t

    # ── 마크다운 ──────────────────────────────────────────────────────────
    M = [f"# 포핸드 핵심 세 가지 · 대본\n",
         f"김기준 코치 · 완성 길이 **{tc(total)}** · 블록 {len(rows)}개\n",
         "타임스탬프는 완성 영상 기준. 원본 출처는 각 블록 머리에 적었다.\n",
         "⚠️ 표시는 원본에 소재가 없어 새로 만들어야 하는 블록.\n", "---\n"]
    for r in rows:
        M.append(f"\n## {tc(r['at'])} — {TITLE.get(r['id'], r['id'])}"
                 f"{'  ⚠️' if not r['on'] else ''}\n")
        M.append(f"`{r['id']}` · {ROLE.get(r['role'], r['role'])} · {r['dur']:.1f}초\n")
        if r["rolls"]:
            M.append("출처 " + " + ".join(
                f"`{x['file']} {x['start']:.2f}–{x['end']:.2f}`" for x in r["rolls"][:6])
                + (f" 외 {len(r['rolls'])-6}구간" if len(r["rolls"]) > 6 else "") + "\n")
        if not r["on"]:
            M.append(f"\n> **필요한 것** — `{', '.join(r['blocked'])}`\n>\n> {r['note']}\n")
        elif r["speech"]:
            M.append("\n```\n" + "\n".join(r["speech"]) + "\n```\n")
        elif r["role"] == "chapter_open":
            M.append("\n> 검은 화면 · 챕터 제목만\n")
        else:
            M.append("\n> 무발화 — 시범 화면\n")
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs/script.md").write_text("\n".join(M))

    # ── HTML ─────────────────────────────────────────────────────────────
    H = [f"<header><p class='eyebrow'>Script</p><h1>포핸드 핵심 세 가지</h1>",
         f"<p class='meta'>김기준 코치 · 완성 {tc(total)} · 블록 {len(rows)}개</p>",
         "<p class='goal'>타임스탬프는 완성 영상 기준입니다. 각 블록에 원본 파일과 초를 적어",
         "두었으니 편집자가 그대로 찾아 쓰면 됩니다. ⚠️ 는 원본에 소재가 없어 새로 만들어야",
         "하는 블록입니다.</p></header>"]
    for r in rows:
        cls = "blk" + ("" if r["on"] else " off")
        H.append(f"<section class='{cls}'><div class='hd'>")
        H.append(f"<span class='t'>{tc(r['at'])}</span>"
                 f"<h2>{html.escape(TITLE.get(r['id'], r['id']))}"
                 f"{' <em>⚠️ 신규 제작</em>' if not r['on'] else ''}</h2>")
        H.append(f"<p class='m'>{r['id']} · {ROLE.get(r['role'], r['role'])} · {r['dur']:.1f}초</p>")
        if r["rolls"]:
            H.append("<p class='src'>" + " + ".join(
                f"<code>{x['file']} {x['start']:.2f}–{x['end']:.2f}</code>"
                for x in r["rolls"][:6])
                + (f" <span class='more'>외 {len(r['rolls'])-6}구간</span>"
                   if len(r["rolls"]) > 6 else "") + "</p>")
        H.append("</div>")
        if not r["on"]:
            H.append(f"<div class='need'><b>필요한 것</b> <code>"
                     f"{html.escape(', '.join(r['blocked']))}</code>"
                     f"<div>{html.escape(r['note'])}</div></div>")
        elif r["speech"]:
            H.append("<div class='say'>" + "".join(
                f"<p>{html.escape(x)}</p>" for x in r["speech"]) + "</div>")
        else:
            H.append("<div class='silent'>"
                     + ("검은 화면 · 챕터 제목만" if r["role"] == "chapter_open"
                        else "무발화 — 시범 화면") + "</div>")
        H.append("</section>")

    (ROOT / "docs/script.html").write_text(
        '<!doctype html><html lang=ko><head><meta charset=utf-8>'
        '<meta name=viewport content="width=device-width,initial-scale=1">'
        "<title>포핸드 핵심 세 가지 · 대본</title><style>" + CSS + "</style></head>"
        "<body><main>" + "".join(H) + "</main></body></html>")

    said = sum(1 for r in rows if r["speech"])
    print(f"블록 {len(rows)}개 · 발화 블록 {said}개 · 신규 제작 "
          f"{sum(1 for r in rows if not r['on'])}개 · 완성 {tc(total)}")
    print(f"→ {(ROOT / 'docs/script.md')}")
    print(f"→ {(ROOT / 'docs/script.html')}")


CSS = """
:root{--navy:#17335F;--yellow:#E4EF3D;--ink:#1B2233;--soft:#67718A;--rule:#E4E7EE;--card:#fff}
*{box-sizing:border-box}
body{margin:0;background:#DDE0E7;color:var(--ink);line-height:1.7;word-break:keep-all;
 font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo",-apple-system,system-ui,sans-serif}
main{max-width:720px;margin:0 auto;background:#F4F5F8}
@media(min-width:760px){main{margin:24px auto;border-radius:18px;overflow:hidden}}
header{background:var(--navy);color:#fff;padding:30px 26px 26px}
.eyebrow{font-size:.7rem;letter-spacing:.16em;color:var(--yellow);margin:0 0 10px;font-weight:700}
header h1{margin:0 0 6px;font-size:1.6rem;font-weight:800;letter-spacing:-.02em}
header .meta{margin:0 0 14px;font-size:.84rem;color:#B9C3D8;font-weight:500}
header .goal{margin:0;font-size:.9rem;color:#E7EBF4}
.blk{background:var(--card);margin:12px 0;padding:20px 26px 22px}
.blk.off{background:#FAFAF2;border-left:4px solid var(--yellow)}
.hd .t{display:inline-block;background:var(--navy);color:#fff;font-weight:800;font-size:.72rem;
 letter-spacing:.06em;padding:3px 10px;border-radius:999px;font-family:ui-monospace,Menlo,monospace}
.hd h2{margin:10px 0 3px;font-size:1.1rem;font-weight:800;letter-spacing:-.015em}
.hd h2 em{font-style:normal;font-size:.72rem;color:#8A7B12;font-weight:700}
.hd .m{margin:0 0 6px;font-size:.78rem;color:var(--soft)}
.src{margin:0 0 4px;font-size:.74rem;color:var(--soft)}
.src code{background:#EEF0F5;padding:1px 6px;border-radius:4px;
 font-family:ui-monospace,Menlo,monospace;font-size:.72rem}
.more{font-size:.72rem}
.say{margin-top:14px;border-left:3px solid var(--rule);padding-left:15px}
.say p{margin:0 0 6px;font-size:.95rem}
.say p:last-child{margin-bottom:0}
.silent{margin-top:12px;font-size:.86rem;color:var(--soft);font-style:italic}
.need{margin-top:12px;background:#FBFCEF;border-left:3px solid var(--yellow);padding:12px 15px;
 font-size:.88rem;border-radius:0 6px 6px 0}
.need code{font-family:ui-monospace,Menlo,monospace;font-size:.8rem}
.need div{color:var(--soft);margin-top:5px;font-size:.84rem}
"""


if __name__ == "__main__":
    main()
