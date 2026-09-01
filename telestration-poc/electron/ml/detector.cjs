// YOLOv8n person detector via onnxruntime-node. Runs in the Electron MAIN
// process (native N-API addon — not the sandboxed renderer). Chooses a GPU
// execution provider (CoreML on macOS, DirectML on Windows) with a CPU
// fallback, so it works on any laptop. Pure CommonJS so it's also runnable /
// testable standalone with plain `node`.
const ort = require('onnxruntime-node');

const INPUT = 640;
const PAD = 114 / 255; // YOLO letterbox gray

// EP name string per platform (onnxruntime-node ships these in the stock prebuilt).
function platformProviders() {
  if (process.platform === 'darwin') return ['coreml'];
  if (process.platform === 'win32') return ['dml'];
  return [];
}

// Create a session, trying GPU EP(s) first then always CPU. Returns a handle.
async function createDetector(modelPath, providerPref = platformProviders()) {
  const tries = [...providerPref.map((p) => [p]), ['cpu']];
  let lastErr;
  for (const eps of tries) {
    try {
      const session = await ort.InferenceSession.create(modelPath, { executionProviders: eps });
      return { session, provider: eps[0], inputName: session.inputNames[0], outputName: session.outputNames[0] };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Letterbox an RGB image (Uint8, length w*h*3) to INPUT×INPUT float32 CHW [0..1].
function preprocess(rgb, w, h, size = INPUT) {
  const ratio = Math.min(size / w, size / h);
  const nw = Math.round(w * ratio), nh = Math.round(h * ratio);
  const padX = Math.floor((size - nw) / 2), padY = Math.floor((size - nh) / 2);
  const plane = size * size;
  const out = new Float32Array(3 * plane).fill(PAD);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor(y / ratio));
    const dyBase = (padY + y) * size + padX;
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / ratio));
      const si = (sy * w + sx) * 3;
      const di = dyBase + x;
      out[di] = rgb[si] / 255;
      out[plane + di] = rgb[si + 1] / 255;
      out[2 * plane + di] = rgb[si + 2] / 255;
    }
  }
  return { data: out, ratio, padX, padY, size };
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]), areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-9);
}

function nms(dets, iouThr) {
  dets.sort((p, q) => q.score - p.score);
  const keep = [];
  for (const d of dets) if (keep.every((k) => iou(k.box, d.box) < iouThr)) keep.push(d);
  return keep;
}

// Decode YOLOv8 output → person boxes in ORIGINAL image coords. Handles both
// [1,84,N] (channels-first) and [1,N,84] output layouts.
function postprocess(output, meta, origW, origH, scoreThr = 0.35, iouThr = 0.5) {
  const { ratio, padX, padY } = meta;
  const data = output.data, dims = output.dims;
  let nc, na, chFirst;
  if (dims[1] === 84) { nc = dims[1]; na = dims[2]; chFirst = true; }
  else { na = dims[1]; nc = dims[2]; chFirst = false; }
  const at = (c, a) => (chFirst ? data[c * na + a] : data[a * nc + c]);
  const dets = [];
  for (let a = 0; a < na; a++) {
    const pScore = at(4, a); // channel 4 = class 0 (person)
    if (pScore < scoreThr) continue;
    const cx = at(0, a), cy = at(1, a), bw = at(2, a), bh = at(3, a);
    let x1 = (cx - bw / 2 - padX) / ratio, y1 = (cy - bh / 2 - padY) / ratio;
    let x2 = (cx + bw / 2 - padX) / ratio, y2 = (cy + bh / 2 - padY) / ratio;
    x1 = Math.max(0, Math.min(origW, x1)); y1 = Math.max(0, Math.min(origH, y1));
    x2 = Math.max(0, Math.min(origW, x2)); y2 = Math.max(0, Math.min(origH, y2));
    if (x2 > x1 && y2 > y1) dets.push({ box: [x1, y1, x2, y2], score: pScore });
  }
  return nms(dets, iouThr);
}

// One-shot: RGB frame → person detections (foot = bbox bottom-center for the app).
async function detect(det, rgb, w, h, opts = {}) {
  const pre = preprocess(rgb, w, h);
  const tensor = new ort.Tensor('float32', pre.data, [1, 3, pre.size, pre.size]);
  const out = await det.session.run({ [det.inputName]: tensor });
  const boxes = postprocess(out[det.outputName], pre, w, h, opts.scoreThr, opts.iouThr);
  return boxes.map((d) => ({ ...d, foot: [(d.box[0] + d.box[2]) / 2, d.box[3]] }));
}

module.exports = { createDetector, preprocess, postprocess, detect, iou, nms, platformProviders, INPUT };
