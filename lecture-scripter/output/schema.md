# 통합 편집 지시서 JSON 스키마 명세

버전: 1.0
2단계의 출력이자 3~6단계의 유일한 입력. 이 문서에 없는 필드를 실행 단계가 임의로 해석하는 것을 금지한다.

---

## 좌표계 규칙 (스키마 전체에 적용)

1. **원본 좌표**: 원본 영상 타임코드, 초 단위 float. `start` / `end` 필드는 항상 원본 좌표다.
2. **블록 앵커**: 오버레이(B-roll, CG, 자막, SFX)의 위치는 출력 타임라인 절대 시각이 아니라 `{block_id, offset_sec}`로 지정한다. offset은 해당 블록의 출력상 시작점 기준. 컷 타이밍이 조정되어도 오버레이가 블록을 따라간다.
3. 물리적 컷 이후의 타임코드는 어떤 필드에도 저장하지 않는다.

## 우선순위 규칙

`protected` > `exclusions`. 두 구간이 겹치면 보호가 이긴다. 3단계 lint가 겹침을 발견하면 경고를 남기고 exclusion 쪽을 무효화한다.

---

## 최상위 구조

```json
{
  "schema_version": "1.0",
  "meta": { ... },
  "exclusions": [ ... ],
  "protected": [ ... ],
  "storyline": [ ... ],
  "b_roll": [ ... ],
  "assets": [ ... ],
  "subtitles": [ ... ],
  "sfx": [ ... ],
  "polish": { ... }
}
```

각 실행 단계가 읽는 범위:
| 단계 | 읽는 섹션 |
|---|---|
| 3 (lint) | exclusions, protected, storyline |
| 4 (A-roll) | storyline |
| 5 (B-roll) | b_roll, assets |
| 6 (에셋) | subtitles, sfx, assets |
| 7 (마감) | polish |

---

## meta

```json
{
  "project_id": "forehand_finish_001",
  "source": {
    "file": "raw/lecture_forehand.webm",
    "duration_sec": 483.36,
    "fps": 60,
    "resolution": "1920x1080"
  },
  "output": {
    "format": "shortform",
    "aspect": "9:16",
    "crop": { "x": 656, "y": 0, "w": 608, "h": 1080 },
    "target_duration_sec": 45
  },
  "language": "ko",
  "glossary": ["테이크백", "라켓 페이스", "폴로스루", "임팩트", "그립"],
  "created_at": "2026-08-14T17:30:00+09:00",
  "directive_variant": "A"
}
```

`directive_variant`: 2단계가 복수안을 낼 때의 식별자(A/B/C). G1에서 선택된 안만 3단계로 진입.
`crop`: 숏폼일 때 9:16 크롭 좌표. capcut-cli 워크플로의 고정 크롭 값이 여기 들어간다.

---

## exclusions — 제외 목록 (1단계 산출, 2단계에서 확정)

```json
[
  {
    "id": "x001",
    "start": 12.4,
    "end": 14.1,
    "reason": "filler",
    "source": "whisper",
    "text": "어..."
  },
  {
    "id": "x002",
    "start": 95.0,
    "end": 101.0,
    "reason": "gaze_off",
    "source": "gemini",
    "note": "카메라 밖 시선, 장비 조작"
  }
]
```

`reason` 허용값: `filler` | `stutter` | `ng_audio` | `silence` | `gaze_off` | `equipment` | `retake`
`source` 허용값: `whisper` | `gemini` | `human`

Gemini 출처 항목의 경계는 ±1초 오차 전제. `text`는 오디오 계열 reason에서만 존재.

---

## protected — 보호 구간 (1단계 Gemini 산출)

```json
[
  {
    "id": "p001",
    "start": 210.0,
    "end": 225.0,
    "reason": "silent_demo",
    "source": "gemini",
    "note": "무음 포핸드 시범 3회 반복"
  }
]
```

`reason` 허용값: `silent_demo` | `key_motion` | `human_pin` (사람이 수동 지정)

exclusions의 `silence`와 겹치는 경우가 이 필드의 존재 이유다. 겹침 시 protected 우선.

---

## storyline — A-roll 블록 시퀀스 (배열 순서 = 출력 순서)

```json
[
  {
    "block_id": "b01",
    "role": "hook",
    "a_roll": [
      { "start": 372.0, "end": 378.5 }
    ],
    "narration_ref": "농구공 크기만큼 감싸주면...",
    "note": "원본 후반의 비유를 훅으로 전진 배치"
  },
  {
    "block_id": "b02",
    "role": "problem",
    "a_roll": [
      { "start": 84.0, "end": 91.0 },
      { "start": 96.5, "end": 103.0 }
    ]
  },
  {
    "block_id": "b03",
    "role": "point",
    "a_roll": [
      { "start": 160.0, "end": 175.0 }
    ]
  },
  {
    "block_id": "b04",
    "role": "summary",
    "a_roll": [
      { "start": 452.0, "end": 460.0 }
    ]
  }
]
```

