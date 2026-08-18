"""코트 키포인트 모델을 우리 영상에 걸어본다. SPEC §3 A-3 (③ 근거).

tennis_analysis의 court_line_detector 전처리를 재현:
  224x224 리사이즈 -> ImageNet 정규화 -> ResNet50 -> 28개 출력(=14점 x,y)
  좌표는 224 기준이므로 원본 해상도로 되돌린다.
"""
import cv2, sys
import numpy as np
import torch, torchvision
from torchvision import transforms

VIDEO = "input/match_amateur.mp4"
TIMES = [float(t) for t in (sys.argv[1:] or [35, 120, 300])]

model = torchvision.models.resnet50()
model.fc = torch.nn.Linear(model.fc.in_features, 28)
model.load_state_dict(torch.load("models/keypoints_model.pth", map_location="cpu"))
model.eval()

tf = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)

for t in TIMES:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
    ok, frame = cap.read()
    if not ok:
        continue
    H, W = frame.shape[:2]
    with torch.no_grad():
        out = model(tf(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).unsqueeze(0))[0].numpy()
    kp = out.reshape(14, 2) * np.array([W / 224.0, H / 224.0])

    vis = frame.copy()
    inside = 0
    for i, (x, y) in enumerate(kp):
        x, y = int(x), int(y)
        if 0 <= x < W and 0 <= y < H:
            inside += 1
        cv2.circle(vis, (x, y), 7, (0, 0, 255), -1)
        cv2.putText(vis, str(i), (x + 9, y - 9), cv2.FONT_HERSHEY_SIMPLEX,
                    0.8, (0, 0, 255), 2)
    out_p = f"output/screenshots/court_t{int(t)}.jpg"
    cv2.imwrite(out_p, vis)
    print(f"t={t:5.0f}s  화면 안에 들어온 점 {inside}/14  -> {out_p}")
    print("   좌표:", " ".join(f"({int(x)},{int(y)})" for x, y in kp[:6]), "...")
cap.release()
