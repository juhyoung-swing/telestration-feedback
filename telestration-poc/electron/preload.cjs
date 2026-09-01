// Preload runs with contextIsolation enabled. No privileged APIs are exposed
// yet — Phase 2 will add a small contextBridge IPC surface here for local ML
// (ONNX YOLOv8 detection + ffmpeg frame extraction) running in the main process.
