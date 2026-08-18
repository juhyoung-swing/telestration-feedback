#!/usr/bin/env python3
"""s7 — 마감. 줌 + 오버레이 + SFX + 라우드니스를 한 번에 굽는다.

A-roll(s4) 은 자르기만 했다. 여기서 그 위에
  줌      지시서의 static_crop 을 시간에 따라 변하는 crop 식으로
  오버레이 s6 가 만든 알파 트랙 1장
  SFX     지시서 시각에 맞춰 지연 후 믹스
  라우드니스 블록마다 따로. 무발화 클립이 발화 클립보다 7.7 LU 낮아서
           단일 목표값으로는 못 맞춘다
를 얹는다.

usage: python render.py [run_dir] [mp4|webm]
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
W, H = 1920, 1080


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def measure_lufs(p: Path) -> float:
    r = sh(["ffmpeg", "-i", str(p), "-vn", "-af", "loudnorm=print_format=json",
            "-f", "null", "-"])
    m = re.findall(r'"input_i"\s*:\s*"(-?[\d.]+|-inf)"', r.stderr)
    return float(m[-1]) if m and m[-1] != "-inf" else -70.0


def even(v: float) -> int:
    return max(2, int(v) // 2 * 2)


TARGET_H = 0.66      # 화면에서 인물이 차지할 키 비율. 편집본이 65~70% 다
TARGET_HEAD = 0.15   # 머리 위 여백
MAX_REFRAME = 1.45   # 1080p 를 크롭 확대하는 거라 여기까지만
SIDE_MARGIN = 0.06   # 인물이 움직여도 화면 밖으로 안 나가게 두는 좌우 여유


def reframe(box):
    """인물 박스 → (배율, 중심x 비율, 크롭 윗변 비율).

    박스는 '씬 전체에서 인물이 돌아다닌 범위'다. 블록마다 다시 잡으면 컷마다
    화각이 흔들려서 어지럽다. 씬 하나에 화각 하나로 고정한다.

    배율은 두 조건 중 작은 쪽을 따른다.
      인물 키를 TARGET_H 로 만드는 배율
      인물이 돌아다닌 좌우 범위를 화면 안에 담는 배율"""
    if box is None:
        return 1.0, 0.5, 0.0
    bh = max(0.05, box["y1"] - box["y0"])
    bw = max(0.05, box["x1"] - box["x0"]) + 2 * SIDE_MARGIN
    sc = min(TARGET_H / bh, 1.0 / bw)
    return max(1.0, min(MAX_REFRAME, sc)), (box["x0"] + box["x1"]) / 2, box["y0"]


def build_zoomed(aroll: Path, zooms: list, boxes: list, total: float, work: Path) -> Path:
    """구간마다 고정 크롭을 걸고 다시 붙인다.

    두 겹이다. 아래는 인물 중심 리프레임(블록마다), 위는 지시서의 줌.
    줌이 걸려도 중심은 인물에 둔다 — 안 그러면 줌이 인물을 화면 밖으로 밀어낸다."""
    work.mkdir(parents=True, exist_ok=True)
    marks = sorted({0.0, total} | {z["a"] for z in zooms} | {z["b"] for z in zooms}
                   | {b["a"] for b in boxes} | {b["b"] for b in boxes})
    segs, lst = [], []
    for i in range(len(marks) - 1):
        a, b = marks[i], marks[i + 1]
        if b - a < 0.05:
            continue
        z = next((z for z in zooms if z["a"] <= a < z["b"]), None)
        bx = next((x for x in boxes if x["a"] <= a < x["b"]), None)
        rs, rcx, rtop = reframe(bx["box"] if bx else None)
        scale = rs * (z["scale"] if z else 1.0)
        vf = f"scale={W}:{H},setsar=1"
        if scale > 1.001:
            cw, ch = even(W / scale), even(H / scale)
            x = even(min(max(W * rcx - cw / 2, 0), W - cw))
            y = even(min(max(H * rtop - TARGET_HEAD * ch, 0), H - ch))
            vf = f"crop={cw}:{ch}:{x}:{y},scale={W}:{H},setsar=1"
        p = work / f"z{i:03d}.mp4"
        if not p.exists():
            r = sh(["ffmpeg", "-y", "-v", "error", "-i", str(aroll),
                    "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-vf", vf,
                    "-c:v", "h264_videotoolbox", "-b:v", "16M", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", str(p)])
            if r.returncode:
                print(r.stderr[-1500:])
                raise SystemExit(1)
        segs.append({"start": round(a, 3), "end": round(b, 3),
                     "zoom": z["id"] if z else None,
                     "reframe_scale": round(rs, 3), "total_scale": round(scale, 3),
                     "subject_cx_pct": round(rcx * 100, 1), "vf": vf})
        lst.append(f"file '{p.resolve()}'\n")
    txt = work / "concat.txt"
    txt.write_text("".join(lst))
    zoomed = work.parent / "base_zoomed.mp4"
    r = sh(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
            "-i", str(txt), "-c", "copy", str(zoomed)])
    if r.returncode:
        print(r.stderr[-1500:])
        raise SystemExit(1)
    (work.parent / "zoom_segments.json").write_text(
        json.dumps(segs, ensure_ascii=False, indent=1))
    return zoomed


def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "runs/002"
    fmt = sys.argv[2] if len(sys.argv) > 2 else "mp4"
    s4 = run_dir / "s4_aroll_cut/output"
    s6 = run_dir / "s6_assets_subtitle_cg_sfx/output"
    step = run_dir / "s7_polish_master"
    inp, out = step / "input", step / "output"
    for d in (inp, out):
        d.mkdir(parents=True, exist_ok=True)

    d = json.loads((s4 / "../input/directive.json").resolve().read_text())
    tl = json.loads((s4 / "timeline.json").read_text())
    aroll = s4 / "aroll.mp4"
    total = tl["total_sec"]
    scene = {s["scene_id"]: s for s in tl["scenes"]}
    pol = d["polish"]

    ablocks = [b for s in tl["scenes"] for b in s["blocks"] if b["kind"] == "a_roll"]

    def at(item):
        """원본 타임코드(source_anchor)를 편집 타임라인 시각으로 푼다.
        컷이 바뀌어도 가리키는 순간이 안 변한다. 잘려나갔으면 다음 블록 머리로 민다."""
        sa = item.get("source_anchor")
        if sa:
            for b in ablocks:
                if b["file"] == sa["clip"] and b["src_start"] <= sa["at"] < b["src_end"]:
                    return b["abs_start"] + (sa["at"] - b["src_start"])
            nxt = [b for b in ablocks if b["file"] == sa["clip"] and b["src_start"] >= sa["at"]]
            return min(nxt, key=lambda b: b["src_start"])["abs_start"] if nxt else None
        sid = item["anchor"]["scene_id"]
        return scene[sid]["abs_start"] + item["anchor"]["offset_sec"] if sid in scene else None

    zooms = []
    for z in d["zoom"]:
        sid = z["anchor"]["scene_id"]
        a = at(z)
        if a is None:
            continue
        # 유지 시간은 지시서가 정한다. conceal_cut 은 컷을 걸쳐야 해서 블록 경계로 자르지 않는다.
        b = min(a + z["duration_sec"], total)
        zooms.append({"id": z["id"], "a": round(a, 3), "b": round(b, 3), "scale": z["scale"],
                      "cx": z["center_pct"]["x"] / 100, "cy": z["center_pct"]["y"] / 100,
                      "hold": round(b - a, 2), "purpose": z["purpose"]})

    # 블록마다 인물 박스를 잡아 리프레임 기준을 만든다
    track = json.loads(
        (run_dir / "s1_audio_visual_data_fusion/output/subject_track.json").read_text())
    # 화각은 씬 단위로 하나만 잡는다. 씬 안에서 인물이 돌아다닌 범위를 다 담는다.
    def pct(vals, q):
        v = sorted(vals)
        return v[max(0, min(len(v) - 1, int(len(v) * q)))]

    boxes = []
    for sc_ in tl["scenes"]:
        got = []
        for b in sc_["blocks"]:
            if b["kind"] != "a_roll":
                continue
            got += [x for x in track.get(b["file"], {}).get("samples", [])
                    if x and b["src_start"] <= x["t"] < b["src_end"]]
        if not got:
            continue
        boxes.append({"a": sc_["abs_start"], "b": sc_["abs_end"], "samples": len(got),
                      "box": {"x0": pct([x["x0"] for x in got], 0.10),
                              "x1": pct([x["x1"] for x in got], 0.90),
                              "y0": pct([x["y0"] for x in got], 0.10),
                              "y1": pct([x["y1"] for x in got], 0.90)}})

    base = build_zoomed(aroll, zooms, boxes, total, out / "zoom_parts")

    # ── 라우드니스: 블록별로 잰다 ────────────────────────────────────────
    silent = {f["id"] for f in d["meta"]["source"]["files"] if f.get("speech") is False}
    gains, gain_log = [], []
    for s in tl["scenes"]:
        for b in s["blocks"]:
            if b["kind"] != "a_roll":
                continue
            p = s4 / "parts" / f'{b["block_id"]}.mp4'
            lufs = measure_lufs(p)
            tgt = pol["loudness_lufs_silent"] if b["file"] in silent else pol["loudness_lufs"]
            g = max(-12.0, min(18.0, tgt - lufs))
            gains.append((b["abs_start"], b["abs_end"], g))
            gain_log.append({"block_id": b["block_id"], "file": b["file"],
                             "measured_lufs": round(lufs, 1), "target_lufs": tgt,
                             "gain_db": round(g, 1)})
    vol = "0"
    for a, z, g in reversed(gains):
        vol = f"if(between(t,{a:.3f},{z:.3f}),{10**(g/20):.4f},{vol})"

    # ── SFX ─────────────────────────────────────────────────────────────
    sfx, sfx_in = [], []
    for i, x in enumerate(d["sfx"]):
        t_at = at(x)
        if t_at is None or not (0 <= t_at < total):
            continue
        f = s6 / "sfx" / f'{x["kind"]}.wav'
        sfx_in += ["-i", str(f)]
        sfx.append((len(sfx_in) // 2 + 1, t_at, x["gain_db"]))  # 0=aroll, 1=overlay

    fc = ["[1:v]format=rgba[ov]",
          f"[0:v][ov]overlay=0:0:format=auto,fade=t=out:st={total-1.0:.2f}:d=1.0[v]",
          f"[0:a]volume=eval=frame:volume='{vol}'[a0]"]
    mix = "[a0]"
    for k, (idx, at, gdb) in enumerate(sfx):
        fc.append(f"[{idx}:a]adelay={int(at*1000)}|{int(at*1000)},volume={gdb}dB[s{k}]")
        mix += f"[s{k}]"
    fc.append(f"{mix}amix=inputs={1+len(sfx)}:normalize=0:dropout_transition=0,"
              f"alimiter=limit=-1.5dB,afade=t=out:st={total-1.0:.2f}:d=1.0[a]")

    venc = (["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "31", "-row-mt", "1",
             "-deadline", "good", "-cpu-used", "3", "-c:a", "libopus", "-b:a", "128k"]
            if fmt == "webm" else
            ["-c:v", "h264_videotoolbox", "-b:v", "14M", "-c:a", "aac", "-b:a", "192k"])
    master = out / f"master.{fmt}"
    cmd = (["ffmpeg", "-y", "-v", "error", "-stats", "-i", str(base),
            "-f", "concat", "-safe", "0", "-i", str(s6 / "overlay.txt")] + sfx_in +
           ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]",
            "-pix_fmt", "yuv420p", "-r", str(tl["fps"]), *venc, str(master)])
    (inp / "ffmpeg_cmd.txt").write_text(" \\\n  ".join(cmd))
    r = subprocess.run(cmd)
    if r.returncode:
        raise SystemExit(1)

    (out / "polish_log.json").write_text(json.dumps(
        {"zooms": zooms, "reframe": boxes, "gains": gain_log, "sfx_count": len(sfx),
         "bgm": "없음 — as_bgm 미확보",
         "note": "발화 -14 LUFS / 무발화 -20 LUFS 목표로 블록별 게인 후 -1.5dBTP 리미터"},
        ensure_ascii=False, indent=1))
    print(f"줌 {len(zooms)} · SFX {len(sfx)} · 블록 게인 {len(gain_log)}")
    print(f"→ {master.resolve()}")


if __name__ == "__main__":
    main()
