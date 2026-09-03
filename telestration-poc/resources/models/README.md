# Bundled models

Person detector for in-app player tracking (Phase 2). The `.onnx` files are
**gitignored** (yolov8x is ~273MB) — they're generated locally and bundled into
the app by electron-builder `extraResources`. Regenerate with Ultralytics
(auto-downloads the `.pt` weights):

```bash
# default (best quality — matches the original web pipeline's yolov8x)
python -c "from ultralytics import YOLO; YOLO('yolov8x.pt').export(format='onnx', opset=12, imgsz=640, dynamic=False, simplify=False)"
mv yolov8x.onnx resources/models/

# lighter/faster alternative (smaller, lower accuracy)
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx', opset=12, imgsz=640, dynamic=False, simplify=False)"
mv yolov8n.onnx resources/models/

# pose / keypoints for 자세(폼) 분석 — REQUIRED for the form-tracking feature
python -c "from ultralytics import YOLO; YOLO('yolov8n-pose.pt').export(format='onnx', opset=12, imgsz=640, dynamic=False, simplify=False)"
mv yolov8n-pose.onnx resources/models/
```

Models are chosen in `electron/main.cjs` (`mlPaths()`):
- **yolov8x.onnx** — person detection (position analysis). Output `[1, 84, 8400]`
  (4 bbox + 80 class scores); decode + NMS in `electron/ml/detector.cjs`.
- **yolov8n-pose.onnx** — 17 COCO keypoints (form analysis). Output `[1, 56, 8400]`
  (4 bbox + 1 conf + 17×3 keypoints); decode in `electron/ml/pose.cjs`.

Both run via `onnxruntime-node` (CoreML on macOS / DirectML on Windows / CPU fallback).

> CI note: a GitHub Actions build must run the export step above (needs
> `pip install ultralytics`) before `electron-builder`, since the models aren't in git.
