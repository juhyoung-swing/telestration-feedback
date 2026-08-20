#!/usr/bin/env python3
"""s6 — 자막·CG·SFX 를 실제 파일로 만든다.

설치된 ffmpeg 빌드에 libass/freetype 이 없다. 그래서 화면 위 글자와 도형을
전부 Pillow 로 투명 PNG 에 그리고, s7 이 overlay 필터로 한 번에 얹는다.

프레임마다 PNG 를 뽑으면 14,460 장이 된다. 대신 '화면 위 구성이 바뀌는 순간'으로
구간을 쪼개고 구간당 한 장만 그린다. s7 은 concat 데모서로 이 PNG 들을 알파 트랙
하나로 읽는다 — overlay 필터가 1개면 된다.

만드는 것
  output/overlay/*.png + overlay.txt  — 알파 트랙
  output/sfx/*.wav                    — pop / beep / ding
  output/overlay_plan.json            — 무엇이 언제 어디에 그려졌는지 (검토용)

usage: python build_assets.py [run_dir]
"""
import json
import math
import re
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
W, H, FPS = 1920, 1080, 30
FONTS = Path.home() / "Library/Fonts"
F_BOLD = FONTS / "GmarketSansTTFBold.ttf"
F_MED = FONTS / "GmarketSansTTFMedium.ttf"

COLOR = {"green": (61, 220, 132), "yellow": (255, 217, 61), "red": (255, 92, 92),
         "blue": (92, 200, 255), "white": (255, 255, 255), "orange": (255, 159, 69)}
SIZE_PX = {"large": 68, "medium": 50, "small": 38}
SPEECH_PX = 46
POP_FADE = 0.16  # 'pop' 은 4단 알파 계단으로 근사한다. 진짜 스케일 팝은 아니다.


def font(p: Path, px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(p), px)


# ── 텍스트 ────────────────────────────────────────────────────────────────
def wrap(text: str, limit: int) -> list:
    lines, cur = [], ""
    for w in text.split():
        if len(cur) + len(w) + 1 > limit and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


# 줄 끝에 혼자 남으면 안 되는 말 — 뒤에 오는 말과 한 덩어리다.
# '수' 는 넣지 않는다. 앞말에 붙는 의존명사라 BOUND_HEAD 와 충돌해 줄이 왔다갔다 한다.
DANGLING_TAIL = {"그", "이", "저", "제", "저희", "우리", "한", "두", "세", "네",
                 "첫", "몇", "각", "온", "좀", "더", "덜", "안", "못", "새"}
# 줄 앞에 혼자 오면 안 되는 말 — 앞에 오는 말에 붙는다
BOUND_HEAD = {"때문에", "수", "것", "것은", "것을", "거", "거는", "등", "및", "후에",
              "위해", "대해", "만큼", "정도", "때", "뿐", "채", "줄"}
# 여기서 끊으면 자연스럽다 — 연결어미·종결어미
BREAK_OK = re.compile(r"(고|며|서|면|는데|은데|야|다|요|죠|까|지만|니까|거든요|"
                      r"습니다|입니다|해서|하고|이고)[.,!?]?$")
ORPHAN = 7        # 이보다 짧은 줄만 남으면 앞줄이 조금 넘치더라도 합친다


def tidy(lines: list) -> list:
    """줄 경계가 어절을 가르지 않게 손본다.

    글자 수만 세면 '…실릴 수 있고 그' / '정확도도…' 처럼 갈린다.
    '그 다음에' 는 한 덩어리고 '있기 때문에' 도 한 덩어리다."""
    for _ in range(3):
        moved = False
        for i in range(len(lines) - 1):
            if not lines[i] or not lines[i + 1]:
                continue
            tail = lines[i][-1]["word"].strip().strip(".,?!")
            head = lines[i + 1][0]["word"].strip().strip(".,?!")
            if tail in DANGLING_TAIL and len(lines[i]) > 1:
                lines[i + 1].insert(0, lines[i].pop())
                moved = True
            elif head in BOUND_HEAD and len(lines[i + 1]) > 1:
                lines[i].append(lines[i + 1].pop(0))
                moved = True
        if not moved:
            break
    return [ln for ln in lines if ln]


