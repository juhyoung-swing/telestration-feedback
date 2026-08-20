#!/usr/bin/env python3
"""수강생에게 주는 두 장 — 수업 전 / 수업 후.

코칭 앱의 레슨 카드 문법을 따른다. 도해가 맨 위, 글은 짧게.
읽기 전에 보여야 한다. 글을 먼저 읽으면 뭘 상상할지 모르고,
도해를 먼저 보면 글이 그 그림을 설명하는 게 된다.

  수업 전   도해(목표) → INTRODUCTION → OVERVIEW
  수업 후   도해(대조) → RECAP → CHECKPOINTS → FIX → DRILL

뒤집히는 게 둘이다.
  상단 도해가 '목표 자세' 에서 '잘못 ↔ 올바름' 으로
  본체가 OVERVIEW(설명) 에서 CHECKPOINTS(확인) 으로

수업 전에 오답을 보이면 목표와 섞인다. 아직 자기 폼을 모르니까.
수업 후엔 반대다 — 쳐봤으니 '내가 왼쪽인가 오른쪽인가' 를 판단할 수 있다.

output: lecture-summary/output/before.html · after.html · 에셋

usage: python student_pages.py
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EDIT = ROOT / "edited/lecture_forehand.webm"
OUT = Path(__file__).resolve().parents[1] / "output"   # lecture-summary/output

LESSON = {
    # 제목은 지어내지 않는다. 인트로 후녹음이 곧 제목이다 —
    # 편집이 끝난 뒤 따로 녹음해 맨 앞에 붙인 문장이니 그게 제목으로 고른 말이다.
    "title": "선수처럼 강력한 포핸드 — 핵심 3가지",
    "coach": "김기준 코치",
    "minutes": 8,
    # 소개는 한 문장. 무엇이 길러지는지만.
    "intro": "선수처럼 강력한 포핸드를 만드는 세 가지를 익힙니다.",
    # 개요는 절차 → 목적 → 유의점 세 문장.
    # 목적 문장은 지어내지 않았다. 00:31.0 에서 코치가 직접 셋을 꼽는다.
    "overview": [
        "시선으로 타점 거리를 잡고, 골반 회전으로 파워를 만들고, 피니시에서 공간을 남깁니다.",
        "파워가 실리고, 정확도가 올라가고, 원하는 코스로 공을 보낼 수 있게 됩니다.",
    ],
    # 수업 후 첫 문장은 소개의 짝이다. '익힙니다' 의 결과를 명사로 받는다.
    # '고쳤습니다' 도 '봤습니다' 도 아니다 — 요약 페이지는 무슨 일이 있었는지가 아니라
    # 무엇이 남았는지를 적는다.
    "recap": "선수처럼 강력한 포핸드를 만드는 세 가지 팁입니다.",
}

# title/sub 는 s02 목차 자막 — 이름표다. 수업 전에 쓴다.
# after 는 s11 요약 자막을 문장으로 푼 것 — 동작 지시다. 수업 후에 쓴다.
# 코치가 앞뒤로 다르게 말하니 두 페이지가 달라 보이는 이유를 우리가 만들 필요는 없다.
# 다만 자막은 자막체라 그대로 옮기면 요약문으로 안 읽힌다. 뜻은 그대로 두고 문장으로만 편다.
#   유닛턴하고 시선보기      → 유닛턴으로 몸을 틀고 공을 끝까지 본다
#   골반사용(오른발회전)     → 오른발을 돌려 골반을 먼저 회전시킨다
#   공간만들어주며 피니쉬     → 가슴과 팔 사이에 공간을 두고 감싸 올린다
#
# bad/good 은 (동작, 결과) 두 줄이다. 대조의 요점은 자세가 아니라 '그래서 어떻게 되나' 다.
# 코치 인용은 수업 후에 넣지 않는다. 요약 페이지에 말이 그대로 들어가면 요약이 아니다.
UNITS = [
    {"key": "gaze", "no": 1, "title": "시선", "sub": "거리 잡기",
     "after": "유닛턴으로 몸을 틀고 공을 끝까지 본다",
     "diagram": "몸을 옆으로 틀고 공을 째려본다 — 시선이 닿는 곳이 타점이다",
     "before": "공을 정면으로 보고 따라가면 첫 스텝이 정면으로 빠지고, 공이 몸에 "
               "가까워져 팔로 당기게 됩니다. 몸을 옆으로 틀어 공을 째려보면 "
               "타점을 멀리 둘 수 있습니다.",
     "steps": ["유닛턴으로 몸을 먼저 튼다", "공을 째려본다", "임팩트까지 눈을 떼지 않는다"],
     "bad": ("정면으로 보고 간다", "공이 가까워 당긴다"),
     "good": ("유닛턴하고 옆을 본다", "타점을 멀리 둔다"),
     "fix": "임팩트 전에 고개를 돌리면 예측해서 휘두르게 됩니다. 끝까지 보면 "
            "공이 순간적으로 잘못 튀어도 라켓이 따라갑니다."},
    {"key": "hip", "no": 2, "title": "골반", "sub": "회전으로 파워 만들기",
     "after": "오른발을 돌려 골반을 먼저 회전시킨다",
     "diagram": "골반이 먼저 돌고 라켓은 뒤따라 나온다",
     "before": "오른발 축이 뒤에 남으면 몸이 뒤로 무너지고 파워가 안 실립니다. "
               "오른발을 먼저 돌려 골반 회전을 만들면 라켓이 뒤따라 나오며 "
               "채찍처럼 힘이 실립니다.",
     "steps": ["오른발을 돌려 회전을 만든다", "몸이 라켓보다 먼저 따라간다",
               "라켓은 마지막에 채찍처럼"],
     "bad": ("오른발을 버티고 뒤로 빠진다", "파워가 안 실린다"),
     "good": ("오른발이 돌면서 몸이 따라간다", "라켓이 채찍처럼 나온다"),
     "fix": "오른발을 땅에 버티고 있으면 안 됩니다. 스윙 속도에 맞춰 자연스럽게 끌려 "
            "나가야 회전이 완성됩니다."},
    {"key": "finish", "no": 3, "title": "피니시", "sub": "공간 만들기",
     "after": "가슴과 팔 사이에 공간을 두고 감싸 올린다",
     "diagram": "가슴과 팔 사이에 농구공 하나가 들어갈 공간을 남긴다",
     "before": "시선과 골반이 좋아도 겨드랑이가 붙으면 당기는 스윙이 됩니다. "
               "가슴과 팔 사이에 농구공 하나만큼 공간을 두고 감싸 올리면 "
               "원하는 피니시가 나옵니다.",
     # 원본에 3단계 자막이 없다. 없는 걸 지어내지 않고, 코치가 말한 확인법 한 줄만 둔다.
     "steps": ["오른 팔꿈치를 왼손바닥으로 밀어 올려 본다"],
     "bad": ("겨드랑이가 붙는다", "당겨져서 힘이 빠진다"),
     "good": ("가슴과 팔 사이가 벌어진다", "원하는 코스로 보낸다"),
     "fix": "당겨지면 힘이 빠지고 원하는 코스로 공을 보내지 못합니다."},
]

# 도해가 들어오면 실사 대신 그걸 쓴다. 파일이 없으면 실사 + '도해 준비 중' 배지.
# 저장 위치는 output/dia_<key>.png — 그대로 두고 이 스크립트를 다시 돌리면 갈린다.
def diagram(key: str):
    for ext in ("png", "jpg", "jpeg", "webp"):
        f = OUT / f"dia_{key}.{ext}"
        if f.exists():
            return f.name
    return None


# 도해가 나오기 전까지 자리를 지키는 실사 프레임.
FRAME = {"gaze": ("c01_02", 10.0, 60.0),
         "hip": ("c01_03", 49.0, 62.0),
         "finish": ("c01_04", 25.5, 54.0)}

# 루프는 무편집 시범 클립에서 뜬다. 편집본 몽타주에는 상단 체크리스트 바와
# 하단 자막이 박혀 있어서 페이지에 그대로 쓰면 글이 두 번 나온다.
# c01_05/06/07 이 애초에 그 몽타주의 원본이고 자막이 없다.
# 범위는 인물이 잡히는 구간까지만. c01_06 은 49.5초 뒤로 코치가 프레임을 벗어난다.
LOOPS = {"gaze": ("c01_06", 0.0, 49.0),
         "hip": ("c01_07", 0.0, 28.5),
         "finish": ("c01_05", 0.0, 86.0)}

# 코치가 연습량을 말한 유일한 자리다. 제목에 '골반' 을 박아 셋 중 하나만 과제인 게
# 빠진 것처럼 보이지 않게 한다. 인용은 바로 위 두 줄과 같은 말이라 뺐다.
DRILL = ("집에서 할 것 — 골반 드릴", "하루 20회 × 3세트",
         "골반이 잘 안 돌아갈 때 하는 동작입니다. 라켓 없이 해도 됩니다.",
         "한쪽 무릎을 바닥에 대면 다리를 못 쓴다 — 골반만으로 돌린다")

# 원문은 "저희 회원들을 보면 공을 진짜 끝까지 안 봐요. 임팩트 후까지 좀 더 보고
# 따라간다는 느낌을 받아주시면 좋을 것 같습니다." — 3인칭이고 구어체다.
# 뜻은 둘이다. 끝까지 봐라, 그리고 이게 제일 많이 놓치는 부분이다. 그 둘만 남긴다.
LAST = "공을 임팩트 후까지 보고 따라가세요. 세 가지 중 가장 많이 놓치는 부분입니다."


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-1200:])
        raise SystemExit(1)


def find_loop(src: Path, a: float, b: float, lead=1.0, hold=1.6, cap=5.0):
    """스윙 한 번과 그 뒤 유지가 들어간 구간. 손으로 자르면 한 사이클 반이
    들어가 자세가 스쳐 지나간다.

    cap 으로 길이를 자른다. 시범 클립은 동작이 끊기지 않고 이어져서
    움직임 덩어리가 통으로 잡히면 12초짜리가 나온다 — 루프로는 너무 길다."""
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
        return a, min(b, a + 3.0)
    best, score = None, -1.0
    for k, (i, j, pk) in enumerate(bursts):
        nxt = bursts[k + 1][0] if k + 1 < len(bursts) else len(d)
        h = (nxt - j) / HZ
        prev = bursts[k - 1][1] if k else 0
        if (i - prev) / HZ < lead or pk * min(h, 2.0) <= score:
            continue
        best, score = (a + i / HZ, a + j / HZ, h), pk * min(h, 2.0)
    if best is None:
        i, j, _ = bursts[0]
        return max(a, a + i / HZ - lead), min(b, a + j / HZ + hold)
    st, en, h = best
    lo, hi = max(a, st - lead), min(b, en + min(h - 0.2, hold))
    return (max(lo, hi - cap), hi)


def shot(clip: str, t: float, out: Path, w=640):
    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{t}", "-i", str(ROOT / "raw" / f"{clip}.mp4"),
        "-frames:v", "1", "-vf", f"crop=820:940:620:60,scale={w}:-2", "-q:v", "3", str(out)])


def clip_loop(src: Path, a: float, b: float, out: Path, clip: str = ""):
    """인물 위치는 클립마다 다르다. c01_06/07 은 후면 롱샷이라 c01_04 기준 크롭을
    그대로 쓰면 사람이 프레임 밖으로 나간다. s1 이 찾아둔 박스로 잡는다."""
    import json
    W, H = 1920, 1080
    box = None
    tr = ROOT / "runs/002/s1_audio_visual_data_fusion/output/subject_track.json"
    if clip and tr.exists():
        got = [x for x in json.loads(tr.read_text()).get(clip, {}).get("samples", [])
               if x and a <= x["t"] <= b]
        if got:
            med = lambda k: sorted(x[k] for x in got)[len(got) // 2]
            box = {k: med(k) for k in ("x0", "x1", "y0", "y1")}
    if box:
        bh = max(0.12, box["y1"] - box["y0"])
        sc = max(1.0, min(2.0, 0.66 / bh))          # 인물 키가 화면의 72% 가 되게
        cw, ch = int(W / sc) // 2 * 2, int(H / sc) // 2 * 2
        cx = (box["x0"] + box["x1"]) / 2
        x = int(min(max(W * cx - cw / 2, 0), W - cw)) // 2 * 2
        y = int(min(max(H * box["y0"] - 0.12 * ch, 0), H - ch)) // 2 * 2
        vf = f"crop={cw}:{ch}:{x}:{y},scale=720:-2,fps=24"
    else:
        vf = "scale=720:-2,fps=24"
    sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{a}", "-i", str(src), "-t", f"{b - a}",
        "-an", "-vf", vf, "-c:v", "h264_videotoolbox", "-b:v", "1600k", str(out)])


def page(kind, body):
    tabs = "".join(f'<a href="{h}" class="{"on" if h == kind else ""}">{t}</a>'
                   for h, t in (("before.html", "수업 전"), ("after.html", "수업 후")))
    label = "수업 전" if kind == "before.html" else "수업 후"
    return ('<!doctype html><html lang=ko><head><meta charset=utf-8>'
            '<meta name=viewport content="width=device-width,initial-scale=1">'
            f'<title>{LESSON["title"]}</title><style>{CSS}</style></head><body><main>'
            f'<header><a class="back" href="#">‹</a>'
            f'<div><p class="kind">{label}</p><h1>{LESSON["title"]}</h1></div></header>'
            f'<p class="meta"><span>◷ {LESSON["minutes"]} min</span>'
            f'<span>{LESSON["coach"]}</span></p>'
            f'<nav class="tabs">{tabs}</nav>{body}</main></body></html>')


def slide(u, img, cap, extra=""):
    return (f'<figure class="slide"><div class="fig">{img}</div>'
            f'<figcaption><b>{u["no"]}. {u["title"]}</b> · {u["sub"]}<br>'
            f'<span>{cap}</span>{extra}</figcaption></figure>')


def carousel(items):
    return ('<div class="deck"><div class="track">' + "".join(items) + "</div>"
            '<div class="dots">' + "".join(
                '<i class="on"></i>' if i == 0 else "<i></i>" for i in range(len(items)))
            + "</div></div>")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for key, (clip, bad, good) in FRAME.items():
        shot(clip, bad, OUT / f"bad_{key}.jpg")
        shot(clip, good, OUT / f"good_{key}.jpg")
    for key, (clip, a, b) in LOOPS.items():
        src = ROOT / "raw" / f"{clip}.mp4"
        s, e = find_loop(src, a, b)
        clip_loop(src, s, e, OUT / f"loop_{key}.mp4", clip)
        print(f"  {key:7s} {clip}  {s:6.1f}–{e:6.1f}  ({e-s:.1f}초)")

    # ── 수업 전 ─────────────────────────────────────────────────────────
    # 도해는 각 유닛 안에 붙인다. 그 유닛을 설명할 때 옆에 있어야 한다.
    # 맨 위는 미리보기 — 영상 강의니까 첫 화면이 영상인 게 자연스럽다.
    B = ['<section class="hero"><video class="loop" autoplay muted loop playsinline '
         'src="loop_finish.mp4"></video></section>',
         f'<section><h2>소개</h2><p class="lead">{LESSON["intro"]}</p></section>',
         '<section><h2>개요</h2>'
         + "".join(f"<p>{x}</p>" for x in LESSON["overview"]) + "</section>",
         '<section><h2>배울 내용</h2>']
    for u in UNITS:
        dia = diagram(u["key"])
        src = dia or f'good_{u["key"]}.jpg'
        badge = "" if dia else '<span class="pend">도해 준비 중</span>'
        B.append(f'<div class="unit"><h3><span class="no">{u["no"]}</span>'
                 f'{u["title"]} <em>{u["sub"]}</em></h3>'
                 f'<figure class="dia"><img src="{src}" alt="{u["title"]}" loading="lazy">'
                 f'{badge}<figcaption>{u["diagram"]}</figcaption></figure>'
                 f'<p>{u["before"]}</p></div>')
    B.append("</section>")
    (OUT / "before.html").write_text(page("before.html", "".join(B)))

    # ── 수업 후 ─────────────────────────────────────────────────────────
    # 수업 전의 '배울 내용' 과 같은 틀(.unit)을 쓴다. 뒤집히는 건 안의 내용뿐이다.
    #   도해(목표) → 대조(판정)   ·   설명 문단 → 체크리스트
    # 첫 섹션은 s11 요약 자막 세 줄. 30초에 훑는 페이지라 첫 화면에 목록이 있어야 한다.
    A = ['<section><h2>오늘 한 것</h2>'
         f'<p class="lead">{LESSON["recap"]}</p>'
         '<ol class="sum">' + "".join(f'<li>{u["after"]}</li>' for u in UNITS)
         + "</ol></section>",
         '<section><h2>확인할 것</h2>']
    for u in UNITS:
        two = "".join(
            f'<span class="{c}"><img src="{c}_{u["key"]}.jpg" alt="{u[c][0]}" loading="lazy">'
            f'<i>{u[c][0]}<u>→ {u[c][1]}</u></i></span>' for c in ("bad", "good"))
        A.append(f'<div class="unit"><h3><span class="no">{u["no"]}</span>{u["after"]}</h3>'
                 f'<div class="two">{two}</div>'
                 f'<video class="loop" autoplay muted loop playsinline '
                 f'src="loop_{u["key"]}.mp4"></video>'
                 '<h4>코트에서 확인</h4><div class="check">' + "".join(
                     f'<label><input type="checkbox"><span>{x}</span></label>'
                     for x in u["steps"]) + "</div>"
                 f'<h4>놓치기 쉬운 것</h4><p class="fix">{u["fix"]}</p></div>')
    A.append("</section>")

    # 도해가 글보다 먼저 온다. 동작 이름만 듣고는 뭘 하라는 건지 모른다.
    dia = diagram("drill")
    A.append(f'<section><h2>{DRILL[0]}</h2>'
             + (f'<figure class="dia"><img src="{dia}" alt="{DRILL[0]}" loading="lazy">'
                f'<figcaption>{DRILL[3]}</figcaption></figure>' if dia else "")
             + f'<p class="drill"><b>{DRILL[1]}</b></p><p>{DRILL[2]}</p></section>')
    A.append(f'<section class="last"><h2>마지막으로</h2><p class="lead">{LAST}</p></section>')
    (OUT / "after.html").write_text(page("after.html", "".join(A)))

    mb = sum(f.stat().st_size for f in OUT.iterdir()) / 1024 / 1024
    print(f"{OUT}/  파일 {len(list(OUT.iterdir()))}개 · {mb:.1f}MB")


CSS = """
:root{--navy:#17335F;--yellow:#E4EF3D;--ink:#1B2233;--soft:#6B7488;--rule:#E6E9F0;
 --red:#E2483D;--ground:#EFF1F4}
*{box-sizing:border-box}
body{margin:0;background:#D9DCE3;color:var(--ink);line-height:1.65;word-break:keep-all;
 font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo",-apple-system,system-ui,sans-serif}
main{max-width:430px;margin:0 auto;background:#fff;min-height:100vh}
@media(min-width:520px){main{margin:20px auto;min-height:0;border-radius:20px;overflow:hidden}}
header{display:flex;gap:12px;align-items:flex-start;padding:20px 20px 10px}
.back{flex:none;width:34px;height:34px;border-radius:50%;background:var(--ground);
 color:var(--ink);text-decoration:none;display:grid;place-items:center;font-size:1.2rem;
 line-height:1;padding-bottom:3px}
.kind{margin:0 0 3px;font-size:.68rem;letter-spacing:.1em;color:var(--soft);font-weight:800}
header h1{margin:0;font-size:1.18rem;font-weight:800;letter-spacing:-.02em;line-height:1.35}
.meta{display:flex;gap:16px;margin:0;padding:0 20px 14px 66px;font-size:.8rem;color:var(--soft)}
.tabs{display:flex;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.tabs a{flex:1;text-align:center;padding:12px 0;font-size:.86rem;font-weight:700;
 color:var(--soft);text-decoration:none}
.tabs a.on{color:var(--navy);box-shadow:inset 0 -3px 0 var(--yellow)}
.hero{padding:0;border-top:0}
.hero video.loop{border-radius:0}
.lead{font-size:1.02rem;font-weight:600;line-height:1.6}
.dia{position:relative;margin:0 0 12px}
.dia img{width:100%;height:auto;display:block;border-radius:11px;background:var(--ground)}
.fix{color:var(--soft);font-size:.9rem}
.deck{padding:16px 0 4px}
.track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;
 padding:0 20px;scrollbar-width:none}
.track::-webkit-scrollbar{display:none}
.slide{flex:0 0 calc(100% - 40px);scroll-snap-align:center;margin:0}
.fig{position:relative;background:var(--ground);border-radius:12px;overflow:hidden}
.fig img{width:100%;height:auto;display:block}
.pend{position:absolute;left:9px;top:9px;background:rgba(23,51,95,.86);color:#fff;
 font-size:.63rem;letter-spacing:.04em;padding:3px 8px;border-radius:20px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:2px}
.two span{position:relative;display:block}
.two img{width:100%;height:auto;display:block}
.two i{position:absolute;left:0;right:0;bottom:0;font-style:normal;font-size:.68rem;
 padding:5px 7px;color:#fff;line-height:1.35}
.two i u{display:block;text-decoration:none;font-size:.64rem;opacity:.82}
.two .bad img{filter:grayscale(1) contrast(.92)}
.two .bad i{background:rgba(226,72,61,.92)}
.two .good i{background:rgba(23,51,95,.92)}
figcaption{font-size:.82rem;color:var(--ink);margin-top:10px;line-height:1.55}
figcaption span{color:var(--soft);font-size:.79rem}
.dots{display:flex;gap:5px;justify-content:center;margin-top:12px}
.dots i{width:6px;height:6px;border-radius:50%;background:var(--rule)}
.dots i.on{background:var(--navy)}
section{padding:22px 20px;border-top:1px solid var(--rule)}
section h2{margin:0 0 10px;font-size:.76rem;letter-spacing:.06em;font-weight:800;color:var(--navy)}
section p{margin:0 0 10px;font-size:.93rem}
section p:last-child{margin-bottom:0}
.unit video.loop{margin-top:11px}
.unit,.grp{border-top:1px solid var(--rule);padding-top:15px;margin-top:15px}
.unit:first-of-type,.grp:first-of-type{border-top:0;padding-top:0;margin-top:0}
h3{display:flex;gap:8px;align-items:center;margin:0 0 9px;font-size:1rem;font-weight:700}
h3 em{font-style:normal;font-size:.82rem;color:var(--soft);font-weight:500}
.no{flex:none;width:23px;height:23px;border-radius:50%;background:var(--yellow);
 color:var(--navy);font-weight:800;font-size:.76rem;display:grid;place-items:center}
h4{margin:15px 0 5px;font-size:.71rem;letter-spacing:.06em;font-weight:800;color:var(--soft)}
.sum{margin:12px 0 0;padding:0;list-style:none;counter-reset:s}
.sum li{display:flex;gap:9px;align-items:center;padding:5px 0;font-size:.95rem;
 font-weight:700;counter-increment:s}
.sum li::before{content:counter(s);flex:none;width:21px;height:21px;border-radius:50%;
 background:var(--yellow);color:var(--navy);font-size:.72rem;font-weight:800;
 display:grid;place-items:center}
label{display:flex;gap:10px;align-items:center;padding:6px 0;font-size:.93rem}
input[type=checkbox]{width:19px;height:19px;accent-color:var(--navy);flex:none}
.err{color:var(--red);font-weight:600;font-size:.9rem}
.drill{font-size:1.02rem}
.drill b{color:var(--navy)}
video.loop{width:100%;height:auto;display:block;border-radius:11px;background:var(--ground)}
.goal video.loop{margin-top:2px}
.cap{font-size:.79rem;color:var(--soft);margin-top:8px}
.loops{display:grid;gap:11px;margin-top:14px}
.loops figcaption{font-size:.8rem;color:var(--soft);font-weight:600;margin-top:6px}
figure{margin:0}
"""


if __name__ == "__main__":
    main()
