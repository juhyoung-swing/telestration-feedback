# Project ACE

테니스 영상을 넣으면 편집된 영상과 학습 자료가 나온다.
기능 9개. **폴더 하나가 기능 하나다.**

> **이 저장소는 영상 엔진이다.** 제품정의서가 말하는 Product C 에 해당한다.
> 사용자가 쓰는 앱 셋은 [ace-apps/apps/](../ace-apps/apps/README.md) 에, 사업·제품 결정은
> [ace-apps/docs/](../ace-apps/docs/README.md) 에 있다. 로드맵과 이 저장소의 실측치가 아직 안 맞는
> 지점은 [ace-apps/docs/README.md](../ace-apps/docs/README.md) 의 "문서 사이에 아직 안 맞는 것" 에 적었다.

```
rally-*     플레이 영상 — 낮은 화각 · 폰 거치 · 대부분의 유저가 이렇게 찍는다     상태
  rally-detect          랠리를 자동으로 표시한다                              새로 만듦
  rally-trajectory      샷의 경로를 영상 위에 그린다                           검출률 재측정 필요
  rally-cut             포인트 사이 빈 시간을 걷어낸다                          반쯤

match-*     경기 영상 — 높은 화각 · 코트가 화면 세로의 50% 이상
  match-analysis        타격·스윙·낙구 → 선수 리포트                           됨

video-*     영상 일반 — 종목·장르에 묶이지 않는다
  video-transcribe      전사 + 인물 추적. 사실만.        관찰                 됨
  video-directive       무엇을 어떻게 자를지 확정한다.     판단                 됨
  video-edit            지시서대로 잘라 완성 영상.        실행                 됨

lecture-*   강의 전용 — 가르치는 영상에서만 성립한다
  lecture-summary       수업 전/후 자료 (도해 포함)                            됨
  lecture-shortform     티칭 포인트를 세로 클립으로                            데모만
```

## 관찰 · 판단 · 실행 세 층

`video-*` 가 셋으로 나뉘는 이유는 **판단만 목적에 묶이기 때문**이다.

```
video-transcribe   관찰   사실만. 목적과 무관.        모든 기능의 원재료
video-directive    판단   목적이 들어간다.            여기서 강의냐 마케팅이냐가 갈린다
video-edit         실행   기계적으로. 새 판단 없음.
```

**같은 영상이 강의도 되고 마케팅 릴도 되는 건 판단 층에서 갈린다.**
그래서 판단은 폴더가 아니라 `video-directive/rules/` 로 갈아끼운다.
관찰과 실행은 중립이라 그대로 재사용한다.

### transcribe 가 fan-out 지점이다

```
                     ┌─→ video-directive     전사 + 대본으로 지시서를 만든다
video-transcribe ────┼─→ lecture-summary     subject_track 으로 크롭을 맞춘다
                     └─→ lecture-shortform   전사로 구간을 고르고 인물을 따라간다
```

`lecture-summary` 는 **완성 영상이 아니라 대본과 전사를 먹는다.** `student_pages.py` 가
`subject_track.json` 을 직접 읽고, 유닛 경계·축 문장·도해의 근거는 전부
`edited_script.md` 에서 나왔다. **편집을 안 해도 자료는 만들 수 있다.**

랠리 쪽도 같은 모양이다.

```
rally-detect ─ rallies.json ─→ rally-cut
render_any.py 검출 캐시 ─→ rally-trajectory · match-analysis      (공용 입력)
```

## 접두어가 나누는 기준

```
rally / match   무엇을 찍었나 + 촬영 조건이 무엇을 허락하나
video           영상을 어떻게 만드나
lecture         배우는 사람에게 무엇을 주나
```

### rally ↔ match — 코트 좌표계가 성립하는가

```
낮은 화각      코트가 화면 세로의 13%   재투영 오차 92.8 cm   코트 좌표 불가
높은 화각      54 ~ 70%                5.1 ~ 6.7 cm         코트 좌표 가능
```

| | 필요한 것 | 낮은 화각 |
|---|---|---|
| 랠리 경계 | 선수 포즈만 | **된다** |
| 궤적선 (화면 좌표) | 공 검출 | **된다** — 단 검출률 미측정 |
| 낙구 · 인아웃 · 속도 · 코트맵 | 코트 좌표 변환 | **안 된다** |

### video ↔ lecture — 종목에 묶이나

`video-*` 안에 테니스도 강의도 없다.

```
s1  whisper 전사 + 인물 추적      어떤 영상이든
s2  대본 매칭 → 지시서            대본이 있는 영상이면
s3  무음 압축                    어떤 영상이든
s4  물리적 컷                    어떤 영상이든
s6  자막 · CG · 효과음            어떤 영상이든
```

강의 특유의 것은 **"무음 ≠ 삭제, 시범 동작 보호"** 하나인데 그건 지시서에 들어가는
**규칙**이다. 기계가 아니라 판단이다.

