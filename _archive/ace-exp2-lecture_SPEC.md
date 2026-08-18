# 실험 2 — 강의 원본: 대본 기반 자동 러프컷 검증

> Project ACE 기술 검증. **조사 실험이지 제품이 아니다.**
> 검증할 명제: "촬영 원본 + 대본을 주면, LLM이 자막을 읽고 컷 리스트를 만들어
> 러프컷까지 자동으로 나온다" — 8시간 raw에도 확장 가능한 구조인지 포함.

## 0. 파이프라인 (전체 그림)

```
원본 영상 → ① 무음 분할 → ② 전사(타임스탬프) → ③ Claude: 대본 매칭 + 컷리스트 JSON
        → ④ ffmpeg 러프컷 + 편집자용 CSV/EDL
```

핵심 원칙: **LLM은 영상을 보지 않는다. 텍스트(자막)와 대본만 읽고 타임코드를 출력한다.**

## 1. 입력 (사용자가 준비)

- `input/lecture_raw.mp4` — 강의 촬영 원본. 30분~1시간 권장 (검증엔 충분, 8시간은 확장성 계산으로 커버)
- `input/script.md` — 촬영 대본. 항목별 번호가 있으면 좋고 없어도 됨.
- 없으면 시작하지 말고 요청. **대체 불가** — 이 실험은 "대본과 실촬영의 매칭"이 본질이므로 아무 영상이나 쓰면 안 됨.

## 2. 환경

- Python 3.10+, `ffmpeg`
- 전사 (M1 Pro 기준): **`mlx-whisper` 우선** (Apple Silicon 전용 최적화, faster-whisper보다 빠름), 설치 문제 시 `faster-whisper` CPU 폴백. 모델 `large-v3`, 언어 `ko` 고정.
- LLM: Anthropic API (`ANTHROPIC_API_KEY` 환경변수). 모델은 사용 가능한 최신 Claude.
- 패키지: `faster-whisper`, `anthropic`, `pandas`

## 3. 단계별 상세

### ① 무음 분할
- `ffmpeg -af silencedetect=noise=-35dB:d=1.5` 로 무음 경계 추출.
- 발화 구간 목록 `segments_speech.json` 생성. **전사는 발화 구간만** — 처리량 절감 + 테이크 경계 확보.
- 통계 기록: 원본 길이 대비 발화 비율 % (8시간 확장 계산에 씀).

### ② 전사
- 발화 구간별로 faster-whisper 실행, 세그먼트 단위 타임스탬프 유지.
- 출력 `transcript.json`: `[{"start", "end", "text"}]` (타임코드는 원본 기준으로 보정).
- 테니스 용어 오인식은 **고치지 말고 그대로 둔다** — LLM 매칭이 오인식에 강건한지도 검증 대상.

### ③ Claude 컷 리스트 생성
- 입력: `script.md` 전문 + `transcript.json`
- 트랜스크립트가 길면 30분 단위로 나눠 넣되, 대본은 매 호출에 전문 포함.
- 요구 출력 (JSON only):
```json
{
  "cuts": [
    {
      "script_item": "대본 항목 식별자 또는 요약",
      "start": 84.2, "end": 131.0,
      "take": "OK | NG | DUPLICATE",
      "reason": "NG/중복 판정 근거 한 줄",
      "confidence": "high | medium | low"
    }
  ],
  "unmatched_script_items": ["대본에 있는데 촬영에서 못 찾은 항목"],
  "unmatched_video_segments": ["촬영에 있는데 대본에 없는 발화 구간 타임코드"]
}
```
- 같은 대본 항목의 테이크가 여러 개면: 마지막 완주 테이크를 OK, 나머지 DUPLICATE로.
- 프롬프트는 `prompts/cutlist.md` 파일로 분리해 리포트에 첨부.

### ④ 러프컷 + 편집자 인계물
- OK 테이크만 `ffmpeg` concat → `output/roughcut.mp4` (컷 앞뒤 0.5초 패딩)
- `output/cutlist.csv` — 편집자가 프리미어/캡컷에서 그대로 따라 자를 수 있게: 대본항목, 시작TC(HH:MM:SS:FF), 종료TC, 판정, 근거
- (여유 되면) CMX3600 EDL 내보내기. 안 되면 CSV로 충분, 리포트에 표기.

## 4. 평가

정답 라벨 없이 사람 검수 방식:
1. `output/review.html` 생성 — 컷 리스트를 표로, 각 행에 해당 구간 타임코드 링크와 트랜스크립트 원문, Claude의 판정·근거 병기.
2. 사용자가 20개 샘플 검수해서 정확/부정확 표기 → **매칭 정확도 %** 산출.
3. 자동 측정 지표:
   - 원본 대비 러프컷 압축률
   - 대본 커버리지 (매칭된 대본 항목 / 전체)
   - 파이프라인 총 처리 시간, Claude API 비용(토큰 실측)

## 5. 8시간 확장성 계산 (리포트 필수 섹션)

실측값으로 외삽:
- 8시간 원본 = 발화 X시간(①의 비율 적용) → whisper 처리 시간, Claude 호출 수·토큰·비용, 총 소요 시간
- 병목이 어디인지 한 줄 결론

## 6. 산출물

```
output/
  report.md          ← 한 줄 결론 / 매칭 정확도 / 압축률·커버리지 / 8시간 외삽 / 실패 사례 3개
  roughcut.mp4
  cutlist.csv
  cutlist.json
  transcript.json
  review.html
prompts/cutlist.md
```

## 7. 하지 말 것

- 영상 프레임을 LLM에 넣기 (텍스트 파이프라인 검증이 목적)
- 자막 렌더링, 색보정, 음질 개선 등 마감 편집
- 웹 UI
- Whisper 파인튜닝

## 8. 순서

1. ① 무음 분할 → 발화 비율 확인 보고
2. ② 전사 → 품질 샘플 5개 보고
3. ③ 프롬프트 작성 → 첫 30분으로 시범 호출 → 결과 보고 후 전체 실행
4. ④ 러프컷 + review.html
5. 사용자 검수 대기 → 리포트 완성
