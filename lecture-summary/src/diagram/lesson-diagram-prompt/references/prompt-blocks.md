# 영문 프롬프트 블록

참조 프레임을 첨부하고 아래 텍스트를 붙인다. 블록 순서를 지킨다 —
모델은 앞에 나온 지시를 뒤의 것보다 강하게 잡는다.

```
1. 무엇을 만드는지 · 형식 선언
2. POSE REFERENCE 고정        ← 참조를 따르라는 지시
3. THE FIGURE                 ← 인물 규격. 시리즈 전체가 같은 문장을 쓴다
4. THE POSE / THE MOMENT      ← 자세를 말로 다시 한 번
5. WHAT TO ADD                ← 노랑으로 그릴 보이지 않는 것
   WHAT TO CHANGE FROM THE PHOTO   ← 사진에서 바꿀 것 (필요할 때만)
6. STYLE                      ← 라인아트 규격
```

`THE FIGURE` 가 `POSE REFERENCE` 바로 뒤에 오는 게 중요하다.
앞에서 "참조를 따르라" 고 해 놓고 바로 뒤에서 "단 생김새는 빼고" 를 말해야
모델이 두 지시를 하나로 묶어 읽는다.

---

## 1. 형식 선언

```
Use the attached photograph as POSE REFERENCE for a clean instructional line-art
illustration on a tennis lesson page. A single figure, front view, no comparison panel.
```

첫 문장에서 **결과물이 무엇인지** 를 못 박는다. `instructional line-art illustration`.
`no comparison panel` 을 빼면 좌우 2컷을 자주 만들어 낸다.

## 2. POSE REFERENCE 고정

```
Match the body position, arm angle, and racket position in the reference photo.
Do not substitute a generic tennis pose — the value of this drawing is that it shows
this coach's actual position. Simplify everything else away.
```

**무엇을 맞출지 나열한다.** 유닛마다 다르다.

```
시선    body position, shoulder angle, head direction, and racket position
골반    body position, hip and shoulder angle, foot position, and racket position
피니시   body position, arm angle, and racket position
드릴    kneeling position, leg angles, torso rotation, and arm position
```

`Do not substitute a generic pose` 문장이 없으면 교과서 자세가 나온다.
**왜** 참조를 따라야 하는지(`the value of this drawing is that…`)까지 적으면
모델이 애매한 부분에서 참조 쪽으로 기운다.

`Simplify everything else away` 가 배경·소품 제거의 근거가 된다.

## 3. THE FIGURE — 시리즈 전체가 토씨까지 같은 블록을 쓴다

**참조 프레임은 자세만 준다. 생김새까지 주면 도해마다 다른 사람이 된다.**

코치는 촬영일마다 다른 옷을 입는다. 이 블록이 없으면 줄무늬 폴로에 초록 반바지를
그대로 그리고, 다른 도해는 다른 옷이 되어 넷이 남남처럼 보인다.
`Faceless: draw the head outline and hair shape` 만 쓰면 **대머리**로 나온다.

```
THE FIGURE — the same person appears in every diagram of this series
Take ONLY the body position from the reference photo. Ignore what the person in the
photo is wearing and what they look like. That changes from shot to shot and these
drawings must not.
  - Adult male, slim build, normal proportions, about 7.5 heads tall.
  - Short dark hair drawn as a simple outlined shape sitting on the skull, with two
    or three strand lines inside it. The head is NOT bald and NOT shaved.
  - No face at all: no eyes, nose, mouth, ears, or eyebrows. Leave the face blank.
  - Plain short-sleeve crew-neck T-shirt and plain knee-length shorts. No stripes,
    no pattern, no collar, no buttons, no pockets, no logos.
  - Ankle socks and plain low-top sneakers, outlined only.
  - Every part of the figure is navy #17335F outline on white. There are NO color
    fills anywhere on the body or the clothing — shirt, shorts, socks and shoes are
    all white inside. The only filled shapes in the image are the yellow ones below.
  - Uniform line weight throughout, roughly 3px at 1400px wide, with rounded ends.
```

줄마다 이유가 있다.

| 줄 | 없으면 |
|---|---|
| `Ignore what the person is wearing` | 참조 사진의 옷을 그대로 그린다 |
| `NOT bald and NOT shaved` | 대머리가 나온다. `hair shape` 만으로는 부족하다 |
| `No stripes, no pattern, no collar` | 줄무늬 폴로가 나온다. 뺄 것을 열거해야 뺀다 |
| `NO color fills anywhere` | 반바지에 색이 채워진다 |
| `about 7.5 heads tall` | 머리가 크고 몸이 뭉툭한 캐릭터가 나온다 |
| `Uniform line weight … rounded ends` | 도해마다 선 굵기가 달라 나란히 놓으면 티가 난다 |

**종목이 바뀌면 이 블록만 갈면 된다.** 옷·신발만 종목에 맞추고 나머지는 그대로 둔다.

## 4. THE POSE / THE MOMENT

참조를 붙였는데도 자세를 말로 다시 쓴다. 사진이 애매한 부분을 문장이 잡아 준다.

**화면 기준으로 쓴다.** `앞`, `위쪽` 같은 말은 기준이 없다.
`seen from the front`, `toward the viewer`, `away from the camera` 처럼 쓴다.

```
THE POSE
A right-handed player who has just completed a unit turn, seen from the front.
The shoulders are turned away from the camera, not square to it. The head is turned
to look sideways at the oncoming ball. The racket is back, prepared.
```

