# apps — 사용자가 쓰는 제품

**아직 코드가 없다.** 무엇이 들어올지 정해져 있어서 폴더를 먼저 만들었다.
근거는 [MVP 기획서 §6.2](../docs/product/mvp-plan-v1.md) 와
[제품정의서 §3](../docs/product/product-definition-v1.md) 이다.

## 들어올 것 셋

MVP 기획서가 정한 사용자 인터페이스 3개가 그대로 하위 폴더가 된다.

| 예정 폴더 | 주 사용자 | MVP 목적 |
|---|---|---|
| `admin/` | 운영자 | 패키지 · 세션 · 강사 · 일정 · 예약 · 결제 · 콘텐츠 관리 |
| `coach/` | 김기준 대표 및 Sub Coach | 오늘 수업 확인, 출석, 영상 업로드, 학생별 피드백 |
| `player/` | 패키지 구매자 | 강의 시청, 수업 예약·결제, 수업 전후 자료와 영상 확인 |

제품정의서의 이름과는 이렇게 대응한다.

```
Product A. Academy Admin                admin/ + coach/
Product B. Player App                   player/
Product C. Sports Intelligence Platform 저장소 최상단의 파이썬 기능 9개
```

## Product C 는 여기 없다

영상 처리·분석 엔진은 이미 최상단에 기능별 폴더로 있다.
`rally-*` · `match-*` · `video-*` · `lecture-*` 가 그것이고,
[ace-poc README](../../ace-poc/README.md) 가 그 지도다.

**옮기지 않았다.** 지금 옮기면 `runs/` 와 `cvwork/` 의 상대경로가 전부 끊긴다.
`apps/` 아래 제품이 실제로 이 엔진을 호출하게 될 때 배치를 다시 정한다.

## 규칙

최상단 README 의 원칙을 그대로 따른다.

> 코드도 계획도 없으면 폴더를 만들지 않는다. 빈 껍데기는 구조를 흐린다.

그래서 `admin/` · `coach/` · `player/` 를 **미리 만들어두지 않았다.**
위 표는 계획이고, 폴더는 첫 커밋이 생길 때 만든다.
`packages/` 같은 공용 폴더도 두 번째 사용자가 생길 때 뺀다.

## 정해지지 않은 것

```
기술 스택        MVP 기획서 §11 "MVP 개발팀과 기술방식" 이 미결
코치 앱의 형태    모바일 웹/PWA 로 적혀 있으나 확정 아님
결제 수단        최소 1개는 필수 범위 (MVP 기획서 §6.4) — 어느 PG 인지 미정
```
