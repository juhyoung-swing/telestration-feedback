#!/usr/bin/env python3
"""편집본 한 씬 → 강의 페이지 유닛 한 섹션.

영상·스틸·루프를 편집본에서 그대로 떠낸다. 편집본에는 그래픽(원·화살표·농구공)이
이미 화면에 박혀 있어서 따로 그릴 필요가 없다.

정지 프레임으로 안 되는 것 — 궤적, 순서 도식, 측면 도해 — 은 만들지 않고
자리와 사양만 남긴다. 사람이 생성해서 끼워 넣는다.

output: docs/unit_finish/  (index.html + video.mp4 + loop.mp4 + shot*.jpg)

usage: python unit_page.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "edited/lecture_forehand.webm"
OUT = ROOT / "docs/unit_finish"

UNIT = {"span": (278.5, 357.5), "title": "피니시 공간", "meta": "1분 19초"}
SHOTS = [(286.5, "겨드랑이와 팔이 붙으면 당기는 스윙이 된다"),
         (299.0, "가슴과 팔 사이에 농구공 하나만큼의 공간"),
         (323.0, "농구공 크기만큼 감싸며 올라가는 피니시")]
# 루프는 손으로 고르지 않는다. 몽타주의 이 범위 안에서 스윙 한 번을 찾아 쓴다.
# 손으로 8.5초를 잘랐더니 스윙이 두 번 들어가고 피니시 자세가 1초 만에 스쳐 지나갔다.
LOOP_RANGE = (451.0, 483.0)
LOOP_LEAD, LOOP_HOLD = 1.0, 1.6   # 스윙 앞뒤로 붙일 준비자세·피니시 유지

# 정지 프레임으로는 만들 수 없는 것. 생성해서 끼워 넣을 자리.
NEED = [
    ("① 당기는 피니시 — 하지 말 것", "참조 c01_04 25.5s. 전체 회색 + 겨드랑이에 빨간 X. "
                          "회색만으로는 '흐린 그림'이지 '하지 마라'가 아니다"),
    ("② 농구공으로 확인하기", "참조 c01_04 70.0s. 사진 속 농구공 자리를 노란 원으로 치환"),
    ("③ 완성된 피니시", "참조 c01_04 54.0s. 공 없이 공간만 노랑. "
                 "소품은 확인용이지 목적이 아니라는 걸 색으로 보여준다"),
]

BODY = {
    "목표": "가슴과 팔 사이에 공간을 만들어 라켓 헤드를 던지듯 마무리한다.",
    # 한 덩어리로 두면 안 읽힌다. 생각의 단위로 끊는다.
    "동작 설명": ["겨드랑이와 팔이 붙으면 당기는 스윙이 나옵니다. 테이크백을 잘 만들어 놓고도 "
              "스윙이 안 나오는 이유가 여기 있습니다.",
              "가슴과 팔 사이에 큰 공이 하나 있다고 생각하세요. 그 크기만큼 감싸면서 "
              "올라가면 피니시 거리가 만들어집니다.",
              "어렵다면 오른 팔꿈치를 왼손바닥으로 밀어 올리세요. 그대로 올라가면 "
              "원하는 피니시가 나옵니다."],
    "핵심 포인트": ["가슴–팔 사이에 농구공 하나만큼의 공간",
                "오른 팔꿈치를 왼손바닥으로 밀어 올린다",
                "헤드를 던져준다 — 당기지 않는다"],
    "흔한 실수": ("겨드랑이와 팔을 붙인 채 당겨서 힘이 빠지고 원하는 코스로 못 보낸다.",
              "\"농구공 크기만큼만 라켓이 감싸주면 피니시가 예쁜 스윙이 만들어집니다\""),
}


def find_loop(src: Path, a: float, b: float):
    """스윙 한 번과 그 뒤 피니시 유지가 들어간 구간을 찾는다.

    프레임간 변화량으로 움직임이 터지는 덩어리를 찾고, 그 뒤로 얼마나 오래
    멈춰 있는지를 같이 본다. 세게 휘두르고 오래 들고 있는 곳이 좋은 루프다."""
    import numpy as np
    HZ, W_, H_ = 20, 160, 90
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{a}", "-i", str(src), "-t", f"{b - a}",
                        "-an", "-vf", f"fps={HZ},scale={W_}:{H_},format=gray",
                        "-f", "rawvideo", "-"], capture_output=True)
    x = np.frombuffer(r.stdout, dtype=np.uint8).astype(np.float32) / 255
    fr = x[: len(x) // (W_ * H_) * (W_ * H_)].reshape(-1, H_, W_)
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    thr = float(np.percentile(d, 72))

    bursts, i = [], 0
    while i < len(d):
        if d[i] > thr:
            j = i
            while j + 1 < len(d) and d[j + 1] > thr * 0.6:
                j += 1
            if (j - i) / HZ > 0.4:
                bursts.append((i, j, float(d[i:j + 1].max())))
            i = j + 1
        else:
            i += 1
    if not bursts:
        return a, a + 3.0

    # 다음 움직임까지의 정지 시간 = 피니시를 들고 있는 시간
    best, score = None, -1.0
    for k, (i, j, pk) in enumerate(bursts):
        nxt = bursts[k + 1][0] if k + 1 < len(bursts) else len(d)
        hold = (nxt - j) / HZ
        v = pk * min(hold, 2.0)
        prev = bursts[k - 1][1] if k else 0
        lead = (i - prev) / HZ
        if lead < LOOP_LEAD or v <= score:      # 앞에 준비자세 여유가 있어야 한다
            continue
        best, score = (a + i / HZ, a + j / HZ, pk, hold), v
    st, en, pk, hold = best
    return max(a, st - LOOP_LEAD), min(b, en + min(hold - 0.2, LOOP_HOLD))


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-1200:])
        raise SystemExit(1)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    a, b = UNIT["span"]

    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{a}", "-i", str(SRC), "-t", f"{b - a}",
        "-vf", "scale=1280:-2,fps=30", "-c:v", "h264_videotoolbox", "-b:v", "3M",
        "-c:a", "aac", "-b:a", "128k", str(OUT / "video.mp4")])

    ls, le = find_loop(SRC, *LOOP_RANGE)
    print(f"루프 {ls:.2f} – {le:.2f}  ({le-ls:.2f}초)")
    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{ls}", "-i", str(SRC), "-t", f"{le - ls}",
        "-an", "-vf", "scale=720:-2,fps=24", "-c:v", "h264_videotoolbox", "-b:v", "1600k",
        str(OUT / "loop.mp4")])

    for i, (t, _) in enumerate(SHOTS, 1):
        sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{t}", "-i", str(SRC),
            "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4", str(OUT / f"shot{i}.jpg")])
    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{SHOTS[1][0]}", "-i", str(SRC),
        "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4", str(OUT / "poster.jpg")])

    H = [f"""<header><p class="eyebrow">Forehand · 3 Keys</p>
