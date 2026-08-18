#!/usr/bin/env python3
"""s1(눈) — 원본 클립에서 인물이 프레임 어디에 있는지 찾는다.

왜 필요한가. 지시서는 그래픽 위치를 '하체 오른발', '골반' 처럼 의미로 적는다.
이걸 픽셀로 옮기려면 인물의 바운딩 박스가 있어야 한다.
사람 편집본의 composition 수치를 쓰면 안 된다 — 그건 크롭된 편집 화면 기준이라
무편집 원본에 대면 어긋난다 (실제로 어긋나는 걸 확인해서 이 파일을 만들었다).

카메라가 고정이라 모델 없이 된다. 클립마다 프레임 중앙값으로 배경을 만들고,
프레임과의 차이가 큰 덩어리를 인물로 본다.

output/subject_track.json — 클립별 0.5초 간격 바운딩 박스 (0~1 정규화)

usage: python subject_track.py [run_dir]
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
STEP_HZ = 2          # 초당 샘플 수
SW, SH = 320, 180    # 분석 해상도. 인물 위치만 알면 되니 크게 볼 이유가 없다
THRESH = 26          # 배경과의 밝기 차 (0~255)
MIN_MASS = 0.004     # 열/행이 인물로 인정받는 최소 비율


def frames(video: Path, tmp: Path) -> np.ndarray:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video),
                    "-vf", f"fps={STEP_HZ},scale={SW}:{SH}", "-q:v", "4",
                    str(tmp / "%05d.jpg")], check=True)
    fs = sorted(tmp.glob("*.jpg"))
    return np.stack([np.asarray(Image.open(f).convert("L"), dtype=np.uint8) for f in fs])


def track(stack: np.ndarray) -> list:
    # 중앙값 배경. 인물이 움직이는 한 배경에는 인물이 남지 않는다.
    bg = np.median(stack[:: max(1, len(stack) // 60)], axis=0)
    out = []
    for i, fr in enumerate(stack):
        mask = np.abs(fr.astype(np.int16) - bg) > THRESH
        col, row = mask.mean(axis=0), mask.mean(axis=1)
        cs, rs = np.where(col > MIN_MASS)[0], np.where(row > MIN_MASS)[0]
        if len(cs) < 2 or len(rs) < 2 or mask.mean() > 0.45:
            out.append(None)          # 인물을 못 잡았다. 없다고 적는다
            continue
        # 가장 두꺼운 열 주변만 남겨 잔 노이즈(공·그림자)를 떨군다
        peak = int(np.argmax(col))
        lo = hi = peak
        while lo > cs[0] and col[lo - 1] > MIN_MASS:
            lo -= 1
        while hi < cs[-1] and col[hi + 1] > MIN_MASS:
            hi += 1
        sub = mask[:, lo:hi + 1]
        rr = np.where(sub.mean(axis=1) > MIN_MASS)[0]
        if len(rr) < 2:
            out.append(None)
            continue
        out.append({"t": round(i / STEP_HZ, 2),
                    "x0": round(lo / SW, 4), "x1": round((hi + 1) / SW, 4),
                    "y0": round(rr[0] / SH, 4), "y1": round((rr[-1] + 1) / SH, 4)})
    return out


def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "runs/002"
    out = run_dir / "s1_audio_visual_data_fusion/output"
    out.mkdir(parents=True, exist_ok=True)
    res = {}
    for v in sorted((ROOT / "raw").glob("c01_*.mp4")):
        tmp = Path(tempfile.mkdtemp())
        try:
            tr = track(frames(v, tmp))
        finally:
            shutil.rmtree(tmp)
        found = [t for t in tr if t]
        res[v.stem] = {"hz": STEP_HZ, "found": len(found), "total": len(tr), "samples": tr}
        if found:
            cx = float(np.mean([(t["x0"] + t["x1"]) / 2 for t in found]))
            hh = float(np.mean([t["y1"] - t["y0"] for t in found]))
            print(f"{v.stem}  {len(found)}/{len(tr)} 프레임에서 인물 검출 · "
                  f"평균 좌우 {cx*100:.0f}% · 평균 키 {hh*100:.0f}%")
        else:
            print(f"{v.stem}  인물 검출 실패")
    (out / "subject_track.json").write_text(json.dumps(res, ensure_ascii=False))
    print(f"→ {(out / 'subject_track.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
