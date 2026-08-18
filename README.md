# Project ACE

테니스 영상을 넣으면 편집된 영상과 학습 자료가 나온다.
기능 9개. **폴더 하나가 기능 하나다.**

```
랠리 — 낮은 화각 · 폰 거치 · 대부분의 유저가 이렇게 찍는다      상태
  rally-detect          랠리를 자동으로 표시한다                 새로 만듦
  rally-trajectory      샷의 경로를 영상 위에 그린다              검출률 재측정 필요
  rally-cut             포인트 사이 빈 시간을 걷어낸다             반쯤

경기 — 높은 화각 · 코트 전체가 화면의 50% 이상
  match-analysis        타격·스윙·낙구 → 선수 리포트              됨

강의
  lecture-scripter      영상 → 대본 + 편집 지시서                 됨
  lecture-edit          지시서대로 잘라 완성 영상                  됨
  lecture-infographic   대본과 프레임에서 도해를 만든다             됨
  lecture-material      수강생용 수업 전/후 자료                   됨
  lecture-shortform     레슨에서 세로 클립을 뽑는다                데모만
```

## 랠리와 경기를 나누는 선은 촬영 조건이다

**코트 좌표계(호모그래피)가 성립하는가.** 그것 하나로 갈린다.

```
낮은 화각      코트가 화면 세로의 13%   재투영 오차 92.8 cm   코트 좌표 불가
높은 화각      54 ~ 70%                5.1 ~ 6.7 cm         코트 좌표 가능
```

| | 필요한 것 | 낮은 화각 |
|---|---|---|
| 랠리 경계 | 선수 포즈만 | **된다** |
| 궤적선 (화면 좌표) | 공 검출 | **된다** — 단 검출률 미측정 |
| 낙구 · 인아웃 · 속도 · 코트맵 | 코트 좌표 변환 | **안 된다** |

`rally-*` 는 대부분의 유저가 실제로 찍는 영상을 대상으로 한다.
`match-analysis` 는 촬영 조건을 갖춘 소수를 대상으로 한다.

## 두 도메인은 코드를 공유하지 않는다

```
랠리·경기   CV — 선수 포즈 · 공 검출 · 코트 좌표계     ultralytics · opencv
강의        텍스트 — 전사 · 대본 · LLM               whisper · Claude API
```

환경이 다르고 겹치는 코드가 없다. **한 세션에서 같이 돌리지 않는다.**

## 이어지는 순서

```
랠리
  rally-detect ─ rallies.json ─→ rally-cut
  render_any.py 검출 캐시 ─→ rally-trajectory  ·  match-analysis     (공용 입력)

강의
  lecture-scripter ─ directive.json ─→ lecture-edit ─ 완성 영상 ─→ lecture-material
                                                                      ↑
                                            lecture-infographic ─ 도해 ┘
```

강의 쪽 이음선이 `directive.json` 하나다. **판단은 scripter 에서 끝나고 뒤는 실행만 한다.**

## 폴더 안 구조

```
<기능>/
  README.md    무엇인지 · 어떻게 · 상태 · 다음 할 일
  src/         코드
  output/      산출물 (증거)
```

## 지금 가장 급한 두 가지

```
1  정답 라벨을 찍는다     rally-cut/output/labeling.html
   랠리 검출 성능을 한 번도 측정한 적이 없다. 이게 없으면 개선을 판정할 수 없다.

2  match_c 로 공 검출률을 잰다
   rally-trajectory 가 폴더로 존재할 가치가 있는지가 이 숫자에 걸려 있다.
```

## 원본 영상

`media/` 에 둔다. 기존 실험 폴더는 `_archive/` 참고.