`role` 허용값: `hook` | `opening` | `problem` | `point` | `demo` | `summary` | `outro`
`a_roll`: 원본 좌표 구간 배열. 한 블록이 여러 구간을 이어붙일 수 있다(내부 순서 = 배열 순서).
`narration_ref`: 해당 구간 발화의 첫 문장. 사람 리뷰용 표지이며 실행에는 사용하지 않는다.

규칙: a_roll 구간은 exclusions와 겹치면 안 된다(3단계 lint가 검증). 재배치 자유 — 배열 순서가 원본 순서와 무관해도 된다.

---

## b_roll — V2 트랙 오버레이

```json
[
  {
    "id": "br01",
    "anchor": { "block_id": "b03", "offset_sec": 2.0 },
    "duration_sec": 4.0,
    "source": {
      "type": "source_clip",
      "start": 213.0,
      "end": 215.0,
      "speed": 0.5
    },
    "note": "시범 동작 슬로우 모션 인서트"
  },
  {
    "id": "br02",
    "anchor": { "block_id": "b02", "offset_sec": 1.0 },
    "duration_sec": 3.0,
    "source": { "type": "asset", "asset_id": "as03" }
  }
]
```

`source.type` 허용값: `source_clip`(원본에서 발췌) | `asset`(외부/제작 에셋)
`speed`: 0.5 = 2배 슬로우. source_clip에서만 유효. `duration_sec`는 출력상 길이이며 `(end-start)/speed`와 일치해야 한다(3단계 lint 검증 대상).
A-roll 오디오는 항상 유지된다.

---

## assets — 에셋 목록 겸 조달 상태

```json
[
  {
    "id": "as01",
    "type": "cg",
    "status": "need_create",
    "description": "골반 회전 방향 화살표 (SVG, 규칙 기반)",
    "spec": { "style": "arrow_rotation", "target": "pelvis" }
  },
  {
    "id": "as02",
    "type": "sfx",
    "status": "exists",
    "file": "sfx/whoosh_01.wav"
  },
  {
    "id": "as03",
    "type": "broll_footage",
    "status": "need_shoot",
    "description": "라켓 그립 클로즈업, 정면"
  }
]
```

`type` 허용값: `cg` | `sfx` | `broll_footage` | `image`
`status` 허용값: `exists` | `need_create` | `need_shoot`

`need_shoot` 항목만 필터링하면 그대로 추가 촬영 요청서가 된다. `exists`가 아닌 에셋을 참조하는 b_roll/sfx 항목이 있으면 3단계 lint가 경고(실행은 해당 항목 스킵으로 degrade).

---

## subtitles — V3 트랙 자막

```json
[
  {
    "id": "st01",
    "anchor": { "block_id": "b01", "offset_sec": 0.0 },
    "duration_sec": 2.2,
    "text": "던지기 vs 당기기",
    "style": "emphasis"
  },
  {
    "id": "st02",
    "anchor": { "block_id": "b01", "offset_sec": 2.2 },
    "duration_sec": 4.3,
    "text": "농구공 크기만큼 감싸주세요",
    "style": "normal"
  }
]
```

`style` 허용값: `normal` | `emphasis` | `title`
일반 자막의 타이밍·텍스트는 Whisper 단어 타임스탬프에서 기계 생성 후 블록 앵커로 변환. 강조 자막은 2단계 LLM이 작성. G3에서 오탈자 검수.

---

## sfx — 오디오 트랙 결합

```json
[
  {
    "id": "sx01",
    "anchor": { "block_id": "b01", "offset_sec": 0.0 },
    "asset_id": "as02",
    "gain_db": -6
  }
]
```

---

## polish — 7단계 마감 파라미터

```json
{
  "loudness_lufs": -14,
  "denoise": true,
  "lut": "coach_warm_v1",
  "deliverable": "mp4"
}
```

`deliverable` 허용값: `mp4` | `nle_xml`
`loudness_lufs`: 플랫폼 표준 -14 LUFS(YouTube/Instagram 기준) 기본.

---

## lint 규칙 요약 (3단계가 검증하는 전체 목록)

1. storyline의 모든 a_roll 구간이 exclusions와 겹치지 않는다
2. protected 구간과 겹치는 exclusion은 무효 처리 + 경고
3. 모든 anchor.block_id가 storyline에 존재한다
4. anchor.offset_sec + duration_sec ≤ 해당 블록의 총 출력 길이
5. b_roll source_clip의 duration_sec = (end - start) / speed
6. asset 참조 무결성: 존재하지 않는 asset_id 참조 금지, status ≠ exists면 경고 + 스킵
7. a_roll 구간이 원본 duration_sec를 벗어나지 않는다
8. block_id, 각 섹션의 id는 전역 유일

lint 통과본만 4단계로 진입한다. 실행 단계에서 스키마 외 상황 발견 시: 임의 해석 금지, 중단 후 스키마 보강.
