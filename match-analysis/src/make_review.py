"""results json -> 리뷰 리포트 HTML.

코트는 가로 방향. 선수별 섹션 안에 랠리(시간순) 지도를 나열하고,
지도마다 이동 경로 · 타격 위치(순번, 포핸드/백핸드) · 낙구 지점을 함께 그린다.
측정하지 못한 지표(인/아웃, 서브 성공률, 스트로크 속도)는 넣지 않는다.

  python make_review.py <results json> [P1이름] [P2이름]
"""
import json, os, sys
from collections import Counter

SRC = sys.argv[1] if len(sys.argv) > 1 else "output/analysis/match_b_45_67/results_final_v3.json"
N1 = sys.argv[2] if len(sys.argv) > 2 else "P1"
N2 = sys.argv[3] if len(sys.argv) > 3 else "P2"
R = json.load(open(SRC))
OUT = os.path.join(os.path.dirname(SRC), "review.html")

L, WD, WS = R["court"]["length_m"], R["court"]["width_doubles_m"], R["court"]["width_singles_m"]
INSET, SVC, NET = (WD-WS)/2, 6.40, L/2
SH, B, RA = R["shots"], R["bounces"], R["rallies"]
t0, t1 = R["window"]
tot = R["totals"]
C1, C2, CB = "#4aa8ff", "#ff5c5c", "#3ddc84"
MGL, MGW = 3.2, 1.6                       # 코트 밖 여백 (길이/폭 방향)
SPL, SPW = L+2*MGL, WD+2*MGW
SEG = [((0,0),(WD,0)), ((WD,0),(WD,L)), ((WD,L),(0,L)), ((0,L),(0,0)),
       ((INSET,0),(INSET,L)), ((WD-INSET,0),(WD-INSET,L)),
       ((INSET,NET-SVC),(WD-INSET,NET-SVC)), ((INSET,NET+SVC),(WD-INSET,NET+SVC)),
       ((WD/2,NET-SVC),(WD/2,NET+SVC))]


def mk(vw, vh, pad):
    """코트를 가로로 눕힌다: 코트 길이 -> 화면 가로, 코트 폭 -> 화면 세로."""
    fx = lambda cy: pad + (cy+MGL)/SPL*(vw-2*pad)
    fy = lambda cx: pad + (cx+MGW)/SPW*(vh-2*pad)
    return fx, fy


def court_svg(fx, fy, lw=1.2):
    g = "".join(f'<line x1="{fx(a[1]):.1f}" y1="{fy(a[0]):.1f}" x2="{fx(b[1]):.1f}" '
                f'y2="{fy(b[0]):.1f}" stroke="#4c5867" stroke-width="{lw}"/>' for a, b in SEG)
    g += (f'<line x1="{fx(NET):.1f}" y1="{fy(0):.1f}" x2="{fx(NET):.1f}" y2="{fy(WD):.1f}" '
          f'stroke="#8296b0" stroke-width="{lw*1.6:.1f}" stroke-dasharray="4 3"/>')
    return g


def trail_svg(pts, fx, fy, col):
    out, cur = [], []
    for p in pts:
        if cur and (abs(p[0]-cur[-1][0]) > 2.5 or abs(p[1]-cur[-1][1]) > 2.5):
            if len(cur) > 1:
                out.append(cur)
            cur = []
        cur.append(p)
    if len(cur) > 1:
        out.append(cur)
    return "".join(
        f'<polyline points="{" ".join(f"{fx(y):.1f},{fy(x):.1f}" for x, y in sg)}" '
        f'fill="none" stroke="{col}" stroke-width="1.2" stroke-opacity=".7"/>' for sg in out)


