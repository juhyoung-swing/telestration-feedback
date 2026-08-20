#!/usr/bin/env python3
"""지시서 → 사람이 검토하는 HTML (G1 게이트).

지시서는 기계용 좌표라 눈으로 못 읽는다. 여기서
  - 씬을 누적 타임코드로 펼치고
  - a_roll 구간에 해당하는 실제 발화를 전사에서 끌어와 붙이고
  - 자막/그래픽/줌/SFX 를 씬 안의 상대 시각 순서로 늘어놓고
  - 구도(horizontal_pct·headroom)를 16:9 박스에 그려서
검토자가 "이 순간 화면에 뭐가 있나"를 한눈에 보게 한다.

usage: python review_html.py [directive.json] [out.html]
"""
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TRANSCRIPT_DIR = ROOT / "runs/002/s1_audio_visual_data_fusion/output"

ROLE_KO = {
    "intro": "인트로", "opening": "오프닝", "chapter_open": "챕터 카드",
    "concept": "개념 설명", "demo": "시범", "drill": "드릴",
    "prop": "소품 비유", "summary": "요약", "montage": "몽타주",
}
KIND_KO = {"title": "강조 자막", "created": "창작 자막", "label": "고정 라벨",
           "speech": "발화 자막", "speech_edited": "발화 자막(보정)"}
COLOR_HEX = {"green": "#3ddc84", "yellow": "#ffd93d", "red": "#ff5c5c",
             "blue": "#5cc8ff", "white": "#ffffff", "orange": "#ff9f45"}


def tc(s: float) -> str:
    neg = "-" if s < 0 else ""
    s = abs(s)
    return f"{neg}{int(s // 60)}:{s % 60:04.1f}"


def load_transcripts() -> dict:
    out = {}
    for p in sorted(TRANSCRIPT_DIR.glob("c01_*.json")):
        out[p.stem] = json.loads(p.read_text()).get("segments", [])
    return out


def speech_for(tr: dict, clip: str, a: float, b: float) -> list:
    return [t["text"].strip() for t in tr.get(clip, [])
            if t["text"].strip() and t["end"] > a and t["start"] < b]


def scene_duration(sc: dict) -> float:
    if sc.get("a_roll"):
        return sum(r["end"] - r["start"] for r in sc["a_roll"])
    return sc.get("duration_sec", 0.0)


def comp_box(c: dict) -> str:
    """구도를 16:9 박스에 그린다. 인물 위치·크기·헤드룸·여백."""
    if not c:
        return ""
    x = c.get("horizontal_pct")
    h = c.get("height_ratio_pct")
    head = c.get("headroom_pct")
    if x is None:
        return f'<div class="comp-none">{html.escape(c.get("shot_scale", "—"))}</div>'
    top = head if head is not None else 10
    ph = h if h is not None else 70
    ns = c.get("negative_space", "")
    return f"""<div class="comp">
      <div class="frame">
        <div class="figure" style="left:{x}%;top:{top}%;height:{ph}%"></div>
        <div class="axis" style="left:50%"></div>
        <div class="tag" style="left:{x}%">{x}%</div>
      </div>
      <div class="comp-meta">
        <div><b>{x}%</b> 좌우 · <b>{h if h is not None else '—'}%</b> 키 · <b>{head if head is not None else '—'}%</b> 헤드룸</div>
        <div class="dim">{html.escape(c.get('shot_scale', '') or '')}</div>
        {f'<div class="ns">여백 → {html.escape(ns)}</div>' if ns else ''}
        {f'<div class="ns">리드룸 → {html.escape(c["lead_room"])}</div>' if c.get('lead_room') else ''}
        {f'<div class="ns">리프레임 → {html.escape(c["reframe"])}</div>' if c.get('reframe') else ''}
      </div>
    </div>"""


