# 스크립터

무편집 영상을 **전사 · 대본 · 편집 지시서**로 바꾼다.
Whisper 로 말을 받아쓰고, 인물을 추적하고, 대본과 맞춰 타임코드를 붙인다.

**뒤의 모든 기능이 여기서 원재료를 먹는다.** 편집의 앞단이 아니라 fan-out 지점이다.

```
                  ┌─→ video-edit         directive.json 을 실행해 영상을 만든다
video-scripter ───┤
                  ├─→ lecture-summary    대본을 읽어 수업 자료를 만든다
                  └─→ lecture-shortform  전사를 읽어 좋은 구간을 고른다
```

`lecture-summary` 는 **완성 영상이 아니라 대본을 먹는다.** 증거가 코드에 있다.

```python
# lecture-summary/src/student_pages.py
tr = ROOT / "runs/002/s1_audio_visual_data_fusion/output/subject_track.json"
```

s1 산출물을 직접 읽는다. 유닛 경계 · 축 문장 · 도해의 근거도 전부 `edited_script.md`
에서 나왔다. **편집을 안 해도 자료는 만들 수 있다.**

## 출력 네 가지

```
전사 JSON        단어 단위 타임스탬프 · 말더듬 · 무음 구간
subject_track    인물 박스 — 크롭·리프레임의 근거
script.html      사람 편집자가 읽는다
directive.json   기계가 먹는다
```

**"영상을 대본화해서 편집자에게 맡기면 되냐"** 는 질문의 답이 `script.html` 이다.
자동 편집을 안 쓰더라도 이 산출물만으로 외주 편집이 돌아간다.

## 원칙 — 판단은 여기서 끝난다

모든 편집 판단이 `directive.json` 하나로 확정된다.
뒤 단계는 이걸 기계적으로 실행할 뿐 새로운 판단을 하지 않는다.
**결과에 문제가 있으면 지시서만 보면 원인을 추적할 수 있다.**

```
단일 좌표계   모든 시간은 원본 타임코드(초, float) 하나. 중간에 물리적 삭제를 하지
             않으므로 좌표가 밀리지 않는다.
무음 ≠ 삭제   말없이 보여주는 시범 동작이 가장 값진 구간이다. 시각 패스가 보호
             마킹을 하고, 보호는 삭제보다 항상 우선한다.
             ← 범용 편집 도구(Descript 등)와의 근본적 차별점
```

## 두 단계

```
src/s1_audio_visual_data_fusion/
  귀   Whisper — 단어 단위 타임스탬프 · 말더듬 · NG · 무음 구간
  눈   시각 패스 — 인물 추적 박스 · 시범 동작 보호 마킹
  → subject_track.json · 전사 JSON

src/s2_storyline_and_directive/
  대본 매칭 → 컷 리스트 → directive.json
  script.py · script_doc.py · trim_script.py · rebase_anchors.py
  eval_cuts.py · diff_human.py   ← 사람 편집본과 비교
  review_html.py                 ← 검수용 HTML
```

**LLM은 영상을 보지 않는다.** 텍스트(전사·대본)만 읽고 타임코드를 출력한다.

## 검증

지시서 A~H 를 만들어 사람 편집본과 대조했다. `output/*.json` · `eval_cuts.json`
무음 탐지는 RMS 백분위 방식이 21개 중 18개를 놓쳐 ffmpeg `silencedetect -30dB` 로 교체했다.

## output

```
script.md / .html            지시서 대본
edited_script.md / .html     편집본 대본 (자막·그래픽·효과음 시각까지)
speech_only.txt              말만
schema.md                    지시서 스키마
directive_{A,B,D,E,H}.json   버전별 지시서
```

`edited_script.md` 가 특히 쓸모 있다 — 자막·줌·그래픽이 몇 초에 들어갔는지가
시각과 함께 적혀 있어서, 다른 기능들이 이걸 근거로 쓴다.
