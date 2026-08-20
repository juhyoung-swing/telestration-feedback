# 전사 · 관찰

무편집 영상에서 **사실만 뽑는다.** 무슨 말을 언제 했나, 사람이 어디 있나, 어디가 무음인가.

**편집 판단을 하지 않는다.** 목적과 무관하므로 뒤의 모든 기능이 여기서 원재료를 먹는다.

```
                     ┌─→ video-directive     전사 + 대본으로 지시서를 만든다
video-transcribe ────┼─→ lecture-summary     subject_track 으로 크롭을 맞춘다
                     └─→ lecture-shortform   전사로 구간을 고르고 인물을 따라간다
```

## 둘로 본다 — 귀와 눈

```
귀   Whisper       단어 단위 타임스탬프 · 말더듬("어…" "음…") · NG 음성
                   무음 구간은 ffmpeg silencedetect -30dB 로 잡는다
눈   시각 패스      인물 추적 박스 (subject_track.json)
                   말없이 보여주는 시범 동작에 보호 마킹
```

**무음 ≠ 삭제.** 스포츠 강의에서 가장 값진 구간은 말없이 보여주는 시범 동작이다.
오디오 기준으로는 무음이지만 절대 삭제되면 안 된다. 보호 마킹은 삭제 마킹보다 항상 우선한다.
**범용 편집 도구(Descript 등)와의 근본적 차별점이 여기다.**

`crosscheck.py` 가 귀와 눈의 결과를 맞춰 본다.

## 알아둘 것

**무음 탐지를 RMS 백분위로 하면 안 된다.** 21개 중 18개를 놓쳤다.
`ffmpeg silencedetect noise=-30dB` 로 교체했다.

**단일 좌표계.** 모든 시간은 원본 타임코드(초, float) 하나다. 여기서 물리적 삭제를
하지 않으므로 좌표가 밀리지 않는다. 물리적 컷은 `../video-edit` 에서 단 한 번 일어난다.

## 출력

```
전사 JSON        단어 단위 타임스탬프 · no_speech_prob · 무음 구간
subject_track.json   인물 박스 — 크롭·리프레임의 근거
speech_only.txt      말만 뽑은 것
```

`subject_track.json` 을 `lecture-summary/src/student_pages.py` 가 직접 읽는다.
인물 위치에 맞춰 루프 크롭을 잡는다.

## src

```
s1_audio_visual_data_fusion/
  audio/          Whisper 전사
  visual/         인물 추적 · 시범 보호 마킹
  crosscheck.py   귀와 눈 대조
```
