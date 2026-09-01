# Bundled models

## yolov8n.onnx
Person detector for in-app player tracking (Phase 2). Exported from Ultralytics
`yolov8n.pt` (COCO, class 0 = person) to ONNX opset 12, fixed 640×640 input:

```bash
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx', opset=12, imgsz=640, dynamic=False, simplify=False)"
```

Run in the Electron main process via `onnxruntime-node` — CoreML (macOS) / DirectML
(Windows) execution provider with a CPU fallback. Output: `[1, 84, 8400]`
(4 bbox + 80 class scores per anchor). Decoding + NMS live in `electron/ml/detector.cjs`.

Committed to the repo so packaging (incl. CI) is self-contained — no Python/Ultralytics
needed to build the app. Bundled into the app via electron-builder `extraResources`.