<h1>{UNIT['title']}</h1><p class="meta">UNIT 4 · {UNIT['meta']}</p></header>
<section class="unit">
  <video controls preload="metadata" playsinline poster="poster.jpg" src="video.mp4"></video>
  <div class="body">"""]
    # 목표는 글보다 움직임이 빠르다. 루프를 목표 바로 밑에 붙인다.
    H.append(f'<p class="label">목표</p><p>{BODY["목표"]}</p>'
             f'<figure class="goal"><video class="loop" autoplay muted loop playsinline '
             f'src="loop.mp4"></video>'
             f'<figcaption>이 움직임을 만드는 것이 목표입니다</figcaption></figure>')  # noqa
    H.append('<p class="label">동작 설명</p>'
             + "".join(f"<p>{x}</p>" for x in BODY["동작 설명"]))
    H.append('<p class="label">핵심 포인트</p><ul class="points">'
             + "".join(f"<li>{x}</li>" for x in BODY["핵심 포인트"]) + "</ul>")
    H.append('<p class="label">흔한 실수</p><div class="fix">'
             f'<div class="err">{BODY["흔한 실수"][0]}</div>'
             f'<div class="cue">{BODY["흔한 실수"][1]}</div></div>')

    H.append('<p class="label">기억할 장면</p><div class="slides"><div class="track">')
    for i, (t, cap) in enumerate(SHOTS, 1):
        H.append(f'<figure class="slide"><img src="shot{i}.jpg" alt="{cap}" loading="lazy">'
                 f'<figcaption>{cap} <span class="tt">{int(t//60):02d}:{t%60:04.1f}</span>'
                 f"</figcaption></figure>")
    H.append('</div><div class="dots">'
             + "".join('<i class="on"></i>' if i == 0 else "<i></i>"
                       for i in range(len(SHOTS))) + "</div></div>")

    H.append('<p class="label">넣을 그림</p><div class="need">')
    for name, spec in NEED:
        H.append(f'<div class="slot"><b>{name}</b><span>{spec}</span></div>')
    H.append("</div></div></section>")

    (OUT / "index.html").write_text(
        '<!doctype html><html lang=ko><head><meta charset=utf-8>'
        '<meta name=viewport content="width=device-width,initial-scale=1">'
        f"<title>{UNIT['title']} · 강의 유닛</title><style>{CSS}</style></head>"
        "<body><main class='phone'>" + "".join(H) + "</main>"
        f"<script>{JS}</script></body></html>")

    tot = sum(f.stat().st_size for f in OUT.iterdir()) / 1024 / 1024
    print(f"{OUT.name}/  파일 {len(list(OUT.iterdir()))}개 · {tot:.1f}MB")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:14s} {f.stat().st_size/1024:8.0f}KB")


CSS = """
:root{--navy:#17335F;--yellow:#E4EF3D;--ink:#1B2233;--soft:#67718A;--rule:#E4E7EE;
 --ground:#F4F5F8;--card:#fff}
*{box-sizing:border-box}
body{margin:0;background:#DDE0E7;color:var(--ink);line-height:1.65;word-break:keep-all;
 font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo",-apple-system,system-ui,sans-serif}
.phone{max-width:430px;margin:0 auto;background:var(--ground);min-height:100vh}
@media(min-width:520px){.phone{margin:24px auto;min-height:0;border-radius:18px;overflow:hidden}}
header{background:var(--navy);color:#fff;padding:28px 22px 24px}
.eyebrow{font-size:.7rem;letter-spacing:.16em;color:var(--yellow);margin:0 0 10px;font-weight:700}
header h1{margin:0 0 6px;font-size:1.55rem;font-weight:800;letter-spacing:-.02em}
header .meta{margin:0;font-size:.84rem;color:#B9C3D8;font-weight:500}
.unit{background:var(--card);margin:12px 0;padding-bottom:24px}
video{width:100%;height:auto;display:block;background:#000}
.body{padding:24px 22px 4px}
.body p{margin:0 0 11px;font-size:.94rem}
.body p:last-of-type{margin-bottom:0}
figure.goal{margin:14px 0 0}
.body p.label{font-size:.8rem;color:var(--navy);font-weight:800;margin:32px 0 10px}
.body p.label:first-child{margin-top:0}
.points{margin:0;padding-left:1.15em;font-size:.92rem}
.points li{margin:5px 0}
.fix{border-left:3px solid var(--yellow);background:#FBFCEF;padding:12px 15px;font-size:.9rem;
 border-radius:0 6px 6px 0}
.fix .err{color:var(--soft)}
.fix .cue{font-weight:700;margin-top:4px}
figure{margin:0}
figure img,video.loop{width:100%;height:auto;display:block;border-radius:8px}
figcaption{font-size:.78rem;color:var(--soft);margin-top:7px}
figcaption .tt{font:10px ui-monospace,Menlo,monospace;color:#A8AFBE;margin-left:4px}
.slides{overflow:hidden}
.track{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
.track::-webkit-scrollbar{display:none}
.slide{flex:0 0 100%;scroll-snap-align:start}
.dots{display:flex;gap:5px;justify-content:center;margin-top:10px}
.dots i{width:6px;height:6px;border-radius:50%;background:var(--rule)}
.dots i.on{background:var(--navy)}
.need{display:grid;gap:8px}
.slot{border:1.5px dashed #C3CAD8;border-radius:9px;padding:12px 14px;background:#FAFBFD}
.slot b{display:block;font-size:.86rem;margin-bottom:3px}
.slot span{font-size:.79rem;color:var(--soft)}
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


if __name__ == "__main__":
    main()
