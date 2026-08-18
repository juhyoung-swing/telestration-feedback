# 강의 영상 편집

`directive.json` 을 받아 실제로 잘라 완성 영상을 만든다.
**판단하지 않는다. 실행만 한다.**

## 나온 것

```
raw/c01_01 ~ c01_07  (7클립)
  → lecture_forehand.webm   8분 3초
```

말이 끊기지 않고, 대본 순서대로 이어지고, 시범 동작이 살아 있다.

## 네 단계

```
src/s3_rough_cut_lint/         지시서 다듬기 — 무음 구간 압축, 규칙 검사
src/s4_aroll_cut/              물리적 컷. 파이프라인 전체에서 여기서 단 한 번 일어난다
src/s5_broll_overlay/          비어 있음 — s6 가 대신하고 있다
src/s6_assets_subtitle_cg_sfx/ 자막 · CG · 효과음
```

## 알아둘 것

**s5 가 비어 있다.** 7단계 설계인데 실제로는 6단계로 돌아간다.
B롤 오버레이를 s6 가 하고 있어서 기능은 문제없지만 설계 문서와 어긋난다.

**ffmpeg 빌드에 libass/freetype 이 없다.** 자막을 Pillow 로 PNG를 그려서
`overlay` 필터 하나로 얹는다. `crop` 에 `eval` 옵션이 없어서 줌은 구간을
나눠 붙이는 방식으로 한다.

**afade 를 coarse-seek 한 입력에 걸면 구간 끝이 묵음이 된다.** raw PCM 을 뽑아
파이썬에서 페이드를 준다.

## 실행

```bash
python src/s3_rough_cut_lint/tighten.py
python src/s4_aroll_cut/cut.py
python src/s4_aroll_cut/verify.py        # 말 끊김 · 대본 순서 검사
python src/s6_assets_subtitle_cg_sfx/build_assets.py
```

## output

```
lecture_forehand.sheet.md          컷 시트
lecture_forehand.composition.json  구성
lecture_forehand.analysis.json     분석
```

완성 영상은 용량이 커서 `../_archive/exp4-pipeline/edited/` 에 둔다.
