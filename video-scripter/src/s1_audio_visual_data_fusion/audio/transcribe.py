#!/usr/bin/env python3
"""s1 오디오 패스 — Whisper. 귀 역할.

input/  원본 영상 + glossary.md
output/ audio_16k.wav, transcript.json

전사만 한다. 오인식은 고치지 않는다 (glossary 는 initial_prompt 로 예방만).
제외 후보(filler/stutter/silence) 검출은 transcript 를 보고 다음에 붙인다.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

MODEL = "mlx-community/whisper-large-v3-mlx"
RUN = Path(sys.argv[1] if len(sys.argv) > 1 else "runs/001")
STEP = RUN / "s1_audio_visual_data_fusion"
IN, OUT = STEP / "input", STEP / "output"


def find_sources() -> list[Path]:
    v = [p for p in sorted(IN.iterdir())
         if p.suffix.lower() in {".webm", ".mp4", ".mov", ".mkv"}]
    if not v:
        raise SystemExit(f"영상이 없다: {IN}")
    return v


def read_glossary() -> str:
    """glossary.md 의 ```terms 펜스 안만 용어로 읽는다.

    펜스 밖 설명 문장이 initial_prompt 에 섞이면 전사가 오염된다.
    """
    g = IN / "glossary.md"
    if not g.exists():
        return ""
    m = re.search(r"```terms\n(.*?)```", g.read_text(), re.S)
    if not m:
        return ""
    terms = [t.strip() for t in m.group(1).splitlines() if t.strip()]
    return ", ".join(terms)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    prompt = read_glossary()
    print(f"initial_prompt: {prompt or '(없음)'}\n")

    import mlx_whisper

    for i, src in enumerate(find_sources(), 1):
        n = src.stem
        wav = OUT / f"{n}.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(src),
             "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
            check=True,
        )
        r = mlx_whisper.transcribe(
            str(wav),
            path_or_hf_repo=MODEL,
            language="ko",
            word_timestamps=True,
            initial_prompt=prompt or None,
            # 무발화 구간에서 앞 문장을 계속 뱉는 반복 루프를 막는다.
            # c01_03 에서 같은 문장이 48회 반복되는 걸 확인해서 끈다.
            condition_on_previous_text=False,
            verbose=False,
        )
        (OUT / f"{n}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1))

        segs = [s for s in r["segments"] if s["text"].strip()]
        (OUT / f"{n}.txt").write_text(
            "".join(f"[{int(s['start']//60):02d}:{s['start']%60:05.2f}] "
                    f"{s['text'].strip()}\n" for s in segs)
            or "(무발화 — 말소리 없음)\n"
        )
        total = float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(wav)],
            capture_output=True, text=True, check=True).stdout)
        spoken = sum(s["end"] - s["start"] for s in segs)
        words = sum(len(s.get("words", [])) for s in segs)
        print(f"{n}  {total:6.1f}초 · 세그 {len(segs):3d} · 단어 {words:4d} · "
              f"발화 {spoken/total*100:3.0f}%")

    print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
