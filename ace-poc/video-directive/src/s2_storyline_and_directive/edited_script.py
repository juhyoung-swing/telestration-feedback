#!/usr/bin/env python3
"""사람 편집본(lecture_forehand.webm)의 대본.

merged.json 하나에서 뽑는다. 발화·자막·그래픽·줌·효과음이 전부 편집본
타임코드라 한 줄로 세울 수 있다.

씬 안에서 항목을 종류별로 모으지 않고 시각순으로 섞는다.
그래야 '이 순간 화면에 뭐가 있나'가 읽힌다.

output: video-directive/output/edited_script.md · edited_script.html

usage: python edited_script.py
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

TYPE = {"intro": "인트로", "concept": "개념", "demo": "시범", "drill": "드릴",
        "chapter_open": "챕터카드", "prop": "소품", "summary": "요약",
        "montage": "이미지 트레이닝", "opening": "목차"}
KIND = {"speech": "자막", "speech_edited": "자막", "title": "자막", "label": "라벨",
        "created": "창작자막"}


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


def sec(t: str) -> float:
    m, s = t.split(":")
    return int(m) * 60 + float(s)


def tc(v: float) -> str:
    return f"{int(v // 60):02d}:{v % 60:04.1f}"


def main() -> None:
    fix = load_fix()
    d = json.loads((ROOT / "edited/lecture_forehand.merged.json").read_text())
    tr = json.loads((ROOT / "edited/lecture_forehand.transcript.json").read_text())["segments"]

    # 대사는 한 씬에만 속한다. '조금이라도 겹치면 넣는다' 로 짜면
    # 0.04초 걸친 문장이 챕터카드와 다음 씬에 두 번 나온다. 중간점으로 정한다.
    spans = [(sec(s["span"]["start"]), sec(s["span"]["end"])) for s in d["scenes"]]
    owner = {}
    for i, t in enumerate(tr):
        if not t["text"].strip():
            continue
        mid = (t["start"] + t["end"]) / 2
        for k, (a, b) in enumerate(spans):
            if a <= mid < b:
                owner[i] = k
                break
        else:
            owner[i] = min(range(len(spans)),
                           key=lambda k: min(abs(mid - spans[k][0]), abs(mid - spans[k][1])))

    scenes = []
    for si, s in enumerate(d["scenes"]):
        a, b = spans[si]
        ev = []
        for i, t in enumerate(tr):
            if owner.get(i) == si:
                ev.append((t["start"], "대사", fix(t["text"].strip())))
        for x in s["subtitles"]:
            ev.append((sec(x["span"]["start"]), KIND.get(x["kind"], "자막"),
                       f'{fix(x["text"])}   〈{x["position"]}·{x["size"]}〉'))
        for g in s["graphics"]:
            ev.append((sec(g["span"]["start"]), "그래픽",
                       f'{g["shape"]} → {fix(g["target"])}   〈{g["color"]}·{g["position"]}〉'))
        for z in s["zoom"]:
            ev.append((sec(z["at"]), "줌",
                       f'{z["direction"]} {z["intensity"]} ({z["style"]}) · {z["purpose"]}'
                       f'{"   — " + fix(z["context"]) if z.get("context") else ""}'))
        for x in s["sfx"]:
            ev.append((sec(x["at"]), "효과음", x["kind"]))
        for sh in (s["composition"].get("internal_shifts") or []):
            ev.append((sec(sh["at"]), "구도",
                       f'인물 {sh["from_pct"]}% → {sh["to_pct"]}%   — {fix(sh["trigger"])}'))
        c = s["composition"]
        sp, sz = c.get("subject_position", {}), c.get("subject_size", {})
        ns, rf = c.get("negative_space", {}), c.get("reframe_trace", {})
        frame = (f'인물 {sp.get("horizontal_pct","—")}% · 키 {sz.get("height_ratio_pct","—")}% · '
                 f'헤드룸 {sz.get("headroom_pct","—")}% · {sz.get("shot_scale","—")}')
        scenes.append({"id": s["scene_id"], "type": s["type"], "a": a, "b": b,
                       "title": fix(s["function"]), "frame": frame,
                       "space": fix(f'{ns["zone"]} → {ns["occupied_by"]}') if ns.get("zone") else "",
                       "reframe": fix(f'{rf["type"]}' + (f' · {rf["note"]}' if rf.get("note") else ""))
                       if rf.get("type") else "",
                       "ev": sorted(ev, key=lambda e: e[0])})

    total = scenes[-1]["b"]

    # ── 마크다운 ─────────────────────────────────────────────────────────
    M = ["# 포핸드 핵심 세 가지 — 편집본 대본\n",
         f"김기준 코치 · {tc(total)} · 씬 {len(scenes)}개\n", "---"]
    for s in scenes:
        M.append(f"\n## {tc(s['a'])} – {tc(s['b'])}  {TYPE.get(s['type'], s['type'])}")
        M.append(f"**{s['title']}**\n")
        M.append(f"구도 · {s['frame']}  ")
        if s["space"]:
            M.append(f"여백 · {s['space']}  ")
        if s["reframe"]:
            M.append(f"리프레임 · {s['reframe']}")
        M.append("")
        if not s["ev"]:
            M.append("(화면만 · 발화 없음)")
            continue
        M.append("| 시각 | | |")
        M.append("|---|---|---|")
        for t, k, v in s["ev"]:
            M.append(f"| `{tc(t)}` | {k} | {v.replace('|', '·')} |")
    DOC = Path(__file__).resolve().parents[2] / "output"   # video-directive/output
    DOC.mkdir(parents=True, exist_ok=True)
    (DOC / "edited_script.md").write_text("\n".join(M) + "\n")

    # ── HTML ────────────────────────────────────────────────────────────
    H = ['<header><h1>포핸드 핵심 세 가지</h1>',
         f'<p>편집본 대본 · 김기준 코치 · {tc(total)} · 씬 {len(scenes)}개</p></header>']
    for s in scenes:
        H.append("<section><div class='hd'>"
                 f"<span class='t'>{tc(s['a'])} – {tc(s['b'])}</span>"
                 f"<span class='ty'>{TYPE.get(s['type'], s['type'])}</span>"
                 f"<h2>{html.escape(s['title'])}</h2>"
                 f"<p class='fr'>구도 · {html.escape(s['frame'])}</p>"
                 + (f"<p class='fr'>여백 · {html.escape(s['space'])}</p>" if s["space"] else "")
                 + (f"<p class='fr'>리프레임 · {html.escape(s['reframe'])}</p>" if s["reframe"] else "")
                 + "</div>")
        if not s["ev"]:
            H.append("<p class='none'>화면만 · 발화 없음</p></section>")
            continue
        H.append("<ul>")
        for t, k, v in s["ev"]:
            cls = {"대사": "sp", "자막": "st", "창작자막": "st", "라벨": "st",
                   "그래픽": "gr", "줌": "zm", "구도": "zm", "효과음": "fx"}.get(k, "")
            H.append(f"<li class='{cls}'><span class='tt'>{tc(t)}</span>"
                     f"<span class='kk'>{k}</span><span class='vv'>{html.escape(v)}</span></li>")
        H.append("</ul></section>")

    (DOC / "edited_script.html").write_text(
        '<!doctype html><html lang=ko><head><meta charset=utf-8>'
        '<meta name=viewport content="width=device-width,initial-scale=1">'
        "<title>포핸드 핵심 세 가지 — 편집본 대본</title><style>" + CSS +
        "</style></head><body><main>" + "".join(H) + "</main></body></html>")

    n = sum(len(s["ev"]) for s in scenes)
    print(f"씬 {len(scenes)}개 · 항목 {n}개 · {tc(total)}")
    print(f"→ {DOC / 'edited_script.md'}")
    print(f"→ {DOC / 'edited_script.html'}")


CSS = """
:root{--navy:#17335F;--yellow:#E4EF3D;--ink:#1B2233;--soft:#6B7488;--rule:#E6E9F0}
*{box-sizing:border-box}
body{margin:0;background:#DDE0E7;color:var(--ink);line-height:1.6;word-break:keep-all;
 font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo",-apple-system,system-ui,sans-serif}
main{max-width:760px;margin:0 auto;background:#F4F5F8}
@media(min-width:800px){main{margin:24px auto;border-radius:16px;overflow:hidden}}
header{background:var(--navy);color:#fff;padding:28px 26px 24px}
header h1{margin:0 0 6px;font-size:1.5rem;font-weight:800;letter-spacing:-.02em}
header p{margin:0;font-size:.84rem;color:#B9C3D8}
section{background:#fff;margin:10px 0;padding:18px 24px 20px}
.hd{border-bottom:1px solid var(--rule);padding-bottom:10px;margin-bottom:6px}
.hd .t{font:700 .74rem ui-monospace,Menlo,monospace;color:var(--navy);
 background:#EEF1F7;padding:3px 9px;border-radius:5px}
.hd .ty{font-size:.72rem;color:var(--soft);margin-left:8px}
.hd h2{margin:9px 0 0;font-size:1.02rem;font-weight:700;letter-spacing:-.01em}
ul{list-style:none;margin:0;padding:0}
li{display:flex;gap:11px;align-items:baseline;padding:5px 0;border-top:1px solid #F1F3F7}
li:first-child{border-top:0}
.tt{flex:none;width:52px;font:11px ui-monospace,Menlo,monospace;color:#98A0B2}
.kk{flex:none;width:52px;font-size:.7rem;color:var(--soft)}
.vv{flex:1;font-size:.92rem}
li.sp .vv{font-weight:500}
li.st .vv{color:#1B6B3A;font-weight:600}
li.gr .vv{color:#8A5A00}
li.zm .vv{color:#6B3AA0}
li.fx .vv{color:var(--soft);font-size:.86rem}
.fr{margin:5px 0 0;font-size:.76rem;color:var(--soft)}
.none{color:var(--soft);font-size:.9rem;font-style:italic;margin:6px 0 0}
"""


if __name__ == "__main__":
    main()