def build(d: dict) -> str:
    tr = load_transcripts()
    scenes = d["scenes"]

    by_scene = {s["scene_id"]: {"st": [], "gr": [], "zm": [], "sx": []} for s in scenes}
    for k, key in (("subtitles", "st"), ("graphics", "gr"), ("zoom", "zm"), ("sfx", "sx")):
        for it in d.get(k, []):
            sid = it["anchor"]["scene_id"]
            if sid in by_scene:
                by_scene[sid][key].append(it)

    enabled = [s for s in scenes if s.get("enabled", True)]
    total = sum(scene_duration(s) for s in enabled)

    # 타임라인 바
    bars, cum = [], 0.0
    for s in scenes:
        dur = scene_duration(s)
        on = s.get("enabled", True)
        w = (dur / total * 100) if (on and total) else 0
        if on:
            bars.append(f'<a class="bar r-{s["role"]}" style="width:{w}%" href="#{s["scene_id"]}" '
                        f'title="{s["scene_id"]} {ROLE_KO.get(s["role"], s["role"])} {tc(cum)}→{tc(cum+dur)}">'
                        f'<span>{s["scene_id"]}</span></a>')
            cum += dur

    L = []
    A = L.append
    A(f"""<h1>지시서 D — 검토</h1>
<p class="sub">무편집 원본 <code>c01_01~07</code> → 강의 편집본 지시서 ·
사람 편집본은 <b>문법 참조</b>로만 사용 · 총 <b>{tc(total)}</b> (사람 편집본 8:03.0)</p>

<div class="stats">
  <div><b>{len(enabled)}</b><span>활성 씬</span></div>
  <div><b>{len(scenes)-len(enabled)}</b><span>막힌 씬</span></div>
  <div><b>{len(d.get('subtitles', []))}</b><span>강조 자막</span></div>
  <div><b>{len(d.get('graphics', []))}</b><span>그래픽</span></div>
  <div><b>{len(d.get('zoom', []))}</b><span>줌</span></div>
  <div><b>{len(d.get('sfx', []))}</b><span>SFX</span></div>
  <div><b>{sum(1 for a in d.get('assets', []) if a['status'] != 'ready')}</b><span>미확보 에셋</span></div>
</div>

<div class="timeline">{''.join(bars)}</div>
<p class="legend">막대 폭 = 실제 길이 비율. 클릭하면 해당 씬으로.</p>""")

    # 정책 박스
    sp = d["subtitle_policy"]
    cg = d["composition_grammar"]
    A(f"""<div class="policy">
  <div class="pcard">
    <h3>발화 자막 정책</h3>
    <p>지시서에 문구를 나열하지 <b>않는다</b>. s6 이 우리 whisper 전사에서 생성한다.</p>
    <ul>
      <li><b>speech</b> — {html.escape(sp['speech']['style'])} · 한 줄 {sp['speech']['max_chars_per_line']}자 · 최대 {sp['speech']['max_lines']}줄</li>
      <li><b>speech_edited</b> — {html.escape(sp['speech_edited']['rule'])}<br><span class="dim">예: {html.escape(sp['speech_edited']['example'])}</span></li>
      <li><b>created</b> — {html.escape(sp['created']['rule'])}</li>
    </ul>
  </div>
  <div class="pcard">
    <h3>구도 문법</h3>
    <ul>
      <li>기본 <b>{cg['default_horizontal_pct']}%</b></li>
      <li>{html.escape(cg['offset_rule'])}</li>
      <li>{html.escape(cg['text_subject_coordination'])}</li>
      <li>{html.escape(cg['reframe'])}</li>
    </ul>
  </div>
  <div class="pcard">
    <h3>렌더</h3>
    <p>{html.escape(d['render']['note'])}</p>
    <p class="dim">원본 {html.escape(d['meta']['source']['resolution'])} · {html.escape(d['meta']['source']['resolution_note'])}</p>
  </div>
</div>""")

    # 씬
    cum = 0.0
    for s in scenes:
        sid = s["scene_id"]
        dur = scene_duration(s)
        on = s.get("enabled", True)
        role = ROLE_KO.get(s["role"], s["role"])
        span = f"{tc(cum)} → {tc(cum + dur)}" if on else "—"

        A(f'<section class="scene{"" if on else " off"}" id="{sid}">')
        A(f'''<div class="shead">
          <div class="sid">{sid}</div>
          <div class="stitle"><b>{role}</b>{f' <span class="dens d-{s["density"]}">{s["density"]}</span>' if s.get("density") else ''}</div>
          <div class="stime">{span} <span class="dim">({dur:.1f}초)</span></div>
        </div>''')

        if not on:
            blockers = ", ".join(s.get("blocked_by", []))
            A(f'<div class="blocked"><b>비활성</b> — 막고 있는 것: <code>{html.escape(blockers)}</code>'
              f'<div class="dim">{html.escape(s.get("note",""))}</div>'
              f'<div class="dim">원래 길이 {s.get("duration_sec",0):.1f}초. s4 는 이 씬을 건너뛴다.</div></div>')
            A("</section>")
            continue

        A('<div class="sbody">')
        A('<div class="left">')

        # 소스 + 발화
        if s.get("a_roll"):
            A('<h4>원본 구간</h4>')
            for i, r in enumerate(s["a_roll"]):
                sp_lines = speech_for(tr, r["file"], r["start"], r["end"])
                jump = ""
                if i > 0:
                    prev = s["a_roll"][i - 1]
                    if prev["file"] == r["file"]:
                        jump = f'<span class="jump">↯ {prev["end"]:.2f}→{r["start"]:.2f} 잘라냄 ({r["start"]-prev["end"]:.1f}초)</span>'
                A(f'<div class="clip"><code>{r["file"]}</code> '
                  f'<span class="dim">{r["start"]:.2f}s – {r["end"]:.2f}s · {r["end"]-r["start"]:.1f}초</span> {jump}</div>')
                A('<div class="speech">' +
                  (html.escape(" ".join(sp_lines)) if sp_lines else '<span class="dim">(무발화)</span>') +
                  '</div>')
        elif s.get("generated"):
            A('<h4>생성 화면</h4>')
            A(f'<div class="clip"><code>{s["generated"]["asset_id"]}</code> '
              f'<span class="dim">A-roll 없음 · CG {dur:.1f}초</span></div>')

        if s.get("note"):
            A(f'<div class="note">{html.escape(s["note"])}</div>')

        # 전환
        ti, to = s.get("transition_in"), s.get("transition_out")
        bits = []
        if ti:
            bits.append(f'in <code>{ti["type"]}</code> {ti["duration_sec"]}s')
        if to:
            bits.append(f'out <code>{to["type"]}</code> {to["duration_sec"]}s'
                        + (f' · 카드 {to["card"]}' if to.get("card") else ""))
        if bits:
            A(f'<div class="trans">전환 &nbsp; {" &nbsp;·&nbsp; ".join(bits)}</div>')

        A("</div>")  # left
        A('<div class="right">')
        A(comp_box(s.get("composition", {})))

        # 오버레이 타임라인
        ov = []
        for x in by_scene[sid]["st"]:
            c = COLOR_HEX.get(x.get("color", "white"), "#fff")
            ov.append((x["anchor"]["offset_sec"], "자막",
                       f'<span class="chip" style="--c:{c}">{html.escape(x["text"]).replace(chr(10), "<br>")}</span>'
                       f'<span class="dim"> {KIND_KO.get(x["kind"], x["kind"])} · {x["position"]} · {x["size"]} · {x["duration_sec"]}초</span>'))
        for g in by_scene[sid]["gr"]:
            c = COLOR_HEX.get(g.get("color", "white"), "#fff")
            ov.append((g["anchor"]["offset_sec"], "그래픽",
                       f'<span class="chip" style="--c:{c}">{g["shape"]}</span>'
                       f'<span class="dim"> → {html.escape(g["target"])} · {html.escape(g["position"])} · {g["duration_sec"]}초</span>'))
        for z in by_scene[sid]["zm"]:
            ov.append((z["anchor"]["offset_sec"], "줌",
                       f'<span class="chip zoom">×{z["scale"]}</span>'
                       f'<span class="dim"> {z["intensity"]} · 중심 ({z["center_pct"]["x"]}%, {z["center_pct"]["y"]}%) · {z["purpose"]}<br>{html.escape(z["context"])}</span>'))
        for x in by_scene[sid]["sx"]:
            ov.append((x["anchor"]["offset_sec"], "SFX",
                       f'<span class="chip sfx">{x["kind"]}</span><span class="dim"> {x["gain_db"]}dB</span>'))

        if ov:
            A('<h4>화면 위 요소</h4><table class="ov">')
            for off, kind, body in sorted(ov, key=lambda t: t[0]):
                A(f'<tr><td class="off">+{off:.1f}s<div class="dim">{tc(cum + off)}</div></td>'
                  f'<td class="kind">{kind}</td><td>{body}</td></tr>')
            A("</table>")
        else:
            A('<h4>화면 위 요소</h4><p class="dim">없음 — 동작만 보여준다.</p>')

        A("</div></div></section>")
        cum += dur

    # BGM
    A('<h2>BGM</h2><table class="flat"><tr><th>구간</th><th>성격</th><th>레벨</th></tr>')
    for b in d.get("bgm", []):
        rng = b["from_scene"] if b["from_scene"] == b["to_scene"] else f'{b["from_scene"]} → {b["to_scene"]}'
        A(f'<tr><td><code>{rng}</code></td><td>{html.escape(b["character"])}</td><td>{b["gain_db"]}dB</td></tr>')
    A("</table>")

    # 에셋
    A('<h2>필요한 에셋</h2><table class="flat"><tr><th>ID</th><th>종류</th><th>상태</th><th>설명</th></tr>')
    for a in d.get("assets", []):
        A(f'<tr><td><code>{a["id"]}</code></td><td>{a["type"]}</td>'
          f'<td><span class="st-{a["status"]}">{a["status"]}</span></td>'
          f'<td>{html.escape(a["description"])}</td></tr>')
    A("</table>")

    p = d["polish"]
    A(f'''<h2>마감</h2><p>발화 구간 <b>{p["loudness_lufs"]} LUFS</b> ·
    무발화 구간 <b>{p["loudness_lufs_silent"]} LUFS</b> ·
    블록별 개별 정규화 <b>{"켬" if p["per_block"] else "끔"}</b> ·
    디노이즈 <b>{"켬" if p["denoise"] else "끔"}</b> · 출력 <code>{p["deliverable"]}</code></p>
    <p class="dim">원본 클립 라우드니스가 −16.1 ~ −23.8 LUFS 로 흩어져 있고 무발화 시범 클립이 7.7 LU 더 낮다.
    단일 목표값으로는 못 맞춰서 발화/무발화를 나누고 블록별로 건다.</p>''')

    return "\n".join(L)


