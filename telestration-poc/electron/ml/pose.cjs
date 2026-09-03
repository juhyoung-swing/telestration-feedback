// Pose (form) analysis pipeline — mirrors analyze.cjs but with YOLOv8-pose.
// One ffmpeg pass streams sampled frames → YOLOv8n-pose detect (onnxruntime-node,
// output [1,56,8400] = 4 box + 1 conf + 17×3 keypoints) → motion-based player
// slotting (nearest foot-y = P1, same labeling as the position pipeline) → per
// player, per-frame keypoint sequences in ORIGINAL video px. No Python, no torch.
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const { createDetector, preprocess, iou } = require('./detector.cjs');
const { torsoHSV } = require('./analyze.cjs');
const ort = require('onnxruntime-node');

const NKPT = 17;                       // COCO keypoints
const r1 = (v) => Math.round(v * 10) / 10;

function probe(ffprobePath, videoPath) {
  const out = execFileSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames,duration',
    '-of', 'json', videoPath]).toString();
  const s = JSON.parse(out).streams[0];
  const [num, den] = (s.avg_frame_rate || '30/1').split('/').map(Number);
  const fps = den ? num / den : 30;
  const duration = parseFloat(s.duration) || null;
  const nbFrames = parseInt(s.nb_frames, 10) || (duration ? Math.round(duration * fps) : null);
  return { w: s.width, h: s.height, fps, duration, nbFrames };
}

// NMS on {box,score,kpts} dets — keypoints ride along with the kept det.
function nmsPose(dets, iouThr) {
  dets.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of dets) if (keep.every((k) => iou(k.box, d.box) < iouThr)) keep.push(d);
  return keep;
}

// Decode [1,56,8400] → person dets with box + 17 keypoints, in ORIGINAL image
// coords (letterbox undone). Channels-first: ch0-3 box, ch4 conf, ch5.. kpts×3.
function postprocessPose(output, meta, origW, origH, scoreThr = 0.35, iouThr = 0.5) {
  const { ratio, padX, padY } = meta;
  const data = output.data, dims = output.dims;
  const nc = dims[1], na = dims[2];      // 56, 8400
  const at = (c, a) => data[c * na + a];
  const unX = (x) => Math.max(0, Math.min(origW, (x - padX) / ratio));
  const unY = (y) => Math.max(0, Math.min(origH, (y - padY) / ratio));
  const dets = [];
  for (let a = 0; a < na; a++) {
    const score = at(4, a);
    if (score < scoreThr) continue;
    const cx = at(0, a), cy = at(1, a), bw = at(2, a), bh = at(3, a);
    const box = [unX(cx - bw / 2), unY(cy - bh / 2), unX(cx + bw / 2), unY(cy + bh / 2)];
    if (box[2] <= box[0] || box[3] <= box[1]) continue;
    const kpts = [];
    for (let i = 0; i < NKPT; i++) {
      const base = 5 + i * 3;
      kpts.push([unX(at(base, a)), unY(at(base + 1, a)), at(base + 2, a)]);
    }
    dets.push({ box, score, kpts });
  }
  return nmsPose(dets, iouThr);
}

async function detectPose(det, rgb, w, h, opts = {}) {
  const pre = preprocess(rgb, w, h);
  const tensor = new ort.Tensor('float32', pre.data, [1, 3, pre.size, pre.size]);
  const out = await det.session.run({ [det.inputName]: tensor });
  const dets = postprocessPose(out[det.outputName], pre, w, h, opts.scoreThr, opts.iouThr);
  return dets.map((d) => ({ ...d, foot: [(d.box[0] + d.box[2]) / 2, d.box[3]] }));
}

// ── motion-primary player slotting (mirrors analyze.cjs), carrying keypoints ──
function hsvFeat(desc) {
  const h = (desc[0] * 2 * Math.PI) / 180, s = desc[1] / 255, v = desc[2] / 255;
  return [Math.cos(h) * s, Math.sin(h) * s, v * 0.35];
}
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// byFrame: Map<frame, [{foot,t,feat,kpts}]> → { "1":[{f,t,foot,kpts}], ... }
function assignPosePlayersByMotion(byFrame) {
  const frames = [...byFrame.keys()].sort((a, b) => a - b);
  if (!frames.length) return {};

  const counts = {};
  for (const f of frames) { const n = Math.min(6, byFrame.get(f).length); if (n) counts[n] = (counts[n] || 0) + 1; }
  let K = 2, bestC = -1;
  for (const n in counts) if (counts[n] > bestC) { bestC = counts[n]; K = +n; }

  const COLORW = 140; // px-equivalent weight of one unit of color distance
  let slots = null;
  for (const f of frames) { const ds = byFrame.get(f); if (ds.length === K) { slots = ds.map((d) => ({ x: d.foot[0], y: d.foot[1], vx: 0, vy: 0, feat: d.feat.slice(), out: [] })); break; } }
  if (!slots) { const ds = byFrame.get(frames[0]).slice(0, K); slots = ds.map((d) => ({ x: d.foot[0], y: d.foot[1], vx: 0, vy: 0, feat: d.feat.slice(), out: [] })); }

  let prevF = null;
  for (const f of frames) {
    const dt = prevF == null ? 1 : (f - prevF);
    const ds = byFrame.get(f);
    const pred = slots.map((s) => ({ x: s.x + s.vx * dt, y: s.y + s.vy * dt }));
    const pairs = [];
    slots.forEach((s, si) => ds.forEach((d, di) => {
      const pd = Math.hypot(pred[si].x - d.foot[0], pred[si].y - d.foot[1]);
      pairs.push([pd + COLORW * cdist(s.feat, d.feat), si, di]);
    }));
    pairs.sort((a, b) => a[0] - b[0]);
    const su = new Set(), du = new Set();
    for (const [, si, di] of pairs) {
      if (su.has(si) || du.has(di)) continue;
      su.add(si); du.add(di);
      const s = slots[si], d = ds[di];
      s.vx = (d.foot[0] - s.x) / dt; s.vy = (d.foot[1] - s.y) / dt;
      s.x = d.foot[0]; s.y = d.foot[1];
      s.feat = s.feat.map((v, k) => v * 0.9 + d.feat[k] * 0.1);
      s.out.push({ f, t: d.t, foot: d.foot, kpts: d.kpts });
    }
    slots.forEach((s, si) => { if (!su.has(si)) { s.x = pred[si].x; s.y = pred[si].y; } });
    prevF = f;
  }

  const groups = slots.map((s) => {
    const ys = s.out.map((o) => o.foot[1]).sort((a, b) => a - b);
    return { out: s.out.sort((a, b) => a.f - b.f), medY: ys.length ? ys[ys.length >> 1] : 0 };
  }).filter((g) => g.out.length);
  groups.sort((a, b) => b.medY - a.medY); // nearest (largest foot-y) = P1
  const players = {};
  groups.forEach((g, i) => { players[String(i + 1)] = g.out; });
  return players;
}

