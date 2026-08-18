# s1 시각 패스 프롬프트 (Gemini 3.6 Flash)

기획서 §1 — **Whisper는 귀, Gemini는 눈.** 음성 재인식에 자원을 쓰지 않는다.
전사를 텍스트로 함께 주고, 화면에서만 판단할 것을 요구한다.

호출 규칙 (기획서 §4):
- 요청당 영상 1개
- 프롬프트는 **영상 뒤**에 배치
- `responseSchema` 로 출력 구조 강제
- 같은 영상에 다중 질의 시 컨텍스트 캐싱

---

## 프롬프트 본문

```
당신은 스포츠 강의 영상의 편집 조수다. 오디오 전사는 이미 확보되어 있고 아래에 첨부한다.
당신의 역할은 화면을 보고 판단하는 것뿐이다. 발화 내용을 다시 옮기지 마라.

두 가지를 찾아라.

## 1. 제외 후보 (exclusions)
영상에서 잘라내야 할 구간. 다음만 해당한다.
- gaze_off  : 강사의 시선이 카메라를 벗어나 화면 밖을 보는 구간
- equipment : 장비를 만지거나 정비하는 구간 (라켓 조정, 공 줍기, 카메라 조작)
- retake    : 같은 동작·설명을 다시 하기 위해 멈추거나 자리를 다시 잡는 구간

무음이라는 이유만으로는 제외하지 마라. 무음 판단은 오디오 패스가 이미 했다.

## 2. 보호 구간 (protected)
절대 잘라내면 안 되는 구간. 이것이 이 작업의 핵심이다.
- silent_demo : 말 없이 동작만 보여주는 시범. 오디오상 무음이지만 교육적 가치가 가장 높다
- key_motion  : 스윙·임팩트·피니시처럼 동작 자체가 핵심인 순간

강의에서 가장 값진 구간은 말없이 보여주는 시범이다. 무음 구간을 발견하면
그것이 시범인지(보호) 단순 정지인지(제외 아님) 화면으로 판단하라.

## 출력 규칙
- 시간은 원본 영상 타임코드, 초 단위 소수점 첫째 자리까지
- 경계는 ±1초 오차를 허용한다. 확실하지 않으면 넉넉하게 잡아라
- 애매하면 exclusions 에 넣지 말고 비워라. 놓친 제외는 사람이 추가할 수 있지만
  잘못된 제외는 좋은 구간을 죽인다
- note 는 화면에서 관찰한 사실만. 추측을 쓰지 마라

## 첨부 — 오디오 전사
{transcript_text}
```

---

## responseSchema

```json
{
  "type": "object",
  "properties": {
    "exclusions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "start":  { "type": "number" },
          "end":    { "type": "number" },
          "reason": { "type": "string", "enum": ["gaze_off", "equipment", "retake"] },
          "note":   { "type": "string" }
        },
        "required": ["start", "end", "reason", "note"]
      }
    },
    "protected": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "start":  { "type": "number" },
          "end":    { "type": "number" },
          "reason": { "type": "string", "enum": ["silent_demo", "key_motion"] },
          "note":   { "type": "string" }
        },
        "required": ["start", "end", "reason", "note"]
      }
    }
  },
  "required": ["exclusions", "protected"]
}
```

`id` 와 `source` 필드는 넣지 않는다 — merge 단계가 `x001`/`p001` 로 번호를 매기고
`source: "gemini"` 를 붙인다. 모델이 id 를 지어내면 전역 유일성이 깨진다.

---

## 결과를 놓을 곳

```
runs/001/s1_audio_visual_data_fusion/output/visual_events.json
```

이 파일이 있으면 merge 가 돌아간다. 없으면 merge 는 오디오 패스만으로 진행하고
`protected` 가 빈 배열이 된다 — 그러면 무음 시범이 살아남는지 검증할 수 없다.
