# 실험 1 — 경기 영상: 플레이 구간·타격 이벤트 검출 검증 (v2)

> Project ACE 기술 검증. **제품 개발이 아니라 조사 실험이다.**
> 코드 품질보다 결과 리포트가 산출물. 과도한 추상화·리팩토링 금지.

## 0. 무엇을 찾는가 (실험의 타깃 정의)

같은 입력 영상에서 아래 3개를 뽑는다. 각각 용도가 다르다.

| # | 타깃 | 스키마 | 용도 |
|---|---|---|---|
| ① | **플레이/데드타임 구간** | `[{"start":초, "end":초}]` | 편집 — 치는 장면만 남긴 영상 |
| ② | **타격 이벤트 시점** | `[{"t":초}]` | 통계 — 샷 카운트, 랠리 길이(구간 내 타격 수), 템포 |
| ③ | **검출 품질 증거** | 공 검출률 %, 선수/코트 검출 스크린샷 | L2/L3(샷분류·속도·인아웃) 가능성 판단 근거 |

- **주 타깃은 ①.** 성공 기준: F1 ≥ 0.8인 트랙이 하나라도 존재.
- ②는 트랙 B의 부산물로 산출 (CV 트랙에서도 가능하면 공 방향 반전 시점으로).
- **공 속도는 이번 실험에서 제외** — ③의 코트 키포인트 결과를 본 뒤 다음 실험으로.

## 1. 입력 (사용자가 준비)

- `input/match_amateur.mp4` — 아마추어 경기 영상 1개. 폰+삼각대, 코트 뒤 펜스 높이, **10분 내외**.
- (선택) `input/match_broadcast.mp4` — 방송 화각 대조군. 아마추어에서 실패 시 "모델 문제 vs 화각 문제" 구분용.
- 파일 없으면 시작하지 말고 요청할 것.

## 2. 환경 — M1 Pro (Apple Silicon) 기준

- Python 3.10+, `ffmpeg`
- 패키지: `ultralytics`, `torch`(MPS 지원 버전), `opencv-python`, `librosa`, `numpy`, `pandas`, `matplotlib`, (Track D용) `open_clip_torch` 또는 `sentence-transformers`, `scikit-learn`
- **MPS 주의사항 (반드시 준수)**
  - ultralytics 추론 시 `device="mps"` 명시. 시작 시 `torch.backends.mps.is_available()` 확인 로그 남길 것.
  - 외부 저장소 코드는 `cuda` 하드코딩이 흔함 → `"cuda"` → `"mps"` 패치. MPS 미지원 연산 에러 시 해당 모델만 CPU 폴백하고 리포트에 기록.
  - 처리량 최적화: 영상 720p 다운스케일 + **3프레임당 1회 추론** (구간 검출엔 충분). 10fps 유효 샘플링이면 됨.
- 10분 영상 예상 처리 시간: Track A 10~30분, B·C·D 수 분. E는 API 대기.

## 3. 실험 설계 — 5개 트랙, 같은 영상, 같은 평가

### Track A — 객체 검출 (CV)

**기반 리포지토리**: https://github.com/abdullahtarek/tennis_analysis (별 853, 포크 265)
- 구조: `trackers/`(공·선수), `court_line_detector/`(코트 키포인트), `mini_court/`(좌표변환), `main.py`(파이프라인), `training/`(**사용 안 함** — 이미 학습된 가중치를 받으므로)
- 학습된 가중치 2개 (README의 Models Used):
  - YOLOv5 공 검출: `https://drive.google.com/file/d/1UZwiG1jkWgce9lNhxJ2L0NVjX1vGM05U/view`
  - 코트 키포인트: `https://drive.google.com/file/d/1QrTOF1ToQ4plsSZbkBs3zOLkVt3MBlta/view`
- **알려진 리스크 (미리 대비할 것)**
  - README requirements가 python 3.8. **3.10으로 올려서 진행**하고 충돌 시 대응.
  - 커밋 2개, 릴리즈 없음 → 유지보수 안 됨. **최신 ultralytics와 API 불일치로 깨질 가능성 높음.** 깨지면 고치려 오래 붙들지 말고 폴백 체인으로 넘어갈 것.
  - `cuda` 하드코딩 예상 → `mps` 패치 필요.

1. clone 후 가중치 2개 다운로드 (`gdown`).
2. **공 검출기 폴백 체인** (앞 것이 실패하거나 검출률 <30%면 다음으로, 전환 사유 기록):
   - a. tennis_analysis 학습 가중치 (YOLOv5, 방송 화각 기준)
   - b. TrackNetV3 공개 구현 (히트맵 방식, 작은 공에 더 강함)
   - c. Roboflow 호스팅 API의 테니스공 모델 (로컬 GPU 불필요, 무료 티어로 샘플 프레임만)
   - d. ultralytics YOLOv8 기본 가중치의 `sports ball` 클래스 (최후 베이스라인)
