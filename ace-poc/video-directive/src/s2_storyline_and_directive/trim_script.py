#!/usr/bin/env python3
"""s2 — 말을 다듬는다. 문장 단위로 keep/drop 을 판단해 지시서를 다시 쓴다.

지금까지의 컷은 뭉텅이 5개였다. 사람 편집본은 35개를 잘랐고, 그 중 44초를
우리가 놓쳤다(human_diff). 놓친 것들은 전부 말 사이 잔가지였다.
그 잔가지에 이름을 붙여 규칙으로 만든 것이 아래 R1~R7 이다.

판단은 문장마다 사유와 함께 남긴다 — 왜 잘렸는지 사람이 확인할 수 있어야 한다.

만드는 것
  output/directive_E.json    — 다듬은 a_roll 구간이 들어간 지시서
  output/trim_decisions.json — 문장별 keep/drop 과 사유
  output/script_compare.html — 편집본 / 원래 지시서 / 다듬은 지시서 3단 비교

usage: python trim_script.py [run_dir]
"""
import html
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PAD_IN, PAD_OUT = 0.12, 0.25    # 컷 앞뒤 호흡
JOIN_GAP = 0.40                 # 이보다 가까운 두 구간은 붙여서 한 컷으로 둔다
GAP_MAX  = 0.80                 # 문장 안에서 이보다 길게 말이 끊기면 그 자리를 잘라낸다

# R4 — 문장 머리에서만 떼는 군더더기. 담화 표지만 넣는다.
# '그'(그 다음에·그 이유는), '지금', '항상', '그래서' 는 뺐다 — 떼면 뜻이 바뀐다.
HEAD_FILLER = ["이제", "그러니까", "자", "어", "음", "어쨌든", "인제", "약간", "뭐"]


def norm(s: str) -> str:
    return re.sub(r"[^\w가-힣]", "", s)


def sim(a: str, b: str) -> float:
    return SequenceMatcher(None, norm(a), norm(b), autojunk=False).ratio()