def rally_map(w, r, vw=300, vh=176, pad=11):
    col = C1 if w == 1 else C2
    fx, fy = mk(vw, vh, pad)
    g = court_svg(fx, fy)
    g += trail_svg(r["track"][f"P{w}"], fx, fy, col)
    ss = [x for x in SH if r["start"]-0.5 <= x["t"] <= r["end"]+0.5]
    for b in B:                                        # 그가 보낸 공의 낙구
        if not (r["start"]-0.5 <= b["t"] <= r["end"]+1.5):
            continue
        pv = [x for x in ss if x["t"] <= b["t"]]
        if not pv or pv[-1]["who"] != w:
            continue
        x, y = fx(b["pos"][1]), fy(b["pos"][0])
        g += (f'<g stroke="{CB}" stroke-width="2.1" stroke-linecap="round">'
              f'<line x1="{x-4.5:.1f}" y1="{y-4.5:.1f}" x2="{x+4.5:.1f}" y2="{y+4.5:.1f}"/>'
              f'<line x1="{x-4.5:.1f}" y1="{y+4.5:.1f}" x2="{x+4.5:.1f}" y2="{y-4.5:.1f}"/></g>')
    mine = sorted([x for x in ss if x["who"] == w and x.get("pos")],
                  key=lambda x: x.get("rally_shot_no", 0))
    if len(mine) > 1:
        pl = " ".join(f"{fx(m['pos'][1]):.1f},{fy(m['pos'][0]):.1f}" for m in mine)
        g += (f'<polyline points="{pl}" fill="none" stroke="{col}" stroke-width="1" '
              f'stroke-opacity=".3" stroke-dasharray="3 3"/>')
    for m in mine:
        cx, cy = fx(m["pos"][1]), fy(m["pos"][0])
        isF = (m.get("swing") or "")[:1] == "F"
        n_ = m.get("rally_shot_no", 0)
        g += (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="9" fill="{col if isF else "#0d1219"}" '
              f'stroke="{col}" stroke-width="1.8">'
              f'<title>{n_}번째 · {m.get("swing","")} '
              f'({m["pos"][0]:.1f},{m["pos"][1]:.1f})m</title></circle>'
              f'<text x="{cx:.1f}" y="{cy+3.4:.1f}" text-anchor="middle" font-size="10" '
              f'font-weight="700" fill="{"#0d1219" if isF else col}">{n_}</text>')
    return f'<svg width="{vw}" height="{vh}" viewBox="0 0 {vw} {vh}">{g}</svg>'


def move_map(w, vw=430, vh=250, pad=18):
    """이동 경로 + 타격 위치(순번, 포핸드/백핸드)."""
    col = C1 if w == 1 else C2
    fx, fy = mk(vw, vh, pad)
    g = court_svg(fx, fy, 1.4)
    for r in RA:
        g += trail_svg(r["track"][f"P{w}"], fx, fy, col).replace(
            'stroke-opacity=".7"', 'stroke-opacity=".3"')
    mine = [x for x in SH if x["who"] == w and x.get("pos")]
    mine.sort(key=lambda x: x["t"])
    for i, x_ in enumerate(mine, 1):
        cx, cy = fx(x_["pos"][1]), fy(x_["pos"][0])
        isF = (x_.get("swing") or "")[:1] == "F"
        g += (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="9.5" '
              f'fill="{col if isF else "#0a1017"}" stroke="{col}" stroke-width="1.8">'
              f'<title>{i}번째 타격 · {x_.get("swing","")} · '
              f'{x_["t"]-t0:.1f}s ({x_["pos"][0]:.1f}, {x_["pos"][1]:.1f})m</title></circle>'
              f'<text x="{cx:.1f}" y="{cy+3.5:.1f}" text-anchor="middle" font-size="10" '
              f'font-weight="700" fill="{"#0a1017" if isF else col}">{i}</text>')
    return f'<svg width="{vw}" height="{vh}" viewBox="0 0 {vw} {vh}">{g}</svg>'


def placement_map(w, vw=430, vh=250, pad=18):
    """그가 보낸 공의 낙구 지점만."""
    col = C1 if w == 1 else C2
    fx, fy = mk(vw, vh, pad)
    g = court_svg(fx, fy, 1.4)
    for x in (WD/3, 2*WD/3):
        g += (f'<line x1="{fx(0):.1f}" y1="{fy(x):.1f}" x2="{fx(L):.1f}" y2="{fy(x):.1f}" '
              f'stroke="#2c3746" stroke-width="1" stroke-dasharray="3 4"/>')
    for b in B:
        pv = [x for x in SH if x["t"] <= b["t"]]
        if not pv or pv[-1]["who"] != w:
            continue
        cx, cy = fx(b["pos"][1]), fy(b["pos"][0])
        g += (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="7" fill="{col}" fill-opacity=".9" '
              f'stroke="#080b11" stroke-width="1.3">'
              f'<title>낙구 {b["t"]-t0:.1f}s ({b["pos"][0]:.1f}, {b["pos"][1]:.1f})m</title></circle>')
    return f'<svg width="{vw}" height="{vh}" viewBox="0 0 {vw} {vh}">{g}</svg>'