// videoPath → { pose: { meta, players: {id:[{f,t,foot,kpts}]} }, stats }
async function analyzePoseVideo(videoPath, opts = {}) {
  const step = opts.step || 3;
  const scoreThr = opts.scoreThr ?? 0.35;
  const ffmpegPath = opts.ffmpegPath || 'ffmpeg';
  const ffprobePath = opts.ffprobePath || 'ffprobe';
  const detWidth = opts.detWidth || 640;
  const { onProgress, maxFrames = null, posePath } = opts;
  const ss = Math.max(0, opts.ss || 0);        // analyze only [ss, to] of the source (clip-scoped)
  const to = opts.to && opts.to > ss ? opts.to : null;

  const { w, h, fps, nbFrames } = probe(ffprobePath, videoPath);
  const det = await createDetector(posePath);
  const rangeFrames = to ? Math.ceil(((to - ss) * fps) / step) : (nbFrames ? Math.ceil(nbFrames / step) : null);
  const expected = maxFrames || rangeFrames;
  const f0 = Math.round(ss * fps); // source frame index of the first decoded frame

  const sw = Math.min(w, detWidth);
  const sh = 2 * Math.round((h * sw) / w / 2);
  const scale = w / sw;
  const frameSize = sw * sh * 3;

  const args = ['-nostdin', '-loglevel', 'error',
    ...(ss > 0 ? ['-ss', String(ss)] : []), '-i', videoPath,
    ...(to ? ['-t', String(to - ss)] : []),
    '-vf', `select='not(mod(n\\,${step}))',scale=${sw}:${sh}`, '-vsync', '0',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
  const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });

  const parts = []; let have = 0, idx = 0, processed = 0, provider = null, stop = false;
  const takeFrame = () => {
    const out = Buffer.allocUnsafe(frameSize);
    let off = 0;
    while (off < frameSize) {
      const p = parts[0], need = frameSize - off;
      if (p.length <= need) { p.copy(out, off); off += p.length; parts.shift(); }
      else { p.copy(out, off, 0, need); parts[0] = p.subarray(need); off += need; }
    }
    return out;
  };

  const byFrame = new Map();
  for await (const chunk of proc.stdout) {
    parts.push(chunk); have += chunk.length;
    while (have >= frameSize) {
      const fb = takeFrame(); have -= frameSize;
      const rgb = new Uint8Array(fb.buffer, fb.byteOffset, frameSize);
      const f = f0 + idx * step, t = f / fps; // SOURCE frame/time (offset by the range start)
      const dets = await detectPose(det, rgb, sw, sh, { scoreThr });
      const row = [];
      for (const d of dets) {
        const hsv = torsoHSV(rgb, sw, sh, d.box) || [0, 0, 0];        // color on the scaled frame
        const foot = [r1(d.foot[0] * scale), r1(d.foot[1] * scale)]; // → original coords
        const kpts = d.kpts.map((k) => [r1(k[0] * scale), r1(k[1] * scale), Math.round(k[2] * 100) / 100]);
        row.push({ foot, t: +t.toFixed(3), feat: hsvFeat(hsv), kpts });
      }
      if (row.length) byFrame.set(f, row);
      provider = det.provider;
      idx++; processed++;
      if (onProgress && expected) onProgress(Math.min(1, processed / expected));
      if (maxFrames && idx >= maxFrames) { stop = true; break; }
    }
    if (stop) { proc.kill('SIGKILL'); break; }
  }

  const players = assignPosePlayersByMotion(byFrame);
  const meta = { video: path.basename(videoPath), fps: +fps.toFixed(3), width: w, height: h, step };
  return {
    pose: { ...meta, players },
    stats: { framesProcessed: processed, provider, playerCount: Object.keys(players).length },
  };
}

module.exports = { analyzePoseVideo, postprocessPose, detectPose };
