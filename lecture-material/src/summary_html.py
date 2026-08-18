#!/usr/bin/env python3
"""지시서 → 강의 요약 웹페이지.

편집된 영상은 한 번 보고 끝이지만, 요약은 남는다. 지시서에 이미
씬 구조·길이·핵심 자막이 다 있으니 그걸로 만든다.

대표 장면은 원본에서 뽑아 인물 중심으로 크롭한 뒤 페이지에 심는다
(s1 의 subject_track 을 그대로 쓴다 — 영상과 같은 화각).

usage: python summary_html.py [run_dir] [out.html]
"""
import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMG_W = 760
REFRAME = 1.18


def shot(clip: str, at: float, track: dict) -> str:
    """원본 한 프레임을 인물 중심으로 잘라 data URI 로."""
    got = [s for s in track.get(clip, {}).get("samples", []) if s]
    cx = 0.5
    if got:
        near = min(got, key=lambda s: abs(s["t"] - at))
        cx = (near["x0"] + near["x1"]) / 2
    cw, ch = int(1920 / REFRAME) // 2 * 2, int(1080 / REFRAME) // 2 * 2
    x = int(min(max(1920 * cx - cw / 2, 0), 1920 - cw)) // 2 * 2
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{at:.2f}", "-i", str(ROOT / "raw" / f"{clip}.mp4"),
         "-frames:v", "1", "-vf", f"crop={cw}:{ch}:{x}:80,scale={IMG_W}:-2",
         "-q:v", "6", "-f", "image2", "-c:v", "mjpeg", "-"], capture_output=True)
    return "data:image/jpeg;base64," + base64.b64encode(r.stdout).decode()