def trim_head(words: list) -> int:
    """R4 — 문장 머리의 군더더기 단어 수. 다 떼면 문장이 사라지니 절반까지만."""
    k = 0
    while k < max(1, len(words) // 2) and \
            words[k]["word"].strip().strip(".,?!") in HEAD_FILLER:
        k += 1
    return k


def judge(texts: list, segs: list) -> list:
    """문장마다 (drop 여부, 규칙, 사유).

    판단은 '머리 군더더기를 뗀 뒤의 문장'으로 한다. 안 그러면 '자, 세 번째는
    피니시입니다' 가 챕터 중복(R3)으로 안 잡힌다.

    문장을 통째로 버리는 규칙은 넷뿐이다. 짧다는 이유로 버리지 않는다 —
    그렇게 했더니 '안녕하세요 김준코치입니다' 와 '그래서 오늘 배운 거 세 가지'
    까지 날아갔다. 둘 다 사람은 살린 말이다."""
    out = []
    for i, (t, s) in enumerate(zip(texts, segs)):
        nxt = texts[i + 1] if i + 1 < len(texts) else ""
        if s.get("no_speech_prob", 0) > 0.5:
            out.append(("drop", "R6", f'무발화 구간의 환각. no_speech_prob {s["no_speech_prob"]:.2f}'))
        elif re.search(r"(냐면|하냐면|잡냐면)\s*[.?]?$", t) and len(norm(t)) < 24:
            out.append(("drop", "R2", "자문자답 도입. 뒤 문장이 답을 바로 말한다"))
        elif nxt and len(norm(t)) < 26 and sim(t, nxt[:max(1, len(t))]) > 0.62:
            out.append(("drop", "R1", "다시 말하기. 같은 말로 다음 문장이 시작한다"))
        elif re.match(r"^(첫|두|세|네|첫번|두번|세번)\s*(번)?째[는은]?\s*\S{0,10}"
                      r"(입니다|인데|이고|이야)\.?$", t):
            out.append(("drop", "R3", "챕터 카드가 이미 말한 도입"))
        else:
            out.append(("keep", "", ""))
    return out


def score(e_spans: dict, human_diff: Path) -> dict:
    """다듬은 결과를 사람 편집본의 컷과 대조한다. 규칙이 헛돌면 여기서 드러난다."""
    if not human_diff.exists():
        return {}
    hd = json.loads(human_diff.read_text())
    flat = [(c, a, b) for c, lst in e_spans.items() for a, b in lst]

    def kept_sec(clip, a, b):
        return sum(max(0.0, min(b, y) - max(a, x)) for c, x, y in flat if c == clip)

    hit = miss = 0.0
    for c in hd["cuts"]:
        k = kept_sec(c["clip"], c["start"], c["end"])
        hit += c["sec"] - k
        miss += k
    return {"human_cut_sec": round(hd["human_cut_sec"], 1),
            "we_also_cut_sec": round(hit, 1), "we_missed_sec": round(miss, 1)}


def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "runs/002"
    out = run_dir / "s2_storyline_and_directive/output"
    d = json.loads((out / "directive_D.json").read_text())
    tr = {c: json.loads((run_dir / f"s1_audio_visual_data_fusion/output/{c}.json").read_text())["segments"]
          for c in ("c01_01", "c01_02", "c01_03", "c01_04")}

    # 씬마다 '이 씬이 쓰는 원본 범위'를 원래 지시서에서 가져온다.
    # 뭉텅이 점프는 여기서 없앤다 — 잘라먹은 33초가 그 점프에서 났다.
    scope = {}
    for s in d["scenes"]:
        rolls = [r for r in (s.get("a_roll") or []) if r["file"] in tr]
        if rolls:
            scope[s["scene_id"]] = (rolls[0]["file"], rolls[0]["start"], rolls[-1]["end"])

    decisions, new_rolls, e_spans = [], {}, {}
    for sid, (clip, a, b) in scope.items():
        segs = [s for s in tr[clip] if s["end"] > a and s["start"] < b]
        # 먼저 머리 군더더기를 떼고, 그 문장으로 판단한다.
        heads, texts = [], []
        for s in segs:
            words = [w for w in s.get("words", []) if w["end"] > a and w["start"] < b]
            k = trim_head(words) if words else 0
            heads.append((words, k))
            texts.append(" ".join(w["word"].strip() for w in words[k:]) if words
                         else s["text"].strip())
        verdict = judge(texts, segs)
        spans = []
        for s, (words, k), txt, (v, rule, why) in zip(segs, heads, texts, verdict):
            rec = {"scene_id": sid, "clip": clip, "start": round(s["start"], 2),
                   "end": round(s["end"], 2), "text": s["text"].strip(),
                   "verdict": v, "rule": rule, "why": why, "trimmed_head": ""}
            if v == "keep" and words:
                if k:
                    rec["trimmed_head"] = " ".join(w["word"].strip() for w in words[:k])
                    rec["rule"], rec["why"] = "R4", "문장 머리 군더더기만 떼어냄"
                w = words[k:]
                if w:
                    # R8 — 문장 안에서도 말이 끊긴 자리는 잘라낸다.
                    # 문장 사이 침묵만 지우면 문장 안의 '어…' 하는 공백이 그대로 남는다.
                    piece, kept_here = [w[0]], []
                    for prev, cur in zip(w, w[1:]):
                        if cur["start"] - prev["end"] > GAP_MAX:
                            kept_here.append(piece)
                            piece = []
                        piece.append(cur)
                    kept_here.append(piece)
                    for pc in kept_here:
                        if not pc:
                            continue
                        spans.append((max(a, pc[0]["start"] - PAD_IN),
                                      min(b, pc[-1]["end"] + PAD_OUT)))
                    if len(kept_here) > 1:
                        rec["rule"] = (rec["rule"] + "+R8").lstrip("+")
                        rec["why"] = (rec["why"] + " / 문장 안 침묵 "
                                      f"{len(kept_here)-1}곳 잘라냄").strip(" /")
                    rec["kept_span"] = [round(spans[-1][0], 2), round(spans[-1][1], 2)]
            decisions.append(rec)
        # 가까운 구간은 이어 붙인다. 컷이 잦으면 숨이 끊긴다.
        merged = []
        for st, en in spans:
            if merged and st - merged[-1][1] < JOIN_GAP:
                merged[-1][1] = en
            else:
                merged.append([st, en])
        new_rolls[sid] = [{"file": clip, "start": round(x, 2), "end": round(y, 2)}
                          for x, y in merged if y - x > 0.3]
        e_spans.setdefault(clip, []).extend([x, y] for x, y in merged if y - x > 0.3)

    # 지시서 E
    e = json.loads(json.dumps(d))
    e["meta"]["directive_variant"] = "E"
    e["meta"]["derived_from"] = "directive_D + 문장 단위 다듬기(R1~R7)"
    e["trim_rules"] = {
        "R1": "다시 말하기 — 같은 말로 다음 문장이 시작하면 앞엣것을 버린다",
        "R2": "자문자답 도입 — '~냐면' 으로 끝나는 짧은 문장은 버린다",
        "R3": "챕터 카드가 이미 말한 도입은 버린다",
        "R4": "문장 머리의 연결어·군더더기는 문장을 살린 채 앞만 떼어낸다",
        "R5": "내용어(용어집)가 들어 있으면 문장을 통째로 버리지 않는다",
        "R6": "no_speech_prob > 0.5 는 무발화 구간의 환각이므로 버린다",
        "R7": f"살아남은 구간 사이가 {JOIN_GAP}초 미만이면 붙여서 한 컷으로 둔다",
        "R8": f"문장 안에서 {GAP_MAX}초 넘게 말이 끊긴 자리는 잘라낸다",
    }
    old_sec = new_sec = 0.0
    for s in e["scenes"]:
        if s["scene_id"] in new_rolls:
            old_sec += sum(r["end"] - r["start"] for r in s["a_roll"])
            s["a_roll"] = new_rolls[s["scene_id"]]
            new_sec += sum(r["end"] - r["start"] for r in s["a_roll"])
    sc = score(e_spans, out / "human_diff.json")
    e["trim_score_vs_human"] = sc
    (out / "directive_E.json").write_text(json.dumps(e, ensure_ascii=False, indent=1))
    (out / "trim_decisions.json").write_text(json.dumps(
        {"kept": sum(1 for x in decisions if x["verdict"] == "keep"),
         "dropped": sum(1 for x in decisions if x["verdict"] == "drop"),
         "speech_sec_before": round(old_sec, 1), "speech_sec_after": round(new_sec, 1),
         "score_vs_human": sc, "decisions": decisions}, ensure_ascii=False, indent=1))

    write_html(out, d, e, decisions, scope, tr, old_sec, new_sec, sc)
    if sc:
        print(f"사람 컷 {sc['human_cut_sec']}s 중 우리도 자름 {sc['we_also_cut_sec']}s · "
              f"놓침 {sc['we_missed_sec']}s")
    print(f"문장 {len(decisions)}개 · 버림 {sum(1 for x in decisions if x['verdict']=='drop')}개 · "
          f"컷 {sum(len(v) for v in new_rolls.values())}개")
    print(f"발화 구간 {old_sec:.1f}s → {new_sec:.1f}s ({new_sec-old_sec:+.1f}s)")
    print(f"→ {out / 'script_compare.html'}")


# ── HTML ──────────────────────────────────────────────────────────────────
CSS = """
:root{--bg:#0f1115;--pane:#171a21;--line:#262b36;--fg:#e6e9ef;--dim:#8b93a3;--acc:#3ddc84}
*{box-sizing:border-box}
body{margin:0;padding:26px 22px 70px;background:var(--bg);color:var(--fg);
 font:14px/1.6 -apple-system,'Apple SD Gothic Neo',sans-serif}
h1{font-size:23px;margin:0 0 6px}
p.sub{color:var(--dim);margin:0 0 16px;font-size:13px}
.stats{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:18px}
.stats div{background:var(--pane);border:1px solid var(--line);border-radius:9px;
 padding:8px 14px;text-align:center;min-width:96px}
.stats b{display:block;font-size:18px}.stats span{font-size:11px;color:var(--dim)}
.cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:start}
@media(max-width:1180px){.cols{gap:9px}.body{font-size:12px}}
@media(max-width:720px){.cols{grid-template-columns:1fr}}
.col{background:var(--pane);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.col>h2{margin:0;padding:12px 16px;font-size:14px;background:#1c202a;
 border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
.col>h2 span{display:block;font-size:11px;color:var(--dim);font-weight:400;margin-top:2px}
.body{padding:10px 14px 18px;max-height:78vh;overflow:auto}
.sc{margin:14px 0 6px;font-size:11px;color:var(--acc);letter-spacing:.05em;
 border-top:1px solid var(--line);padding-top:10px}
.sc:first-child{border-top:0;margin-top:2px}
.ln{margin:5px 0;font-size:13px;display:flex;gap:8px}
.tc{flex:none;width:52px;font:10px ui-monospace,Menlo,monospace;color:#5b6373;padding-top:3px}
.tx{flex:1}
.drop .tx{color:#6b7280;text-decoration:line-through;text-decoration-color:#ff5c5c99}
.rule{display:inline-block;margin-left:6px;font-size:10px;padding:1px 6px;border-radius:4px;
 background:#ff5c5c1f;color:#ff8f8f;border:1px solid #ff5c5c44;vertical-align:1px;
 text-decoration:none;white-space:nowrap}
.rule.keep{background:#ffd93d1a;color:#ffd93d;border-color:#ffd93d44}
.cut{margin:7px 0;padding:2px 0;border-top:1px dashed #ff5c5c55;font-size:10px;color:#ff8f8f}
.why{font-size:11px;color:var(--dim);margin:1px 0 0 60px}
.legend{margin-top:16px;font-size:12px;color:var(--dim)}
.legend code{background:#232833;padding:1px 6px;border-radius:4px}
"""


def write_html(out, d, e, decisions, scope, tr, old_sec, new_sec, sc):
    edited = json.loads((ROOT / "edited/lecture_forehand.transcript.json").read_text())["segments"]
    L = []
    A = L.append

    def tc(s):
        return f"{int(s//60)}:{s%60:04.1f}"

    n_drop = sum(1 for x in decisions if x["verdict"] == "drop")
    n_trim = sum(1 for x in decisions if x["trimmed_head"])
    A(f"""<h1>대본 3단 비교</h1>
<p class="sub">왼쪽은 사람이 만든 편집본, 가운데는 우리 지시서 D, 오른쪽은 문장 단위로 다듬은 지시서 E.
가운데와 오른쪽은 같은 원본에서 나온 같은 말이다 — 차이는 무엇을 버렸는가뿐이다.</p>
<div class="stats">
  <div><b>{old_sec:.0f}s</b><span>D 발화 길이</span></div>
  <div><b>{new_sec:.0f}s</b><span>E 발화 길이</span></div>
  <div><b>{new_sec-old_sec:+.0f}s</b><span>줄어든 양</span></div>
  <div><b>{n_drop}</b><span>버린 문장</span></div>
  <div><b>{n_trim}</b><span>머리만 뗀 문장</span></div>
  <div><b>{sum(len(s['a_roll']) for s in e['scenes'] if s.get('a_roll'))}</b><span>E 의 컷 수</span></div>
  <div><b>{sc.get("we_also_cut_sec",0):.0f}/{sc.get("human_cut_sec",0):.0f}s</b><span>사람 컷 재현</span></div>
</div>
<div class="cols">""")

    # 1단 — 편집본
    A('<div class="col"><h2>사람 편집본<span>lecture_forehand.webm · 편집 타임코드</span></h2><div class="body">')
    for s in edited:
        t = s["text"].strip()
        if t:
            A(f'<div class="ln"><div class="tc">{tc(s["start"])}</div><div class="tx">{html.escape(t)}</div></div>')
    A("</div></div>")

    # 2단 — 지시서 D
    A('<div class="col"><h2>우리 지시서 D<span>뭉텅이 컷 5개 · 원본 타임코드</span></h2><div class="body">')
    for s in d["scenes"]:
        rolls = [r for r in (s.get("a_roll") or []) if r["file"] in tr]
        if not rolls:
            continue
        A(f'<div class="sc">{s["scene_id"]} · {s["role"]} · {rolls[0]["file"]}</div>')
        prev = None
        for r in rolls:
            if prev is not None and r["start"] - prev > 0.05:
                A(f'<div class="cut">↯ {prev:.1f}–{r["start"]:.1f} 잘라냄 ({r["start"]-prev:.1f}초)</div>')
            for seg in tr[r["file"]]:
                if seg["end"] > r["start"] and seg["start"] < r["end"] and seg["text"].strip():
                    A(f'<div class="ln"><div class="tc">{seg["start"]:.1f}</div>'
                      f'<div class="tx">{html.escape(seg["text"].strip())}</div></div>')
            prev = r["end"]
    A("</div></div>")

    # 3단 — 지시서 E
    A('<div class="col"><h2>다듬은 지시서 E<span>문장 단위 판단 · 버린 문장은 취소선</span></h2><div class="body">')
    cur = None
    for x in decisions:
        if x["scene_id"] != cur:
            cur = x["scene_id"]
            role = next(s["role"] for s in e["scenes"] if s["scene_id"] == cur)
            A(f'<div class="sc">{cur} · {role} · {x["clip"]}</div>')
        cls = "ln drop" if x["verdict"] == "drop" else "ln"
        tag = ""
        if x["verdict"] == "drop":
            tag = f'<span class="rule">{x["rule"]}</span>'
        elif x["trimmed_head"]:
            tag = f'<span class="rule keep">R4 앞 “{html.escape(x["trimmed_head"])}” 뗌</span>'
        A(f'<div class="{cls}"><div class="tc">{x["start"]:.1f}</div>'
          f'<div class="tx">{html.escape(x["text"])}{tag}</div></div>')
        if x["why"] and x["verdict"] == "drop":
            A(f'<div class="why">{html.escape(x["why"])}</div>')
    A("</div></div>")

    A("</div>")
    A('<div class="legend">' + " &nbsp;·&nbsp; ".join(
        f"<code>{k}</code> {html.escape(v)}" for k, v in e["trim_rules"].items()) + "</div>")

    (out / "script_compare.html").write_text(
        "<!doctype html><html lang=ko><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>대본 3단 비교 — 편집본 / 지시서 D / 지시서 E</title>"
        f"<style>{CSS}</style></head><body>{''.join(L)}</body></html>")


if __name__ == "__main__":
    main()