def side(w):
    s = [x for x in SH if x["who"] == w]
    c = Counter(x["swing"] for x in s if x.get("swing"))
    land = [b["pos"] for b in B
            if [x for x in SH if x["t"] <= b["t"]]
            and [x for x in SH if x["t"] <= b["t"]][-1]["who"] == w]
    tr = [p for r in RA for p in r["track"][f"P{w}"]]
    dist = sum(((a[0]-b[0])**2+(a[1]-b[1])**2)**.5
               for r in RA for a, b in zip(r["track"][f"P{w}"], r["track"][f"P{w}"][1:])
               if abs(a[0]-b[0]) < 2.5 and abs(a[1]-b[1]) < 2.5)
    per = [sum(1 for x in SH if x["who"] == w and r["start"]-0.5 <= x["t"] <= r["end"]+0.5)
           for r in RA if r["shots"] >= 2]
    return dict(n=len(s), fh=c.get("Forehand", 0), bh=c.get("Backhand", 0), land=land,
                per_rally=sum(per)/max(len(per), 1), rallies=len(per),
                rng=(max(p[0] for p in tr)-min(p[0] for p in tr)) if tr else 0, dist=dist,
                xs=[x["pos"][0] for x in s if x.get("pos")])


A, Bp = side(1), side(2)


def zones(d):
    lf = sum(1 for p in d["land"] if p[0] < WD/3)
    rt = sum(1 for p in d["land"] if p[0] >= 2*WD/3)
    return lf, len(d["land"])-lf-rt, rt


def insight(w):
    d = A if w == 1 else Bp
    o = Bp if w == 1 else A
    tot_sw = max(d["fh"]+d["bh"], 1)
    fh = d["fh"]/tot_sw*100
    lf, md, rt = zones(d)
    li = [f'랠리당 평균 <b>{d["per_rally"]:.1f}타</b>를 쳤습니다 (상대 {o["per_rally"]:.1f}타).',
          f'좌우 <b>{d["rng"]:.1f} m</b> 범위에서 움직였고 총 이동거리 <b>{d["dist"]:.0f} m</b>'
          f' — 상대({o["dist"]:.0f} m)의 <b>{d["dist"]/max(o["dist"], 1):.1f}배</b>입니다.',
          f'포핸드 <b>{fh:.0f}%</b> ({d["fh"]}/{tot_sw}), 백핸드 {100-fh:.0f}% ({d["bh"]}/{tot_sw}).']
    if d["land"]:
        big = max((lf, "왼쪽"), (md, "가운데"), (rt, "오른쪽"))
        li.append(f'보낸 공 {len(d["land"])}개가 상대 코트 <b>{big[1]}에 {big[0]}개</b> '
                  f'(왼 {lf} · 중 {md} · 우 {rt})로 떨어졌습니다.')
    if d["xs"]:
        li.append(f'타격 위치는 코트 폭 {WD:.1f} m 중 '
                  f'<b>{min(d["xs"]):.1f}~{max(d["xs"]):.1f} m</b>에 분포합니다.')
    return "".join(f"<li>{x}</li>" for x in li)


def stat(v, lb):
    return f'<div class="st"><div class="sv">{v}</div><div class="sl">{lb}</div></div>'


def section(w, name):
    d = A if w == 1 else Bp
    col = C1 if w == 1 else C2
    lf, md, rt = zones(d)
    n = max(len(d["land"]), 1)
    tw = max(d["fh"]+d["bh"], 1)
    return f'''<div class="psec">
  <div class="phead"><i class="dot" style="background:{col}"></i><b>{name}</b>
    <span class="phn">{d["n"]}타 · 낙구 {len(d["land"])}개</span></div>
  <div class="maps">
    <div class="mp">
      <div class="mph">낙구 지점</div>
      <div class="zrow"><span>{lf/n*100:.0f}%</span><span>{md/n*100:.0f}%</span><span>{rt/n*100:.0f}%</span></div>
      {placement_map(w)}
      <div class="mpc">상대 코트 좌 · 중 · 우 분포</div>
    </div>
    <div class="mp">
      <div class="mph">이동 경로 · 타격 위치</div>
      {move_map(w)}
      <div class="mpc">원 안 숫자 = 타격 순서 · 채움 = 포핸드, 비움 = 백핸드</div>
    </div>
  </div>
  <div class="pnums">
    {stat(f'{d["per_rally"]:.1f}', "랠리당 타격")}
    {stat(f'{d["fh"]/tw*100:.0f}<em>%</em>', f'포핸드 {d["fh"]}/{tw}')}
    {stat(f'{d["bh"]/tw*100:.0f}<em>%</em>', f'백핸드 {d["bh"]}/{tw}')}
    {stat(f'{len(d["land"])/max(d["n"],1)*100:.0f}<em>%</em>', "타격 중 낙구 추적")}
    {stat(f'{d["dist"]:.0f}<em>m</em>', "이동거리")}
    {stat(f'{d["rng"]:.1f}<em>m</em>', "좌우 범위")}
  </div>
  <ul class="ins">{insight(w)}</ul>
</div>'''