3. 산출:
   - ③용: 프레임별 공 검출률 타임라인 그래프, 선수 검출 수 타임라인, 코트 키포인트 성공/실패/애매 스크린샷 각 1장
   - ①용: 공 검출 연속 구간(끊김 1.5초 허용, 최소 3초) → `output/trackA_segments.json`
   - ②용(가능하면): 공 x좌표 방향 반전 시점 → `output/trackA_hits.json`

### Track B — 오디오 타격음
1. `ffmpeg` 오디오 추출 → `librosa.onset.onset_detect`
2. ②: onset 시점 목록 → `output/trackB_hits.json`
3. ①: onset 밀도(10초 창 3회 이상) 구간 → `output/trackB_segments.json`
4. onset strength 타임라인 그래프.

### Track C — 모션 (베이스라인)
1. 프레임 차분(다운샘플 절대차 평균) 스코어 타임라인.
2. 임계값 초과 구간 → `output/trackC_segments.json`

### Track D — 프레임 분류 (공을 안 찾는 접근)
1. 5초 간격 프레임 추출 → CLIP 임베딩.
2. 사용자 정답 라벨(§4)의 앞 5분으로 로지스틱 회귀 학습, 뒤 5분으로 평가 (**train/test 분리 엄수**).
3. 프레임 분류 → 구간 병합 → `output/trackD_segments.json`
4. 의미: 라벨링이 박스가 아니라 프레임 단위라 확장이 압도적으로 쌈. L1 전용 정공법 후보.

### Track E — VLM 영상 입력 (Gemini)
1. Gemini API에 영상 업로드, "플레이 구간 타임스탬프를 JSON으로" 프롬프트 1개.
2. `output/trackE_segments.json` + 사용 프롬프트·비용 기록.
3. API 키 없으면 스킵하고 리포트에 표기.

### 참고 기록 (구현하지 않음)
- Apple Vision `VNDetectTrajectoriesRequest`: 포물선 궤적 검출 OS 내장 API. 코치 앱이 iOS일 경우 서버 GPU 비용 0 경로. 리포트 "다음 단계"에 한 줄로만.

## 4. 정답 라벨과 평가

1. **라벨링 도구를 먼저 만든다**: 5초 간격 썸네일 그리드 HTML → 사용자가 플레이/휴식 구간을 표기해 `ground_truth.json`(①과 같은 스키마) 작성. 라벨 수신 전 평가 단계 대기.
2. ① 평가 (5개 트랙 공통):
   - 초 단위 이산화 → 플레이=1/휴식=0 → **precision / recall / F1**
   - **압축률** (결과 길이 ÷ 원본)
   - **끊김 수** (정답 랠리 1개가 여러 조각으로 쪼개진 횟수 — 시청 경험 지표)
3. ② 평가: 사용자가 1분 구간의 타격을 손으로 세어 준 값 vs trackB_hits 개수 오차율.
4. 5트랙 비교표 생성.

## 5. 컷 영상 생성

- 각 트랙 segments → `ffmpeg` concat → `output/cut_trackA.mp4` ~ `cut_trackE.mp4` (앞뒤 1초 패딩).
- 최종 판단은 사람이 보는 것이므로 반드시 생성.

## 6. 산출물

```
output/
  report.md                     ← 아래 구조 준수
  track{A..E}_segments.json
  trackA_hits.json / trackB_hits.json
  cut_track{A..E}.mp4
  fig_ball_detection_timeline.png
  fig_audio_onset.png
  fig_motion_score.png
  screenshots/
  comparison_table.md
  labeling.html                 ← 정답 라벨링 도구
```

### report.md 필수 구조
1. **한 줄 결론** — "아마추어 영상에서 ①은 트랙X로 F1 0.xx, ②는 오차 x%, ③은 검출률 x%"
2. 5트랙 비교표 (F1 / 압축률 / 끊김수 / 처리시간 / 비용)
3. ③ 상세: 공 검출률, 폴백 체인 어디까지 갔는지, 실패 원인 추정 + 근거 스크린샷
4. 비용 외삽: 90분 영상 1건 처리 시간·비용 (트랙별)
5. 다음 단계 3줄: L2로 갈 만한가 / Apple Vision iOS 경로 / 추천 트랙

## 7. 하지 말 것

- 모델 파인튜닝·학습 (Track D의 로지스틱 회귀 제외)
- 샷 분류, 인아웃, 스코어링, **공 속도**
- UI/서비스화
- 파라미터 무한 튜닝 — 기본값 + 1회 조정까지, 조정 내역 기록

## 8. 순서

1. 환경 셋업, MPS 확인 → 라벨링 도구 생성, 사용자에게 정답 요청 (병렬로 진행)
2. Track C → B (가볍고 골격 검증)
3. Track A (폴백 체인) → D → E
4. 라벨 수신 → 평가 → 컷 영상 → 리포트

각 단계 완료 시 중간 결과를 짧게 보고할 것.