**주장이 걸린 곳은 대문자로 강조한다.**

```
The right upper arm is held clearly AWAY from the ribcage, leaving an open gap
between the chest and the inside of the upper arm.
```

시간이 걸린 자세는 `THE MOMENT` 로 바꿔 쓰고, **무엇과 무엇 사이의 간격**이
주제라는 걸 명시한다.

```
THE MOMENT
A right-handed player mid-forehand, caught at the instant the hips have already
rotated open toward the viewer while the racket is still back behind the body.
This gap between the opened hips and the trailing racket is the subject of the drawing.
```

## 5. WHAT TO ADD

노랑으로 그릴 것. **위치·크기·시작점·끝점**을 다 적는다.

```
WHAT TO ADD
  - A tennis ball, drawn as a small solid navy circle, out to the side of the player
    on the side the head is facing, at about waist height, clearly away from the body.
  - A yellow #E4EF3D arrow starting at the player's head and running in a straight
    line to that ball. This is the line of sight.
  - A yellow open circle around the ball, the size of a racket face, marking the
    contact zone. The gaze arrow ends inside it.

The arrow and the circle read as one continuous thing: where the eyes go is where
the ball is met. Nothing else is yellow.
```

마지막 두 문장이 중요하다.
- **읽히는 뜻**을 한 줄로 적는다. 모델이 요소를 배치할 때 이 문장을 기준으로 삼는다
- `Nothing else is yellow.` 로 노랑을 잠근다

선 스타일로 시간을 표현할 때는 **무엇이 무엇을 뜻하는지** 를 붙인다.

```
  - A thick SOLID curved arrow wrapping around the hips, showing the rotation that
    has already happened.
  - A thin DASHED curved arc running from the racket head forward and up along the
    path the racket will travel next.

Solid means already moved. Dashed means still to come. Read together they say:
the hips went first, the racket follows.
```

## 5b. WHAT TO CHANGE FROM THE PHOTO

사진에 있는데 그리면 안 되는 것. **빼라고만 하면 안 되고 무엇으로 바꿀지 준다.**

```
WHAT TO CHANGE FROM THE PHOTO
The reference shows a real basketball wedged in that gap. Do NOT draw the basketball.
Replace it with a flat yellow #E4EF3D circle in exactly the same position and the
same size — 40% opacity fill with a solid yellow outline, no seams, no texture,
no shading. It reads as an empty space marked out, not as an object being held.
This circle is the only yellow in the image.
```

`no seams, no texture, no shading` 이 없으면 노란 농구공이 나온다.
`It reads as …, not as …` 로 오독 방향을 미리 막는다.

## 6. STYLE

거의 그대로 재사용한다.

```
STYLE
Flat vector line art. Not a photo, not a 3D render. No shading, no gradients.
Pure white background — remove the court, fence, wall, banner, floor markings.
No wristwatch, no wristband, no microphone, no logos.
Navy #17335F for all line work. Yellow #E4EF3D only for <노랑으로 그린 것>.
NO text, letters, numbers, or labels anywhere.
Full body, centered, standing on a thin horizontal navy baseline.
16:9 landscape.
```

각 줄의 이유:

| 줄 | 왜 |
|---|---|
| `Not a photo, not a 3D render` | `line art` 만으로는 렌더 이미지가 자주 나온다 |
| `Pure white background — remove …` | 지울 것을 열거해야 실제로 지운다 |
| `No wristwatch, no microphone, no logos` | 참조 사진에 있으면 그대로 따라 그린다 |
| `NO text, letters, numbers, or labels` | 라벨을 넣으면 거의 항상 깨진 글자가 나온다. 설명은 페이지의 캡션이 한다 |
| `thin horizontal navy baseline` | 인물이 허공에 뜬 것처럼 보이는 걸 막는다 |
| `16:9 landscape` | 페이지 카드 폭에 맞춘다. 세로로 나오면 잘라야 한다 |

---

## 통 템플릿

`<>` 안을 채운다.

```
Use the attached photograph as POSE REFERENCE for a clean instructional line-art
illustration on a <종목> lesson page. A single figure, front view, no comparison panel.

Match the <맞출 것 나열> in the reference photo.
Do not substitute a generic <종목> pose — the value of this drawing is that it shows
this coach's actual position. Simplify everything else away.

<위 3번의 THE FIGURE 블록을 토씨 그대로 붙인다>

THE POSE
<한 문장으로 이 순간이 무엇인지, 정면에서 본 것으로>
  - <부위 1이 어떻게 되어 있는지>
  - <부위 2>
  - <주장이 걸린 부위 — 대문자로 강조>

WHAT TO ADD — <개수>, yellow #E4EF3D
  - <노랑 요소: 모양 · 위치 · 크기 · 시작점 · 끝점>

<이 요소가 읽히는 뜻 한 줄>. Nothing else is yellow.

STYLE
Flat vector line art. Not a photo, not a 3D render. No shading, no gradients.
Pure white background — remove the court, fence, wall, banner, floor markings.
No wristwatch, no wristband, no microphone, no logos.
Navy #17335F for all line work. Yellow #E4EF3D only for <노랑 요소>.
NO text, letters, numbers, or labels anywhere.
Full body, centered, standing on a thin horizontal navy baseline.
16:9 landscape.
```