def cue_lines(words: list, limit: int, maxl: int) -> list:
    """단어를 자막 큐로 묶는다. 반환은 [큐][줄][단어].

    글자 수만 세어 자르면 한 덩어리가 두 화면으로 쪼개진다.
    실제로 '세 번째는 마무리 / 피니시까지' 로 갈려서 '마무리' 와 '피니시까지' 가
    다른 자막이 됐다. 그래서 쉼표·마침표로 절을 먼저 나누고 그 안에서만 줄을 바꾼다."""
    clauses, cur = [], []
    for w in words:
        tok = w["word"].strip()
        if not tok:
            continue
        cur.append(w)
        if tok[-1] in ",.?!":
            clauses.append(cur)
            cur = []
    if cur:
        clauses.append(cur)

    def width(ln):
        return len(" ".join(x["word"].strip() for x in ln))

    def wrap_clause(ws):
        lines, ln = [], []
        for w in ws:
            tok = w["word"].strip()
            if ln and width(ln) + len(tok) + 1 > limit:
                lines.append(ln)
                ln = [w]
            else:
                ln.append(w)
        if ln:
            lines.append(ln)
        # 끄트머리에 토막만 남으면 앞줄에 합친다 (조금 넘쳐도 그게 낫다)
        #
        # lines[-2] += lines.pop() 로 쓰면 안 된다. 파이썬이 -2 를 pop 전 길이로
        # 읽고 대입은 pop 후 길이로 해서 엉뚱한 줄을 덮어쓴다.
        # 실제로 첫 줄이 사라지고 마지막 줄이 두 번 나갔다.
        if len(lines) >= 2 and width(lines[-1]) <= ORPHAN:
            if width(lines[-2]) + width(lines[-1]) + 1 <= limit * 1.2:
                tail = lines.pop()
                lines[-1] = lines[-1] + tail
        return lines

    # 절마다 줄을 만들어 이어 붙이고, maxl 줄씩 잘라 큐로 묶는다.
    all_lines = []
    for cl in clauses:
        all_lines += tidy(wrap_clause(cl))
    return [all_lines[k:k + maxl] for k in range(0, len(all_lines), maxl)]



def draw_text(dr: ImageDraw.ImageDraw, xy, lines, f, fill, anchor="mm",
              box=None, pad=(26, 14), leading=1.28):
    """box 를 주면 글자 뒤에 반투명 박스를 깐다. 좌표는 블록 전체 기준."""
    lh = int(f.size * leading)
    tot = lh * len(lines)
    x, y = xy
    if box is not None:
        wmax = max(dr.textlength(s, font=f) for s in lines)
        ax = {"m": x - wmax / 2, "l": x, "r": x - wmax}[anchor[0]]
        ay = {"m": y - tot / 2, "a": y, "d": y - tot}[anchor[1]]
        dr.rounded_rectangle([ax - pad[0], ay - pad[1], ax + wmax + pad[0], ay + tot + pad[1]],
                             radius=10, fill=box)
    for i, s in enumerate(lines):
        yy = {"m": y - tot / 2 + lh * i + lh / 2, "a": y + lh * i + lh / 2,
              "d": y - tot + lh * i + lh / 2}[anchor[1]]
        dr.text((x, yy), s, font=f, fill=fill, anchor=anchor[0] + "m")


# ── 도형 ──────────────────────────────────────────────────────────────────
def circle(dr, x, y, r, c, wdt=7):
    dr.ellipse([x - r, y - r * 0.82, x + r, y + r * 0.82], outline=c + (255,), width=wdt)


def arrow(dr, x, y, dx, dy, c, wdt=9):
    x2, y2 = x + dx, y + dy
    dr.line([x, y, x2, y2], fill=c + (255,), width=wdt)
    ang = math.atan2(dy, dx)
    for s in (2.6, -2.6):
        dr.line([x2, y2, x2 + 34 * math.cos(ang + s), y2 + 34 * math.sin(ang + s)],
                fill=c + (255,), width=wdt)