`lecture-*` 는 다르다. 유닛 · 오답↔정답 대조 · 체크리스트 · 티칭 포인트 선별은
가르치는 영상에서만 성립한다.

> **`video-*` 는 아직 테니스 강의 하나로만 검증했다.**
> 이름은 의도이고, 다른 장르에서 되는지는 재본 적이 없다.

## 왜 나누고 왜 안 나누나

**directive 와 edit 은 나눈다 — 소비자가 다르다.**

```
video-directive  →  사람 편집자가 읽는다 (script.html)   "대본만 넘기면 외주가 돌아가나"
video-edit       →  시청자가 본다 (완성 영상)
```

**transcribe 를 떼는 이유 — 판단 밖에서도 쓰인다.**
전사와 `subject_track.json` 을 지금 셋이 먹는다. 편집 지시서 없이도 쓰이는
원재료라 판단 계층 안에 두면 안 된다.

**도해는 안 나눈다 — 부품이다.**
파는 물건이 아니라 수업 전 페이지에 들어가는 재료다. `lecture-summary/src/diagram/`.

**숏폼은 목적별로 나눈다 — 판단이 다르다.**
포맷(9:16 · 자막 · 20~25초)은 같고 무엇을 고르냐가 다르다.

## 아직 폴더가 없는 것

**코드도 계획도 없으면 폴더를 만들지 않는다.** 빈 껍데기는 구조를 흐린다.

```
rally-highlight    잘한 랠리만 모은 숏폼      입력이 랠리 JSON — rally 쪽
세로 리프레임 공용화   현재 중앙 고정 크롭       두 번째 사용자가 생길 때 뺀다
```

**마케팅 숏폼은 폴더가 아니라 규칙 파일이다.** `video-directive/rules/marketing.json`.
포맷도 판단 기계도 같고 규칙만 다르다.

## 지금 알려진 구조적 부채

**판단 규칙 R1~R7이 `trim_script.py` 에 하드코딩돼 있다.**
`prompts/` 를 만들어놓고 비워 뒀다. 지금 구조로는 목적을 갈아끼울 수 없다 —
같은 영상으로 마케팅 지시서를 만들 수 없다.

7개 중 5개는 이미 목적 중립이다. 뺄 것은 R3(챕터 카드 전제)·R5(용어집 의존)와
임계값 몇 개뿐이라 큰 작업은 아니다. 아직 안 했다.

## 폴더 안 구조

```
<기능>/
  README.md    무엇인지 · 어떻게 · 상태 · 다음 할 일
  src/         코드
  output/      산출물 (증거)
```

## 환경

```bash
uv venv --python 3.12 .venv
VIRTUAL_ENV=$PWD/.venv uv pip install -r requirements.txt
```

**경기(CV)와 강의(전사) 두 스택을 한 환경에 합쳤다.** 예전엔 폴더마다 `.venv` 가
따로 있어서 스크립트마다 다른 파이썬을 써야 했다.

전사는 `mlx-whisper`(애플실리콘용)다. `openai-whisper` 가 아니다.

## 실행 방법이 두 갈래다

```
강의 쪽 (video-* · lecture-*)     ace-project 루트에서 실행
  python lecture-summary/src/student_pages.py

경기 쪽 (rally-* · match-*)       cvwork 에서 실행
  cd cvwork && python ../rally-cut/src/rally_scan_px.py match_f 300 60
```

`rally-*` · `match-*` 스크립트는 `input/` · `output/` · `models/` · `kp_*.json` 을
**cwd 기준 상대경로**로 찾는다. 연구용으로 그렇게 쓰였고 고치지 않았다.
대신 `cvwork/` 이 그 작업 디렉터리다.

```
cvwork/
  input   → ../media/match   심볼릭 링크
  models  → ../models        심볼릭 링크
  *.pt                       bare 이름으로 찾는 가중치 링크
  kp_match_*.json            코트 키포인트 (영상별 보정 데이터)
  output/                    CV 작업 산출물 — 검출 캐시 · 오버레이 · 리포트
```

`runs/` 가 강의 쪽 작업 디렉터리라면 `cvwork/output/` 이 경기 쪽 대응물이다.

## 데이터는 루트에 모인다

**코드는 기능별로 나뉘고 데이터는 한곳에 모인다.** 이게 모순이 아닌 이유는
단계끼리 서로를 import 하지 않고 **파일로 대화**하기 때문이다.

```
raw/          파이프라인 입력 클립 (c01_01~07)
edited/       사람 편집본 참조 — 지시서 평가의 정답지
runs/<id>/    강의 쪽 단계별 산출물. 단계 간 인터페이스
media/match/  경기 영상 7개 + 코트 키포인트
media/        숏폼 레슨 원본
models/       가중치 — yolov8n/x · yolo5_last · keypoints_model
cvwork/       경기 쪽 작업 디렉터리
glossary/     용어 사전 + 전사 오류 교정 규칙
assets/       cg · footage · lut · sfx 소재
```

