# Project ACE

테니스를 배우고 가르치는 전 과정을 하나의 제품으로 만든다. 첫 종목이 테니스다.

저장소가 **두 덩이**로 갈린다. 경계는 **검증된 엔진**과 **사람이 쓰는 제품**이다.

```
ace-poc/     파이썬 영상 엔진 + 데이터        연구가 끝나 "된다" 로 판정된 것
ace-apps/    기획 문서 + 코치·관리자 앱        사람이 쓰는 것
```

## ace-poc — 영상 엔진

제품정의서가 말하는 **Product C (Sports Intelligence Platform)** 다.
테니스 영상을 넣으면 편집된 영상과 학습 자료가 나온다. 기능 9개, **폴더 하나가 기능 하나다.**

```
rally-*     플레이 영상 — 낮은 화각 · 폰 거치            검출 · 궤적 · 컷
match-*     경기 영상 — 높은 화각 · 코트 좌표 성립       타격 · 스윙 · 낙구 · 리포트
video-*     영상 일반 — 관찰 · 판단 · 실행 세 층
lecture-*   강의 전용 — 수업 자료 · 숏폼
```

지도와 상태는 [ace-poc/README.md](ace-poc/README.md) 에 있다. 실행 방법, 데이터 배치,
그리고 **무엇이 안 되는지**(낮은 화각에서 속도·Score·인아웃 불가, 재투영 오차 92.8cm)가
거기 적혀 있다.

## ace-apps — 기획과 제품

```
ace-apps/
  docs/     사업 로드맵 · 제품정의서 · MVP 기획서 · 화면 설계 · 리서치 · 온보딩
  apps/     관리자 웹 · 코치 앱          아직 코드 없음
```

무엇을 만들지는 [ace-apps/docs/README.md](ace-apps/docs/README.md) 가 갖는다.
문서끼리 안 맞는 지점도 거기 모아 뒀다 — 특히 **로드맵 Phase 1 이 넣은 속도·Score 가
`ace-poc` 의 실측으로는 낮은 화각에서 안 나온다**는 것.

학습자 앱은 이 저장소에서 만들지 않는다. 우리 몫은 코치와 관리자다.

## 왜 갈랐나

**스택이 다르고 수명이 다르다.**

```
ace-poc    파이썬 · CV · 배치 실행       실험이 끝나면 결과가 남는다
ace-apps   TypeScript · 웹 · 상시 서비스  계속 고쳐 쓴다
```

`ace-poc` 의 스크립트는 `cwd` 기준 상대경로로 `input/` · `models/` · `kp_*.json` 을 찾고,
`runs/` 안 concat 파일에는 절대경로가 박혀 있다. 연구용으로 그렇게 쓰였고 고치지 않았다.
**그 관례를 웹 앱에 섞지 않으려고 폴더를 나눴다.**

둘은 서로 `import` 하지 않는다. 나중에 앱이 엔진을 부를 때가 오면 그때 경계를 다시 정한다.

## 기획이 양쪽을 다 가리킨다

`docs/` 를 `ace-apps` 안에 둔 이유는 **화면을 정하는 문서이기 때문**이다. 다만 그 문서의
판정 근거 절반은 `ace-poc` 의 실측치다.

```
무엇을 만들지        ace-apps/docs/product/       →  ace-apps/apps/ 가 구현
무엇이 가능한지       ace-poc/README.md 의 실측치   →  로드맵의 AI 범위를 가른다
```

## 상태

```
ace-poc     video-* · match-analysis · lecture-summary  됨
            rally-cut 반쯤 · rally-trajectory 검출률 미측정 · rally-detect 코드 없음
            lecture-shortform 데모만
ace-apps    docs 정리 완료 — PRD · 화면 설계 · 플로우 설계 · 디자인 시스템
            apps 코드 없음. 다음 작업
```