def arc_arrow(dr, x, y, r, c, wdt=9):
    dr.arc([x - r, y - r * 0.55, x + r, y + r * 0.55], start=200, end=340,
           fill=c + (255,), width=wdt)
    ex, ey = x + r * math.cos(math.radians(340)), y + r * 0.55 * math.sin(math.radians(340))
    for s in (0.6, 2.2):
        dr.line([ex, ey, ex - 30 * math.cos(s), ey - 30 * math.sin(s)],
                fill=c + (255,), width=wdt)


def basketball(dr, x, y, r):
    c = COLOR["orange"] + (210,)
    dr.ellipse([x - r, y - r, x + r, y + r], outline=c, width=8)
    dr.line([x - r, y, x + r, y], fill=c, width=6)
    dr.line([x, y - r, x, y + r], fill=c, width=6)
    dr.arc([x - r * 1.7, y - r, x + r * 0.3, y + r], 300, 60, fill=c, width=6)
    dr.arc([x - r * 0.3, y - r, x + r * 1.7, y + r], 120, 240, fill=c, width=6)


# ── 위치 해석 ─────────────────────────────────────────────────────────────
BODY = {   # 인물 박스 안에서의 상대 위치 (x는 폭 기준, y는 키 기준)
    "상체 좌측": (-0.75, 0.22),
    "상체 가슴": (-0.18, 0.28),
    "상체 중앙": (0.0, 0.30),
    "골반": (0.0, 0.55),
    "하체 오른발": (-0.22, 0.96),
}


def body_anchor(box: dict, where: str):
    """지시서는 '하체 오른발' 처럼 의미로 위치를 적는다.
    s1 이 찾아둔 인물 박스에 대고 픽셀로 되돌린다.

    사람 편집본의 composition 수치를 쓰면 안 된다 — 그건 크롭된 편집 화면 기준이라
    무편집 원본에서는 인물이 더 작고 더 아래에 있다."""
    f = BODY.get(where)
    if f is None or box is None:
        return None
    bw = (box["x1"] - box["x0"]) * W
    bh = (box["y1"] - box["y0"]) * H
    cx = (box["x0"] + box["x1"]) / 2 * W
    return (cx + f[0] * bw, box["y0"] * H + f[1] * bh, bw)


TEXT_XY = {
    "top_center": (W / 2, 96, "ma"),
    "top_left": (150, 150, "la"),
    "top_right": (W - 150, 150, "ra"),
    "center": (W / 2, H / 2, "mm"),
    "bottom": (W / 2, H - 250, "md"),
    "nameplate": (140, H - 190, "la"),
}
CHECK_X = (430, 960, 1490)  # 몽타주 상단 체크리스트 1·2·3 항목 x


# ── SFX ───────────────────────────────────────────────────────────────────
def wav(path: Path, samples: list, sr: int = 48000) -> None:
    data = b"".join(struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in samples)
    path.write_bytes(
        b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " +
        struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16) +
        b"data" + struct.pack("<I", len(data)) + data)


def pop(sr=48000):
    """자막 등장음. 1500Hz 에서 600Hz 로 빠르게 떨어지는 삑 + 앞머리 클릭.
    앞의 것은 순한 사인이라 BGM 없이 들으면 묻혔다."""
    n = int(sr * 0.10)
    out = []
    for i in range(n):
        t = i / sr
        f = 1500 * (600 / 1500) ** (t / 0.10)
        env = math.exp(-26 * t) * min(1.0, t / 0.002)
        v = math.sin(2 * math.pi * f * t) * 0.75 + math.sin(4 * math.pi * f * t) * 0.2
        if t < 0.004:                      # 앞머리 클릭
            v += (1 - t / 0.004) * 0.5
        out.append(max(-0.99, min(0.99, v * env)))
    return out


def tone(freqs, dur_s, decay, sr=48000, wobble=0.0):
    n = int(sr * dur_s)
    out = []
    for i in range(n):
        t = i / sr
        env = math.exp(-decay * t) * min(1.0, t / 0.004)
        v = sum(math.sin(2 * math.pi * f * (1 + wobble * t) * t) for f in freqs) / len(freqs)
        out.append(v * env * 0.7)
    return out