html = f"""<!doctype html><meta charset="utf-8"><title>ACE 랠리 리뷰</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;background:#080b11;color:#eaf0f7;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}}
.wrap{{width:1000px;margin:0 auto;padding:30px 24px 46px}}
h1{{font-size:21px;margin:0 0 4px;letter-spacing:-.3px}}
.meta{{font-size:12px;color:#7a8899;margin-bottom:18px}}
.legend{{display:flex;gap:20px;font-size:11.5px;color:#8695a8;margin-bottom:18px;flex-wrap:wrap;
 background:#0e141d;border:1px solid #1a2330;border-radius:10px;padding:11px 15px}}
.dot{{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}}
.ln{{display:inline-block;width:15px;height:2px;margin-right:6px;vertical-align:middle}}
.rowline{{display:flex;gap:12px;margin-bottom:18px}}
.big{{flex:1;background:#0e141d;border:1px solid #1a2330;border-radius:14px;padding:16px 18px}}
.bv{{font-size:27px;font-weight:680;letter-spacing:-.6px}}
.bl{{font-size:11.5px;color:#7a8899;margin-top:2px}}
.psec{{background:#0e141d;border:1px solid #1a2330;border-radius:16px;
 padding:18px 20px 16px;margin-bottom:16px}}
.phead{{display:flex;align-items:center;gap:8px;font-size:15px;margin-bottom:14px}}
.phead .pn{{font-size:11px;color:#7a8899;font-weight:400}}

.st{{flex:1;text-align:center;border-right:1px solid #182130}}
.st:last-child{{border-right:none}}
.sv{{font-size:20px;font-weight:670;letter-spacing:-.4px}}
.sv em{{font-style:normal;font-size:11px;color:#7a8899;margin-left:1px}}
.sl{{font-size:10.5px;color:#7a8899;margin-top:2px}}
.phn{{margin-left:auto;font-size:12px;color:#8695a8}}
.maps{{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}}
.mp{{background:#0a1017;border:1px solid #182130;border-radius:12px;padding:11px 10px 9px}}
.mph{{font-size:11.5px;color:#c3ceda;font-weight:600;padding:0 4px 7px}}
.mpc{{font-size:10px;color:#6e7d90;text-align:center;margin-top:6px}}
.zrow{{display:flex;font-size:11.5px;color:#93a2b7;padding:0 18px 3px;font-variant-numeric:tabular-nums}}
.zrow span{{flex:1;text-align:center}}
.zcap{{font-size:10.5px;color:#6e7d90;text-align:center;margin-top:6px}}
.pnums{{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}}
.pnums .st{{background:#0a1017;border:1px solid #182130;border-radius:11px;padding:13px 6px;
 border-right:1px solid #182130}}
.ins{{margin:16px 0 0;padding-left:18px;font-size:12.5px;line-height:2;color:#9fb0c4}}
.ins b{{color:#eaf0f7;font-weight:600}}
</style>
<div class="wrap">
<h1>랠리 리뷰</h1>
<div class="meta">{os.path.basename(R["video"])} · {t0:.0f}–{t1:.0f}s · 랠리 {len(RA)}개</div>

<div class="legend">
  <span><i class="ln" style="background:{C1}"></i>{N1}</span>
  <span><i class="ln" style="background:{C2}"></i>{N2}</span>

</div>

{section(1, N1)}
{section(2, N2)}
</div>
"""
open(OUT, "w").write(html)
print(OUT)
