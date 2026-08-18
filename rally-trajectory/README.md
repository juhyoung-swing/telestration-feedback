# 궤적선

샷마다 공이 지나간 경로를 영상 위에 그린다.
플레이스먼트·깊이·페이스를 눈으로 본다.

**화면 좌표에만 그린다.** 코트 좌표 변환을 쓰지 않으므로 낮은 화각에서도 성립한다.

## 왜 화면 좌표인가

`render_overlay_v4.py` 가 그 결론이다. v3까지는 코트 좌표를 썼는데 실패했다.

```
공중의 공은 바닥 평면에 투영하면 크게 어긋난다.
선수 귀속이 P2로 쏠렸다 — 5 vs 13.
→ v4에서 '화면상 공-선수 거리' 로 교체
→ 스트로크 속도도 바닥 평면 대신 '선수 키(1.75m)' 를 자로 사용
```

**이미 호모그래피를 버린 코드다.** 낮은 화각으로 가는 데 고칠 게 적다.

## 재보지 않은 것 — 여기가 이 기능의 존폐다

**낮은 화각에서 공 검출률을 측정한 적이 없다.**

```
높은 화각   71%    match_b · 2.33 Mbps
낮은 화각   미측정   match_c · 2.19 Mbps   ← 코트 인식 실패(92.8cm)에서 멈췄다
```

높은 화각 71%도 아슬아슬하다. **타격 순간**에 공이 라켓·몸에 가려져 건너편 선수는
그 순간 52%까지 떨어진다. 낮은 화각에서 더 떨어지면 궤적이 끊겨 선으로 안 보인다.

```
먼저 할 일   match_c 로 공 검출률을 잰다
             선으로 보일 만한 수치가 안 나오면 이 폴더는 접는다
```

## 검출률을 올리는 경로

```
현재   YOLOv5l6u + TTA + 칼만          71% (높은 화각)
       TTA 로 42% → 50% 개선한 기록이 render_overlay_v3.py 에 있다

후보   TrackNetV4                      연속 프레임을 함께 보므로 가려진 순간을
                                        앞뒤로 추론한다. 지금 실패하는 지점이 그 부분이다
       https://github.com/yastrebksv/TennisProject   가중치 공개
```

**비트레이트도 변수다.** 현재 소스가 2.2~2.4 Mbps인데 H.264는 비트가 모자라면
빠르게 움직이는 작은 물체부터 뭉갠다. 20 Mbps 이상 촬영을 권장 조건으로 둘지 판단 필요.

## src

```
render_overlay_v4.py   ★ 화면 좌표 기반. 검출 결과를 detections.pkl 로 캐시
render_overlay_v3.py     TTA 적용 이력 (42% → 50%)
render_overlay_v2.py     이전 버전
render_any.py            검출 캐시 생성
probe_scale.py           imgsz·TTA 파라미터 탐색
```

`render_any.py` 는 `../match-analysis` 도 쓴다. **검출 캐시는 두 기능의 공용 입력이다.**

## output

```
ball_trajectory.png            타격 사이 공의 화면상 궤적
ball_detection_timeline.png    검출 성공/실패 타임라인
court_keypoints_fail.jpg       낮은 화각에서 코트 인식이 실패한 증거 (match_c)
```

## 실행

```bash
python src/render_overlay_v4.py 300 30           # 300초부터 30초
python src/render_overlay_v4.py 300 30 --rerun   # 캐시 무시하고 재검출
```