# ── 메인 ──────────────────────────────────────────────────────────────────
def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "runs/002"
    step = run_dir / "s6_assets_subtitle_cg_sfx"
    inp, out = step / "input", step / "output"
    ov_dir, sfx_dir = out / "overlay", out / "sfx"
    for d in (inp, ov_dir, sfx_dir):
        d.mkdir(parents=True, exist_ok=True)

    tl = json.loads((run_dir / "s4_aroll_cut/output/timeline.json").read_text())
    d = json.loads((run_dir / "s4_aroll_cut/input/directive.json").read_text())
    (inp / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1))
    (inp / "directive.json").write_text(json.dumps(d, ensure_ascii=False, indent=1))

    total = tl["total_sec"]
    scene = {s["scene_id"]: s for s in tl["scenes"]}
    silent = {f["id"] for f in d["meta"]["source"]["files"] if f.get("speech") is False}
    track = json.loads((run_dir / "s1_audio_visual_data_fusion/output/subject_track.json").read_text())
    blocks = [b for s in tl["scenes"] for b in s["blocks"] if b["kind"] == "a_roll"]
    items, report = [], []

    def locate(t: float):
        """편집 타임라인의 시각 → (클립, 원본 시각). 좌표계는 하나뿐이다."""
        for b in blocks:
            if b["abs_start"] <= t < b["abs_end"]:
                return b["file"], b["src_start"] + (t - b["abs_start"])
        return None, None

    def at(item):
        """항목이 편집 타임라인의 몇 초에 놓이는지.

        source_anchor(원본 타임코드)가 있으면 그쪽을 쓴다. 컷을 바꿔도 가리키는
        순간이 안 변한다. 그 순간이 통째로 잘려 나갔으면 None — 안 그리는 게 맞다.
        원본에 대응이 없는 항목(챕터 카드 문구)만 씬 앵커로 푼다."""
        sa = item.get("source_anchor")
        if sa:
            for b in blocks:
                if b["file"] == sa["clip"] and b["src_start"] <= sa["at"] < b["src_end"]:
                    return b["abs_start"] + (sa["at"] - b["src_start"])
            # 그 순간이 잘려나갔다. 다시 말이 시작되는 지점으로 민다.
            nxt = [b for b in blocks if b["file"] == sa["clip"] and b["src_start"] >= sa["at"]]
            return min(nxt, key=lambda b: b["src_start"])["abs_start"] if nxt else None
        sid = item["anchor"]["scene_id"]
        return scene[sid]["abs_start"] + item["anchor"]["offset_sec"] if sid in scene else None

    def subject_box(t: float):
        clip, st = locate(t)
        if clip is None:
            return None
        found = [s for s in track[clip]["samples"] if s]
        return min(found, key=lambda s: abs(s["t"] - st)) if found else None

    # 줌은 s7 이 화면 자체를 크롭해서 건다. 글자는 화면 좌표라 그대로 두면 되지만
    # 몸에 붙는 도형은 크롭된 좌표로 옮겨야 한다. 안 옮기면 발을 가리키던 원이 빗나간다.
    zooms = []
    for z in d["zoom"]:
        a = at(z)
        if a is None:
            continue
        zw, zh = W / z["scale"], H / z["scale"]
        zooms.append({"a": a, "b": a + z["duration_sec"],
                      "z": z["scale"],
                      "x0": min(max(W * z["center_pct"]["x"] / 100 - zw / 2, 0), W - zw),
                      "y0": min(max(H * z["center_pct"]["y"] / 100 - zh / 2, 0), H - zh)})

    def to_screen(xy, t):
        z = next((z for z in zooms if z["a"] <= t < z["b"]), None)
        if z is None or xy is None:
            return xy
        return ((xy[0] - z["x0"]) * z["z"], (xy[1] - z["y0"]) * z["z"], xy[2] * z["z"])

    def add(t0, t1, fn, kind, label, pop=False):
        t0, t1 = max(0.0, t0), min(total, t1)
        if t1 <= t0:
            return
        items.append({"t0": t0, "t1": t1, "fn": fn, "pop": pop})
        report.append({"kind": kind, "start": round(t0, 2), "end": round(t1, 2), "what": label})

    # 1. 발화 자막 — 우리 전사에서 생성한다. 지시서에는 문구가 없다.
    #
    # 클립 단위로 한 번만 만든다. 블록마다 전사를 훑으면 한 단어가 여러 블록에
    # 걸쳐 중복으로 나온다 (실제로 '첫째는' → '첫째는 시선' → '시선 거리 잡기' 로
    # 같은 말이 세 번 떴다).
    pol = d["subtitle_policy"]["speech"]
    limit, maxl, mind = pol["max_chars_per_line"], pol["max_lines"], pol["min_duration_sec"]
    # 전사 오류 교정. 소리는 그대로 두고 화면 문구만 고친다.
    corr = d["subtitle_policy"].get("corrections", {})

    def fix(t: str) -> str:
        for a, b in corr.items():
            t = t.replace(a, b)
        return t

    n_speech = 0
    for clip in sorted({b["file"] for b in blocks} - silent):
        segs = json.loads(
            (run_dir / f"s1_audio_visual_data_fusion/output/{clip}.json").read_text())["segments"]
        mine = [b for b in blocks if b["file"] == clip]
        # s2 가 내용으로 들어낸 구간 밖의 말은 자막에도 없어야 한다.
        # (무음 삭제와 달리 이건 소리 자체가 없다)
        scope = [(r["start"], r["end"]) for sc_ in d["scenes"]
                 for r in (sc_.get("a_roll_scope") or sc_.get("a_roll") or [])
                 if r["file"] == clip]
        words = []
        for sg in segs:
            if sg.get("no_speech_prob", 0) > 0.5:
                continue
            for w in sg.get("words", []):
                # 전사의 단어 경계는 실제보다 이르거나 늦다. 시작 시각이 잘라낸 무음에
                # 걸렸다고 단어를 버리면 '세 (번째는) 마무리' 처럼 말이 빠진다.
                # 겹치는 넓이로 블록을 고른다.
                mid = (w["start"] + w["end"]) / 2
                if scope and not any(a - 0.25 <= mid <= b + 0.25 for a, b in scope):
                    continue                        # s2 가 들어낸 문장
                # s3 는 무음만 잘라낸다(silencedetect −30dB). 말은 하나도 안 없어진다.
                # 그러니 자막에서 단어를 버릴 이유가 없다. 전사 타임스탬프는 ±0.3초씩
                # 어긋나므로, 그걸 근거로 버리면 '세 (번째는) 마무리' 처럼 말이 빠진다.
                # 겹치는 블록이 없으면 가장 가까운 블록에 붙인다.
                ov = [(min(w["end"], b["src_end"]) - max(w["start"], b["src_start"]), b)
                      for b in mine]
                best = max(ov, key=lambda x: x[0])
                b = best[1] if best[0] > 0 else min(
                    mine, key=lambda b: min(abs(w["start"] - b["src_start"]),
                                            abs(w["start"] - b["src_end"])))
                # 블록 끝으로 눌러 담지 않는다. 눌러 담으면 여러 단어가 같은 시각이 되고
                # 큐 두 개가 겹쳐서 앞엣것이 통째로 사라진다.
                sh = b["abs_start"] - b["src_start"]
                st = max(0.0, w["start"] + sh)
                words.append({"word": w["word"], "start": st,
                              "end": max(st + 0.08, w["end"] + sh)})
        # 전사 순서를 그대로 둔다. 보정값이 블록마다 달라서 시각으로 정렬하면
        # 말 순서가 뒤집힌다 ('티칭을 혼자 해볼까 첫째는 하는데').
        # 시각만 앞 단어를 넘지 않게 눌러준다.
        for k in range(1, len(words)):
            if words[k]["start"] < words[k - 1]["end"]:
                words[k]["start"] = words[k - 1]["end"]
            if words[k]["end"] < words[k]["start"]:
                words[k]["end"] = words[k]["start"] + 0.08
        cues = []
        for grp in cue_lines(words, limit, maxl):
            flat = [w for ln in grp for w in ln]
            cues.append([flat[0]["start"], max(flat[-1]["end"], flat[0]["start"] + mind),
                         [fix(" ".join(w["word"].strip() for w in ln)) for ln in grp]])
        for k, cue in enumerate(cues):             # 다음 큐와 겹치지 않게 자른다
            if k + 1 < len(cues):
                cue[1] = min(cue[1], cues[k + 1][0])
            if cue[1] > cue[0]:
                add(cue[0], cue[1], mk_speech(cue[2]), "speech", " / ".join(cue[2]))
                n_speech += 1

    # 2. 강조 자막 — 지시서에 문구가 박혀 있는 것들
    for st in d["subtitles"]:
        sid = st["anchor"]["scene_id"]
        a = at(st)
        if a is None:
            continue
        z = a + st["duration_sec"]
        c = COLOR[st["color"]]
        if sid == "sc12" and st["id"] == "st22":
            add(a, z, mk_checklist(), "title", "몽타주 체크리스트 바")
            continue
        add(a, z, mk_title(st, c), "title", st["text"].replace("\n", " / "),
            pop=(st["animation"] == "pop"))

    # 3. 그래픽
    for g in d["graphics"]:
        sid = g["anchor"]["scene_id"]
        a = at(g)
        if a is None:
            continue
        z = a + g["duration_sec"]
        c = COLOR[g["color"]]
        pos = g["position"]
        m = re.match(r"상단 바 (\d)번", pos)
        if m:
            add(a, z, mk_check_ring(int(m.group(1)) - 1, c), "graphic", f'{g["shape"]} {g["target"]}')
            continue
        if pos == "nameplate":
            add(a, z, mk_nameplate(c, g.get("text", g["target"])), "graphic",
                g.get("text", g["target"]))
            continue
        xy = body_anchor(subject_box(a), pos)
        if xy is None:
            report.append({"kind": "graphic", "start": round(a, 2), "end": round(z, 2),
                           "what": f'{g["id"]} 위치 "{pos}" 를 픽셀로 못 옮김 — 건너뜀'})
            continue
        raw_xy, xy = xy, to_screen(xy, a)
        moved = "" if xy is raw_xy else f" · 줌 보정 ({int(raw_xy[0])},{int(raw_xy[1])})→"
        add(a, z, mk_shape(g["shape"], xy, c), "graphic",
            f'{g["shape"]} → {g["target"]}{moved} @ ({int(xy[0])},{int(xy[1])}) 인물폭 {int(xy[2])}px')

    # ── 구간 분할 후 PNG ─────────────────────────────────────────────────
    cuts = {0.0, total}
    for it in items:
        cuts.add(it["t0"])
        cuts.add(it["t1"])
        if it["pop"]:
            for k in range(1, 4):
                cuts.add(it["t0"] + POP_FADE * k / 4)
    times = sorted(t for t in cuts if 0 <= t <= total)

    concat, n_png = [], 0
    for i in range(len(times) - 1):
        t0, t1 = times[i], times[i + 1]
        if t1 - t0 < 1 / FPS / 2:
            continue
        mid = (t0 + t1) / 2
        act = [it for it in items if it["t0"] <= mid < it["t1"]]
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        if act:
            dr = ImageDraw.Draw(img)
            for it in act:
                alpha = 1.0
                if it["pop"] and mid < it["t0"] + POP_FADE:
                    alpha = 0.25 + 0.75 * (mid - it["t0"]) / POP_FADE
                it["fn"](img, dr, alpha)
        p = ov_dir / f"{n_png:05d}.png"
        img.save(p)
        concat.append(f"file '{p.resolve()}'\nduration {t1 - t0:.5f}\n")
        n_png += 1
    concat.append(f"file '{(ov_dir / f'{n_png-1:05d}.png').resolve()}'\n")  # 마지막 장 한 번 더
    (out / "overlay.txt").write_text("".join(concat))

    # ── SFX ──────────────────────────────────────────────────────────────
    wav(sfx_dir / "pop.wav", pop())
    wav(sfx_dir / "beep.wav", tone([1180, 2360], 0.11, 34))
    wav(sfx_dir / "ding.wav", tone([1568, 2350, 3136], 0.6, 6))

    (out / "overlay_plan.json").write_text(json.dumps(
        {"total_sec": total, "png_count": n_png, "speech_cues": n_speech,
         "items": sorted(report, key=lambda r: r["start"]),
         "not_created": [{"asset": "as_bgm", "why": "배경음악은 우리가 만들 수 없다. 무음으로 간다"},
                         {"asset": "as_narration", "why": "sc01 비활성 — 후녹음 필요"},
                         {"asset": "as_logo", "why": "sc01 비활성 — 로고 애니메이션 필요"},
                         {"asset": "as_drill_footage", "why": "sc08 비활성 — 추가 촬영 필요"}]},
        ensure_ascii=False, indent=1))

    print(f"발화 자막 {n_speech}개 · 화면요소 {len(items)}개 · PNG {n_png}장")
    print(f"→ {(out / 'overlay.txt').resolve()}")