CSS = """
:root{--bg:#0f1115;--pane:#171a21;--line:#262b36;--fg:#e6e9ef;--dim:#8b93a3;--acc:#3ddc84}
*{box-sizing:border-box}
body{margin:0;padding:32px 28px 80px;background:var(--bg);color:var(--fg);
 font:14px/1.65 -apple-system,'Apple SD Gothic Neo',sans-serif;max-width:1180px;margin:0 auto}
h1{font-size:26px;margin:0 0 6px}
h2{font-size:19px;margin:44px 0 12px;padding-top:18px;border-top:1px solid var(--line)}
h3{font-size:13px;margin:0 0 8px;color:var(--acc);letter-spacing:.04em}
h4{font-size:12px;margin:14px 0 6px;color:var(--dim);letter-spacing:.06em;text-transform:uppercase}
p.sub{color:var(--dim);margin:0 0 20px}
code{background:#232833;padding:1px 6px;border-radius:4px;font-size:12px;font-family:ui-monospace,Menlo,monospace}
.dim{color:var(--dim);font-size:12px}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.stats div{background:var(--pane);border:1px solid var(--line);border-radius:9px;padding:9px 15px;text-align:center;min-width:78px}
.stats b{display:block;font-size:19px}
.stats span{font-size:11px;color:var(--dim)}
.timeline{display:flex;height:34px;border-radius:7px;overflow:hidden;border:1px solid var(--line)}
.bar{display:flex;align-items:center;justify-content:center;font-size:10px;color:#0b0d11;
 text-decoration:none;border-right:1px solid #0f1115;overflow:hidden;white-space:nowrap;font-weight:700}
.bar:hover{filter:brightness(1.25)}
.r-opening{background:#5cc8ff}.r-chapter_open{background:#6b7280}.r-concept{background:#3ddc84}
.r-demo{background:#ffd93d}.r-prop{background:#ff9f45}.r-summary{background:#c084fc}
.r-montage{background:#ff5c5c}.r-intro{background:#444}.r-drill{background:#444}
p.legend{color:var(--dim);font-size:11px;margin:6px 0 24px}
.policy{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:10px}
.pcard{background:var(--pane);border:1px solid var(--line);border-radius:11px;padding:15px 17px}
.pcard ul{margin:0;padding-left:17px}.pcard li{margin-bottom:6px;font-size:13px}
.pcard p{margin:0 0 8px;font-size:13px}
.scene{background:var(--pane);border:1px solid var(--line);border-radius:12px;margin:12px 0;overflow:hidden}
.scene.off{opacity:.5;border-style:dashed}
.shead{display:flex;align-items:center;gap:14px;padding:12px 18px;background:#1c202a;border-bottom:1px solid var(--line)}
.sid{font:700 12px ui-monospace,Menlo,monospace;color:var(--acc)}
.stitle{flex:1}
.stime{font:12px ui-monospace,Menlo,monospace}
.dens{font-size:10px;padding:2px 7px;border-radius:20px;margin-left:6px;vertical-align:2px}
.d-heavy{background:#ff5c5c33;color:#ff8f8f}.d-medium{background:#ffd93d26;color:#ffd93d}
.d-light{background:#3ddc8426;color:#3ddc84}
.sbody{display:grid;grid-template-columns:1.05fr .95fr;gap:22px;padding:16px 18px}
@media(max-width:820px){.sbody{grid-template-columns:1fr}}
.clip{margin-top:8px;font-size:12px}
.jump{color:#ff9f45;font-size:11px;margin-left:6px}
.speech{background:#12151c;border-left:2px solid var(--line);padding:8px 12px;margin:5px 0 2px;
 border-radius:0 6px 6px 0;font-size:13px;color:#c9cfdb}
.note{background:#1e2432;border-left:2px solid #5cc8ff;padding:8px 12px;margin-top:12px;
 border-radius:0 6px 6px 0;font-size:12px;color:#a9c8dd}
.blocked{padding:14px 18px;background:#221a1a;border-left:2px solid #ff5c5c;margin:0;font-size:13px}
.trans{margin-top:12px;font-size:12px;color:var(--dim)}
.comp{display:flex;gap:13px;align-items:flex-start}
.frame{position:relative;width:150px;flex:none;aspect-ratio:16/9;background:#0b0d11;
 border:1px solid var(--line);border-radius:4px}
.figure{position:absolute;width:9px;transform:translateX(-50%);background:var(--acc);
 border-radius:5px;opacity:.85}
.axis{position:absolute;top:0;bottom:0;width:1px;background:#ffffff1a}
.tag{position:absolute;bottom:-17px;transform:translateX(-50%);font-size:9px;color:var(--acc)}
.comp-meta{font-size:12px}
.comp-none{font-size:12px;color:var(--dim)}
.ns{color:var(--dim);font-size:11px;margin-top:3px}
table.ov{width:100%;border-collapse:collapse;font-size:12px}
table.ov td{padding:7px 6px;border-top:1px solid var(--line);vertical-align:top}
td.off{width:62px;font:11px ui-monospace,Menlo,monospace;color:var(--dim)}
td.kind{width:48px;color:var(--dim);font-size:11px}
.chip{display:inline-block;padding:2px 8px;border-radius:5px;font-weight:600;
 background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c);
 border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
.chip.zoom{--c:#c084fc;background:#c084fc1f;color:#c084fc;border-color:#c084fc55}
.chip.sfx{--c:#8b93a3;background:#8b93a31f;color:#b6bdca;border-color:#8b93a355}
table.flat{width:100%;border-collapse:collapse;font-size:13px}
table.flat th{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);color:var(--dim);font-size:11px}
table.flat td{padding:7px 8px;border-top:1px solid var(--line);vertical-align:top}
.st-need_create{color:#ffd93d}.st-need_record{color:#ff9f45}.st-need_shoot{color:#ff5c5c}
"""


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else \
        ROOT / "runs/002/s2_storyline_and_directive/output/directive_D.json"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_name("review_D.html")
    d = json.loads(src.read_text())
    out.write_text(
        "<!doctype html><html lang=ko><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>지시서 D 검토 — {d['meta']['project_id']}</title>"
        f"<style>{CSS}</style></head><body>{build(d)}</body></html>")
    print(f"→ {out.resolve()}")


if __name__ == "__main__":
    main()