def tc(sec: float) -> str:
    m, s = int(sec // 60), int(round(sec % 60))
    return f"{m}분 {s}초" if m else f"{s}초"


CSS = """
:root{--navy:#17335F;--yellow:#E4EF3D;--ink:#1B2233;--ink-soft:#67718A;
 --rule:#E4E7EE;--ground:#F4F5F8;--card:#FFF}
*{box-sizing:border-box}
body{margin:0;background:#DDE0E7;color:var(--ink);line-height:1.65;word-break:keep-all;
 font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo",-apple-system,system-ui,sans-serif;
 -webkit-font-smoothing:antialiased}
.phone{max-width:430px;margin:0 auto;background:var(--ground);min-height:100vh}
@media(min-width:520px){.phone{margin:24px auto;min-height:0;border-radius:18px;overflow:hidden}}
header{background:var(--navy);color:#fff;padding:28px 22px 24px}
header .eyebrow{font-size:.7rem;letter-spacing:.16em;color:var(--yellow);text-transform:uppercase;
 margin:0 0 10px;font-weight:700}
header h1{margin:0 0 6px;font-size:1.55rem;font-weight:800;letter-spacing:-.02em}
header .meta{margin:0 0 14px;font-size:.84rem;color:#B9C3D8;font-weight:500}
header .goal{margin:0;font-size:.93rem;color:#E7EBF4}
nav{background:var(--card);border-bottom:1px solid var(--rule);padding:16px 22px 18px}
nav p{margin:0 0 8px;font-size:.74rem;color:var(--ink-soft);font-weight:700}
nav ol{margin:0;padding:0 0 0 1.4em;font-size:.92rem}
nav li{margin:4px 0}
nav a{color:var(--ink);text-decoration:none;font-weight:500}
nav .t{color:var(--ink-soft);font-size:.78rem;margin-left:6px;font-weight:400}
.unit{background:var(--card);margin:12px 0;padding-bottom:24px}
.unit-head{padding:20px 22px 14px}
.unit-head .no{display:inline-block;background:var(--yellow);color:var(--navy);font-weight:800;
 font-size:.72rem;letter-spacing:.06em;padding:3px 10px;border-radius:999px;margin-bottom:10px}
.unit-head h2{margin:0 0 4px;font-size:1.16rem;font-weight:800;letter-spacing:-.015em}
.unit-head .meta{margin:0;font-size:.8rem;color:var(--ink-soft)}
video{width:100%;height:auto;display:block;background:#000}
.body{padding:24px 22px 4px}
.body p{margin:0;font-size:.94rem}
.body p.label{font-size:.8rem;color:var(--navy);font-weight:800;margin:26px 0 10px}
.body p.label:first-child{margin-top:0}
.points{margin:0;padding-left:1.15em;font-size:.92rem}
.points li{margin:5px 0}
.fix{border-left:3px solid var(--yellow);background:#FBFCEF;padding:12px 15px;font-size:.9rem;
 border-radius:0 6px 6px 0}
.fix .err{color:var(--ink-soft)}
.fix .cue{font-weight:700;margin-top:4px}
figure{margin:0}
figure img{width:100%;height:auto;display:block;border-radius:8px}
figcaption{font-size:.78rem;color:var(--ink-soft);margin-top:7px}
.slides{overflow:hidden}
.track{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;
 -webkit-overflow-scrolling:touch;scrollbar-width:none}
.track::-webkit-scrollbar{display:none}
.slide{flex:0 0 100%;scroll-snap-align:start}
.dots{display:flex;gap:5px;justify-content:center;margin-top:10px}
.dots i{width:6px;height:6px;border-radius:50%;background:var(--rule)}
.dots i.on{background:var(--navy)}
footer{padding:20px 22px 34px;font-size:.74rem;color:var(--ink-soft);text-align:center}
"""

JS = """
document.querySelectorAll('.slides').forEach(function(box){
  var track = box.querySelector('.track'), dots = box.querySelectorAll('.dots i');
  track.addEventListener('scroll', function(){
    var i = Math.round(track.scrollLeft / track.clientWidth);
    dots.forEach(function(d, k){ d.classList.toggle('on', k === i); });
  }, {passive:true});
});
"""


def unit(no, uid, title, meta, video, blocks, shots):
    L = [f'<section class="unit" id="{uid}"><div class="unit-head">',
         f'<span class="no">{no}</span><h2>{title}</h2><p class="meta">{meta}</p></div>']
    if video:
        L.append(f'<video controls preload="metadata" playsinline src="{video}"></video>')
    L.append('<div class="body">')
    for label, kind, val in blocks:
        L.append(f'<p class="label">{label}</p>')
        if kind == "p":
            L.append(f"<p>{val}</p>")
        elif kind == "ul":
            L.append('<ul class="points">' + "".join(f"<li>{x}</li>" for x in val) + "</ul>")
        elif kind == "fix":
            L.append(f'<div class="fix"><div class="err">{val[0]}</div>'
                     f'<div class="cue">{val[1]}</div></div>')
    if shots:
        L.append('<p class="label">기억할 장면</p><div class="slides"><div class="track">')
        for src, cap in shots:
            L.append(f'<figure class="slide"><img src="{src}" alt="{cap}" loading="lazy">'
                     f"<figcaption>{cap}</figcaption></figure>")
        L.append('</div><div class="dots">'
                 + "".join('<i class="on"></i>' if i == 0 else "<i></i>"
                           for i in range(len(shots))) + "</div></div>")
    L.append("</div></section>")
    return "".join(L)


def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "runs/002"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs/lecture_summary.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    track = json.loads(
        (run_dir / "s1_audio_visual_data_fusion/output/subject_track.json").read_text())
    d = json.loads((run_dir / "s2_storyline_and_directive/output/directive_H.json").read_text())
    dur = {s["scene_id"]: sum(r["end"] - r["start"] for r in (s.get("a_roll") or []))
           for s in d["scenes"]}
    u1, u2 = dur["sc02"], dur["sc04"] + dur["sc05"]
    u3, u4 = dur["sc07"] + dur["sc07b"], dur["sc10"]
    u5 = dur["sc11"] + dur["sc12"]
    total = u1 + u2 + u3 + u4 + u5

    S = lambda c, t: shot(c, t, track)
    html = [
        '<header><p class="eyebrow">Forehand · 3 Keys</p><h1>포핸드 핵심 세 가지</h1>',
        f'<p class="meta">중급 · {tc(total)} · 유닛 4개 · 김기준 코치</p>',
        '<p class="goal">시선·골반·피니시 세 가지만 맞추면 파워와 정확도가 같이 올라갑니다. '
        '거리 잡기부터 스윙 마무리까지 순서대로 익힙니다.</p></header>',
        '<nav><p>목차</p><ol>'
        f'<li><a href="#u1">오늘 배울 세 가지</a><span class="t">{tc(u1)}</span></li>'
        f'<li><a href="#u2">시선과 거리 잡기</a><span class="t">{tc(u2)}</span></li>'
        f'<li><a href="#u3">골반 회전</a><span class="t">{tc(u3)}</span></li>'
        f'<li><a href="#u4">피니시 공간</a><span class="t">{tc(u4)}</span></li>'
        f'<li><a href="#summary">세 가지로 기억하기</a><span class="t">정리</span></li>'
        "</ol></nav>",

        unit("UNIT 1", "u1", "오늘 배울 세 가지", f"{tc(u1)} · 목차",
             "../runs/c01_01_v4/s7_polish_master/output/master.mp4",
             [("목표", "p", "포핸드에서 파워와 정확도를 가르는 세 가지를 먼저 잡고 들어간다."),
              ("배울 순서", "ul", ["시선 — 거리 잡기",
                                "골반 회전 — 오른발을 축으로",
                                "피니시 — 가슴과 팔 사이 공간"]),
              ("왜 이 세 가지인가", "p",
               "세 가지가 맞아떨어져야 파워가 실리고, 정확도가 올라가고, "
               "원하는 코스로 공을 보낼 수 있습니다.")],
             [(S("c01_01", 8.0), "목차를 짚는 장면 — 시선·골반·피니시")]),

        unit("UNIT 2", "u2", "시선과 거리 잡기", f"{tc(u2)} · 개념 + 시범",
             None,
             [("목표", "p", "공을 정면이 아니라 옆으로 두고 봐서 타점 거리를 멀리 확보한다."),
              ("동작 설명", "p",
               "포핸드로 결정한 순간 유닛턴을 하면서 상대를 째려봅니다. 째려보면 정면에 있던 공이 "
               "옆으로 옮겨지고, 그만큼 타점을 멀리 둘 수 있습니다. 그리고 임팩트하는 순간까지 "
               "공에서 눈을 떼지 않습니다."),
              ("핵심 포인트", "ul", ["① 유닛턴 — 몸을 먼저 옆으로 튼다",
                                 "② 공 째려보기 — 시선을 옆으로 옮긴다",
                                 "③ 임팩트까지 바라보기 — 고개를 미리 돌리지 않는다"]),
              ("흔한 실수", "fix",
               ("정면으로 보고 가다가 첫 스텝이 정면으로 빠진다. 가까워져서 당기는 스윙이 나온다.",
                "\"멀어서 실수하는 것보다 가까워서 실수하는 경우가 많거든요\"")),
              ("왜 끝까지 봐야 하나", "p",
               "임팩트 전에 고개를 돌리면 공을 예측해서 휘두르게 됩니다. 끝까지 보면 공이 "
               "순간적으로 잘못 튀어도 어떻게든 임팩트를 가져갈 수 있습니다.")],
             [(S("c01_02", 30.0), "정면으로 빠져 자세가 무너지는 흔한 실수"),
              (S("c01_02", 57.5), "유닛턴하며 상대를 째려보는 순간"),
              (S("c01_06", 3.0), "유닛턴 시범 — 발과 상체가 같이 돈다")]),

        unit("UNIT 3", "u3", "골반 회전", f"{tc(u3)} · 개념 + 시범",
             None,
             [("목표", "p", "오른발을 축으로 골반을 먼저 돌려 채찍 같은 파워를 만든다."),
              ("동작 설명", "p",
               "왼발로 스탠스를 잡아 누르고, 오른발을 먼저 써서 골반 회전을 만듭니다. "
               "골반이 라켓보다 먼저 돌아야 몸이 따라 나오면서 채찍처럼 파워가 실립니다. "
               "이때 오른발을 땅에 버티지 말고 스윙 속도에 맞춰 자연스럽게 끌려 나가야 "
               "회전이 완성됩니다."),
              ("핵심 포인트", "ul", ["① 오른발 돌리며 골반 회전",
                                 "② 몸이 라켓보다 먼저 따라간다",
                                 "③ 라켓을 채찍처럼 — 마지막에 나온다"]),
              ("흔한 실수", "fix",
               ("오른발 축이 뒤에 남아 몸이 뒤로 무너진다. 발을 고정하고 버티면 당기는 스윙이 된다.",
                "\"발을 버티면 안 되고 오히려 그냥 가듯이 끌려 나가야 돼요\"")),
              ("시선과 함께", "p",
               "시선과 골반은 따로 쓰는 게 아니라 같이 씁니다. 시선으로 거리를 잡고, "
               "그 자리에서 골반을 돌립니다.")],
             [(S("c01_03", 33.0), "왼발로 스탠스를 눌러 잡은 상태"),
              (S("c01_03", 60.0), "오른발을 축으로 골반이 먼저 도는 순간"),
              (S("c01_07", 4.0), "골반 회전 시범 — 후면에서 본 축 이동")]),

        unit("UNIT 4", "u4", "피니시 공간", f"{tc(u4)} · 개념 + 소품",
             None,
             [("목표", "p", "가슴과 팔 사이에 공간을 만들어 라켓 헤드를 던지듯 마무리한다."),
              ("동작 설명", "p",
               "겨드랑이와 팔이 붙으면 당기는 스윙이 나옵니다. 테이크백을 잘 만들어 놓고도 "
               "스윙이 안 나오는 이유가 여기 있습니다. 가슴과 팔 사이에 큰 공이 하나 있다고 "
               "생각하고 그 크기만큼 감싸면서 올라가면 피니시 거리가 만들어집니다."),
              ("핵심 포인트", "ul", ["가슴–팔 사이에 농구공 하나만큼의 공간",
                                 "오른 팔꿈치를 왼손바닥으로 밀어 올린다",
                                 "헤드를 던져준다 — 당기지 않는다"]),
              ("흔한 실수", "fix",
               ("겨드랑이와 팔을 붙인 채 당겨서 힘이 빠지고 원하는 코스로 못 보낸다.",
                "\"농구공 크기만큼만 라켓이 감싸주면 피니시가 예쁜 스윙이 만들어집니다\"")),
              ("집에서 해볼 것", "p",
               "농구공은 다이소에 다 있습니다. 왼손으로 겨드랑이와 가슴 사이를 눌러두고 "
               "그 크기만큼만 거리를 잡아보세요.")],
             [(S("c01_04", 33.0), "가슴과 팔 사이 공간을 설명하는 장면"),
              (S("c01_04", 66.0), "농구공 크기만큼 감싸는 피니시"),
              (S("c01_05", 10.0), "피니시 공간 시범 — 양 팔꿈치가 올라간다")]),

        unit("정리", "summary", "세 가지로 기억하기", "수업 후 복습", None,
             [("오늘 배운 것", "ul",
               ["① 유닛턴하고 시선 보기 — 임팩트까지 눈을 떼지 않는다",
                "② 골반 사용 — 오른발 회전으로 타점을 앞에서 밀어준다",
                "③ 공간 만들며 피니시 — 농구공 하나만큼"]),
              ("코치의 마지막 말", "fix",
               ("회원들이 공을 진짜 끝까지 안 봅니다.",
                "\"임팩트 후까지 좀 더 보고 따라간다는 느낌을 받아주시면 좋겠습니다\"")),
              ("다음까지", "p",
               "라켓 없이 손만으로도 됩니다. 유닛턴 → 오른발 회전 → 공간 만들며 마무리, "
               "세 박자로 나눠서 연습해보세요.")],
             [(S("c01_04", 115.0), "세 가지를 되짚는 마무리")]),
        f'<footer>지시서 directive_H 기준 · 총 {tc(total)}</footer>',
    ]

    out.write_text(
        '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>포핸드 핵심 세 가지 · 온라인 강의</title>"
        f"<style>{CSS}</style></head><body><main class='phone'>"
        + "".join(html) + f"</main><script>{JS}</script></body></html>")
    print(f"{out.stat().st_size/1024:.0f}KB → {out.resolve()}")


if __name__ == "__main__":
    main()