# ── 그리기 클로저 ─────────────────────────────────────────────────────────
def mk_speech(lines):
    def fn(img, dr, alpha):
        f = font(F_MED, SPEECH_PX)
        draw_text(dr, (W / 2, H - 96), lines, f, (255, 255, 255, int(255 * alpha)),
                  anchor="md", box=(0, 0, 0, int(165 * alpha)), pad=(30, 12))
    return fn


def mk_title(st, c):
    lines = st["text"].split("\n")
    px = SIZE_PX[st["size"]]

    def fn(img, dr, alpha):
        f = font(F_BOLD, px)
        x, y, anc = TEXT_XY[st["position"]]
        draw_text(dr, (x, y), lines, f, c + (int(255 * alpha),), anchor=anc,
                  box=(0, 0, 0, int(150 * alpha)), pad=(30, 16))
    return fn


def mk_checklist():
    def fn(img, dr, alpha):
        a = int(255 * alpha)
        dr.rectangle([0, 0, W, 270], fill=(0, 0, 0, int(170 * alpha)))
        draw_text(dr, (W / 2, 46), ["오늘 배운 세 가지를 집중해서 보세요"],
                  font(F_MED, 44), (255, 255, 255, a), anchor="ma")
        for x, s in zip(CHECK_X, ("1. 유닛턴", "2. 골반", "3. 피니시 공간")):
            draw_text(dr, (x, 150), [s], font(F_BOLD, 52), (255, 255, 255, a), anchor="ma")
    return fn


