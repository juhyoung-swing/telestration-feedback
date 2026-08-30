# Tennis Telestration POC

고정 카메라 테니스 영상 위에, **코트 좌표(미터)로 정의한 그래픽**을 **수동 4점 캘리브레이션**으로 만든
호모그래피에 통과시켜 그리는 최소 프로토타입.

> 개념 참조: *SportsBuddy* (IEEE PacificVis 2025, arXiv:2502.08621) §4.2.2 "Canvas-based Video Rendering".
> 논문은 바닥 효과(Circle/Area)에 변환행렬을 적용하되 **고정 행렬**이라 카메라가 움직이면 어긋나는 한계를 둔다.
> 우리 케이스는 **카메라가 고정**이라 그 한계가 발생하지 않으므로, **한 번 만든 H를 영상 전체에 재사용**한다.

증명하려는 단 하나: **"헤일로와 커버리지 존이 영상이 재생되는 내내 코트 바닥에 칠해진 것처럼 붙어 있다."**

## 실행

```bash
npm install
npm run verify   # 브라우저 없이 호모그래피 기하 검증
npm run dev      # http://localhost:5173
```

기본 영상(`public/court.mp4`, 4K 마스터에서 뽑은 25s·1080p 클립)이 자동 로드된다.
`*.mp4`는 저장소 `.gitignore` 대상이라 커밋되지 않는다 — 로컬에서만 쓴다.

## 사용 순서

1. 영상을 원하는 프레임에서 **일시정지**.
2. 캘리브레이션 (둘 중 하나):
   - **모서리 4점** → 더블스 베이스라인 모서리를 순서대로 클릭:
     `① 먼 왼쪽 → ② 먼 오른쪽 → ③ 가까운 오른쪽 → ④ 가까운 왼쪽`.
   - **선으로 캘리브레이션** → 코트 선을 골라 그 선 위를 2점 이상 클릭. **끝점(코너)은 안 찍어도 됨** —
     선의 교차로 코너가 계산되므로 **코너가 화면 밖이어도** 됩니다. 가로·세로 각 2개 이상, 많이 그릴수록 정확(최소자승).
3. **코트 그리드** 켜기 → 초록/빨강 라인이 실제 코트 라인과 겹치면 캘리브레이션 성공.
4. **＋ 그라운드 헤일로** → 코트를 클릭해 노란 헤일로 배치(여러 개 가능).
5. **＋ 커버리지 존** → 3점 이상 클릭 후 **완료** → 남색 폴리곤.
6. **재생** → 두 그래픽이 코트 바닥에 붙은 채 유지.

### 캘리브레이션 두 방식

| | 모서리 4점 | 선(line) |
|---|---|---|
| 입력 | 더블스 모서리 4개 클릭 | 코트 선 4개+ 위 2점씩 |
| 코너 화면 밖 | 불가 | **가능**(교차로 복구) |
| 가림/노이즈 | 약함 | **강함**(선 피팅·최소자승) |
| 코어 | `getPerspectiveTransform` | `homographyFromLines` ([lineCalib.ts](src/geometry/lineCalib.ts)) |

원리: 점은 `x'=H·x`, **선은 `l'=H⁻ᵀ·l`** 로 변환되므로 선 대응만으로 H를 구할 수 있고, 코너는 선의 교차점(화면 밖이어도 계산됨)입니다.

## 좌표계 (섞지 말 것)

| 공간 | 단위 | 어디서 | 변환 |
|---|---|---|---|
| ① DOM/CSS | 화면 px | 마우스 클릭 | `coords.ts` (리사이즈 시 스케일만 갱신) |
| ② 비디오 고유 | intrinsic px (`videoWidth×Height`) | **H가 사는 곳** | — |
| ③ 코트 | 미터 (0,0)–(10.97,23.77) | **진실(authoritative)** | `H` / `H⁻¹` (`homography.ts`) |

- **코트 좌표가 진실, 화면 좌표는 파생.** 투영된 픽셀을 상태로 저장하지 않는다.
- **H는 ② 고유 픽셀에서 동작.** 리사이즈해도 H는 재계산하지 않고, ①⇄② 스케일만 갱신한다.
- 원근 왜곡은 **court-space 원/폴리곤을 점으로 쪼개 각 점을 H로 투영**해서 나온다. Konva는 그 폴리곤을 그릴 뿐.

## 구조

```
src/
  geometry/
    homography.ts   getPerspectiveTransform(4점 정확 solver) · invert3x3 · project/unproject · circleInCourt
    lineCalib.ts    선-기반 호모그래피(homographyFromLines, 최소자승) · 선 피팅 · 교차 · Jacobi 고유해
    court.ts        코트 치수 · COURT_CORNERS · courtLines(디버그)
    coords.ts       video ⇄ display 스케일 (①⇄②)
  components/
    VideoStage.tsx  <video> + Konva Stage(고유좌표+스케일), 클릭→video좌표
    Toolbar.tsx
    overlays/       GroundHalo · CoverageZone · CourtGrid · CalibrationPoints
  types.ts          CourtCalibration · GroundHalo · CoverageZone
scripts/verify.ts   기하 유닛 검증
```

## 다음 단계 (이 POC 밖)

- `GroundHalo`는 이미 `courtX/courtY` prop을 받는다 → YOLO/트래킹의 **발 접점 → H⁻¹ → 코트좌표**를 그대로 흘려넣으면 선수를 따라다닌다.
- 호모그래피는 OpenCV.js `getPerspectiveTransform`으로 **한 함수 교체**만 하면 대체 가능(현재는 무의존 정확 solver).
