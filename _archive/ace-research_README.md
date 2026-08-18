# Project ACE — 기술 조사 실험

> **조사 단계다. 제품 개발이 아니다.**
> 목표는 근거 있는 리포트 2장. 코드는 리포트가 나오면 버린다.

## 폴더

```
ace-exp1-match/      경기 영상 → 플레이 구간·타격 이벤트 검출
  SPEC.md            ← 클로드 코드에 읽힐 스펙
  input/             영상 넣는 곳 (README 참고)
  output/            리포트·컷영상·그래프 나오는 곳

ace-exp2-lecture/    강의 원본 + 대본 → 자동 러프컷
  SPEC.md
  input/
  output/
  prompts/
```

## 세션은 나눠서

두 실험을 한 세션에서 돌리지 말 것. 환경이 다르고(CV 스택 vs Whisper+API) 공유 코드가 없다.
각 폴더에서 클로드 코드를 따로 연다.

## 첫 프롬프트

스펙을 붙여넣지 말고 파일로 읽힌다.

> `SPEC.md` 읽고 시작해줘. 조사 실험이니까 §7 "하지 말 것"을 지켜줘.
> 각 단계 끝날 때마다 중간 결과 보고하고 다음으로 넘어가.

## 실행 중 사람이 끊어줘야 하는 것

1. **Track A 매몰** — 기반 리포지토리가 커밋 2개짜리라 깨질 확률이 높다.
   디버깅 몇 시간 가기 시작하면 멈추고 폴백 체인으로 넘긴다.
   **Track A가 통째로 실패해도 실험은 성공이다** — "공개 가중치는 아마추어 화각에서 안 된다"가 찾던 답이다.
2. **리팩토링** — 재사용 구조 만들려 들면 막는다.
3. **파라미터 무한 튜닝** — 기본값 + 1회 조정까지.

## 준비물 체크리스트

- [ ] 경기 영상 10분 (exp1, 필수)
- [ ] 방송 중계 영상 (exp1, 선택 — 대조군)
- [ ] 강의 촬영 원본 + 대본 (exp2, 필수)
- [ ] `ANTHROPIC_API_KEY` (exp2, 필수)
- [ ] `GEMINI_API_KEY` (exp1 Track E, 없으면 스킵)
- [ ] 학습된 가중치 2개 미리 다운로드 (선택, 시간 절약)
  - YOLOv5 공 검출: https://drive.google.com/file/d/1UZwiG1jkWgce9lNhxJ2L0NVjX1vGM05U/view
  - 코트 키포인트: https://drive.google.com/file/d/1QrTOF1ToQ4plsSZbkBs3zOLkVt3MBlta/view

## 실험 중 사람이 할 작업

- exp1: 정답 라벨링. 1단계에서 `labeling.html`이 생성되면 10분 영상 기준 20~30분 소요.
- exp2: 컷 리스트 검수. `review.html`에서 20개 샘플.

## 끝나면

`output/report.md` 두 개를 대화로 가져가서 해석·보고자료 정리.
클로드 코드는 실행, 판단은 대화에서.

## 환경 메모 (M1 Pro)

- PyTorch MPS 사용. `device="mps"` 명시.
- 외부 코드의 `cuda` 하드코딩 → `mps` 패치 필요.
- MPS 미지원 연산 나오면 해당 모델만 CPU 폴백하고 리포트에 기록.
- exp2 전사는 `mlx-whisper` 우선 (Apple Silicon 최적화).