def mk_check_ring(idx, c):
    def fn(img, dr, alpha):
        f = font(F_BOLD, 52)
        s = ("1. 유닛턴", "2. 골반", "3. 피니시 공간")[idx]
        wdt = dr.textlength(s, font=f)
        dr.rounded_rectangle([CHECK_X[idx] - wdt / 2 - 22, 132, CHECK_X[idx] + wdt / 2 + 22, 218],
                             radius=44, outline=c + (int(255 * alpha),), width=6)
    return fn


def mk_nameplate(c, text="김기준 코치"):
    def fn(img, dr, alpha):
        a = int(255 * alpha)
        draw_text(dr, (140, H - 190), [text], font(F_BOLD, 48), c + (a,),
                  anchor="la", box=(0, 0, 0, int(150 * alpha)), pad=(28, 14))
    return fn


def mk_shape(shape, xy, c):
    """도형 크기는 인물 폭에 비례시킨다. 원본은 인물이 작게 잡혀서
    고정 반지름으로 그리면 몸을 다 덮어버린다."""
    x, y, bw = xy

    def fn(img, dr, alpha):
        cc = tuple(int(v) for v in c)
        if shape == "circle":
            circle(dr, x, y, max(48, bw * 0.42), cc)
        elif shape == "arrow":
            arrow(dr, x, y, -bw * 1.1, -bw * 0.35, cc)
        elif shape == "arc_arrow":
            arc_arrow(dr, x, y, max(70, bw * 0.62), cc)
        elif shape == "object_basketball":
            basketball(dr, x, y, max(52, bw * 0.40))
    return fn


if __name__ == "__main__":
    main()
