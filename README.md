# Project ACE

테니스 영상을 넣으면 편집된 영상과 학습 자료가 나온다.
기능 8개. **폴더 하나가 기능 하나다.**

```
경기 영상                                                       상태
  match-rally-detect    랠리를 자동으로 표시한다                  새로 만듦
  match-analysis        타격·스윙·궤적·낙구를 뽑아 리포트로 만든다   됨
  match-edit            포인트 사이 빈 시간을 걷어낸다             반쯤

강의 영상
  lecture-scripter      영상을 대본과 편집 지시서로 바꾼다          됨
  lecture-edit          지시서대로 잘라 완성 영상을 만든다          됨
  lecture-infographic   대본과 프레임에서 도해를 만든다             됨
  lecture-material      수강생용 수업 전/후 자료를 만든다           됨
  lecture-shortform     레슨에서 세로 클립을 뽑는다                데모만
```

## 두 도메인은 코드를 공유하지 않는다

```
경기   CV — 선수 포즈 · 공 검출 · 코트 좌표계        ultralytics · opencv
강의   텍스트 — 전사 · 대본 · LLM                  whisper · Claude API
```

환경이 다르고 겹치는 코드가 없다. **한 세션에서 같이 돌리지 않는다.**

## 강의 쪽 네 기능이 이어지는 순서

```
lecture-scripter  ─ directive.json ─→  lecture-edit  ─ 완성 영상 ─→  lecture-material
                                                                        ↑
                                              lecture-infographic ─ 도해 ┘
```

이음선이 `directive.json` 하나다. **판단은 scripter 에서 끝나고, 뒤는 실행만 한다.**

## 폴더 안 구조

```
<기능>/
  README.md    무엇인지 · 어떻게 · 상태 · 다음 할 일
  src/         코드
  output/      산출물 (증거)
```

## 원본 영상

`media/` 에 둔다. 용량이 커서 기능 폴더에 넣지 않는다.
기존 실험 폴더는 `_archive/` 참고.