제품 쪽은 저장소 최상단의 `ace-apps/` 로 갈라져 나갔다. 서로 참조하지 않는다.

```
../ace-apps/docs/    사업 로드맵 · 제품정의서 · MVP 기획서 · 리서치 · 온보딩
../ace-apps/apps/    관리자 웹 · 코치 앱. 아직 코드 없음
```

### glossary 는 한 파일로 두 곳에서 쓴다

```
glossary.md              용어 목록 — s1 Whisper --initial-prompt 에 주입해 오인식 예방
                                    s2 지시서 meta.glossary 에 그대로 들어간다
glossary/corrections.json 전사 오류 교정 — 소리는 손대지 않고 문서·자막 표기만 고친다
```

**판단 규칙 R5(내용어가 있으면 문장을 안 버린다)가 이 사전에 의존한다.**
종목이 바뀌면 여기를 갈면 된다.

폴더 간 `import` 가 한 건도 없다. 폴더를 어떻게 나눠도 코드가 끊기지 않는 이유다.

## 이름 체계가 둘이다 — 의도한 것

```
폴더    기능 좌표계     video-transcribe · video-directive · video-edit
runs/   단계 좌표계     s1_… · s2_… · s3_… · s4_… · s6_…
```

`video-directive/` 를 열면 안에 `s2_storyline_and_directive/` 가 있다.
**단계 번호는 실행 순서라는 다른 정보라서 남겼다.**

| 폴더 | 단계 | 역할 |
|---|---|---|
| `video-transcribe` | s1 | 관찰 — 전사 · 인물 추적 |
| `video-directive` | s2 | 판단 — 지시서 · 대본 |
| `video-edit` | s3 s4 s5 s6 | 실행 — 린트 · 물리적 컷 · 자막·CG |
| `lecture-summary` | s7 | 수업 전/후 자료 |

## 지금 가장 급한 두 가지 — 둘 다 측정이다

```
1  정답 라벨을 찍는다     rally-cut/output/labeling.html
   랠리 검출 성능을 한 번도 측정한 적이 없다. 이게 없으면 개선을 판정할 수 없다.

2  match_c 로 공 검출률을 잰다
   rally-trajectory 가 폴더로 존재할 가치가 있는지가 이 숫자에 걸려 있다.
```

## 원본 영상

`media/` 에 둔다. 기존 실험 폴더는 `_archive/` 참고.

## 실행 확인 (2026-08-18)

폴더를 나누고 데이터를 옮긴 뒤 전부 돌려봤다.

```
강의
  video-directive   script_doc · edited_script · trim_script · eval_cuts · diff_human   ✓
  video-edit        s3 tighten · s4 cut · s6 build_assets · s4 verify                   ✓
  lecture-summary   student_pages · bundle_page · summary_html · unit_page · render     ✓

경기
  rally-cut         rally_scan_px       ✓  match_f 결과가 이동 전과 정확히 일치
  rally-trajectory  render_overlay_v4   ✓
  match-analysis    analyze · rally_map · make_review · make_kp_editor   ✓
```

### 이번에 고친 실제 버그 셋

**1. `render.py` 가 8분 러닝에서 원래 안 됐다.**
블록 128개마다 `if()` 를 겹쳐 라우드니스 식을 만드는데, ffmpeg 식 평가기가 터졌다.
`runs/002/` 에만 `master.mp4` 가 없었던 이유다(v2·v3·v4 짧은 클립에는 있었다).
게인이 같은 인접 구간을 합치도록 고쳤다 — 128개가 1개로 합쳐진다.

**2. `runs/` 안 concat 파일 15개에 옛 절대경로가 박혀 있었다.**
`overlay.txt` · `concat.txt` 는 ffmpeg concat 형식이라 절대경로를 그대로 쓴다.
일괄 치환했다.

**3. OpenCV 가 만든 영상 23개를 브라우저가 재생하지 못했다.**
`cv2.VideoWriter` 는 `mp4v`(MPEG-4 Part 2)만 안정적으로 쓰는데, Chrome·Safari 는
HTML5 video 로 그 코덱을 재생하지 않는다. **QuickTime 에서는 열려서 눈치채기 어렵다.**
`VideoWriter` 를 쓰는 8곳 전부에 `_h264()` 를 붙여 다 쓴 뒤 h264 로 갈아끼운다.

### 안 돌린 것

```
s1 audio/transcribe.py     Whisper 재전사 — 기존 전사를 덮어쓰므로 안 돌렸다
s1 visual/subject_track.py YOLO 7클립 재추론 — 같은 이유
crosscheck.py              옛 런(001) 스키마용. transcript.json 을 찾는데 저장소에 없다
```
