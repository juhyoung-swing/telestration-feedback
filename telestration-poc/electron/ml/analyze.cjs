// Full in-app analysis pipeline (Phase 2): a video → the tracking JSON the app
// already consumes, produced locally with NO Python. One ffmpeg pass streams
// sampled frames → YOLOv8n detect (onnxruntime-node) → ByteTrack (JS) → per-track
// shirt-color descriptor → fragments + auto-clustered default players.
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const { createDetector, detect } = require('./detector.cjs');
const { Tracker } = require('./tracker.cjs');

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

// Torso-crop median HSV (OpenCV convention: H 0-179, S/V 0-255) — matches the
// old describe_fragments.py so the app's user-anchored re-ID stays compatible.
function torsoHSV(rgb, w, h, box) {
  const [x1, y1, x2, y2] = box, bw = x2 - x1, bh = y2 - y1;
  const cx1 = Math.max(0, Math.floor(x1 + 0.2 * bw)), cx2 = Math.min(w, Math.ceil(x1 + 0.8 * bw));
  const cy1 = Math.max(0, Math.floor(y1 + 0.25 * bh)), cy2 = Math.min(h, Math.ceil(y1 + 0.55 * bh));
  if (cx2 <= cx1 || cy2 <= cy1) return null;
  const H = [], S = [], V = [];
  const sx = Math.max(1, Math.floor((cx2 - cx1) / 24)), sy = Math.max(1, Math.floor((cy2 - cy1) / 24));
  for (let y = cy1; y < cy2; y += sy) for (let x = cx1; x < cx2; x += sx) {
    const i = (y * w + x) * 3, r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d !== 0) {
      if (mx === r) hh = 60 * (((g - b) / d) % 6);
      else if (mx === g) hh = 60 * ((b - r) / d + 2);
      else hh = 60 * ((r - g) / d + 4);
    }
    if (hh < 0) hh += 360;
    H.push(hh / 2); S.push(mx === 0 ? 0 : (d / mx) * 255); V.push(mx);
  }
  if (!H.length) return null;
  const med = (a) => { const s = a.sort((x, y) => x - y); return s[s.length >> 1]; };
  return [med(H), med(S), med(V)];
}

// hsvFeat + k-means(≤4) → default players (mirrors cluster_players.py). The user
// can still refine via in-app 선수 지정 (assignFragments). Labels near→far by foot-y.
function hsvFeat(desc) {
  const h = (desc[0] * 2 * Math.PI) / 180, s = desc[1] / 255, v = desc[2] / 255;
  return [Math.cos(h) * s, Math.sin(h) * s, v * 0.35];
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function autoPlayers(tracks, K = 4) {
  const ids = Object.keys(tracks).filter((id) => tracks[id].desc[2] > 0);
  if (!ids.length) return {};
  const feats = ids.map((id) => hsvFeat(tracks[id].desc));
  const k = Math.min(K, ids.length);
  const centers = [feats[0]];
  while (centers.length < k) { // k-means++ farthest init (deterministic)
    let best = -1, bi = 0;
    feats.forEach((f, i) => { const d = Math.min(...centers.map((c) => dist2(f, c))); if (d > best) { best = d; bi = i; } });
    centers.push(feats[bi]);
  }
  let labels = new Array(ids.length).fill(0);
  for (let it = 0; it < 12; it++) {
    labels = feats.map((f) => { let bi = 0, bd = Infinity; centers.forEach((c, ci) => { const d = dist2(f, c); if (d < bd) { bd = d; bi = ci; } }); return bi; });
    for (let ci = 0; ci < k; ci++) {
      const mem = feats.filter((_, i) => labels[i] === ci);
      if (mem.length) centers[ci] = [0, 1, 2].map((j) => mem.reduce((a, m) => a + m[j], 0) / mem.length);
    }
  }
  const groups = Array.from({ length: k }, () => []);
  ids.forEach((id, i) => { for (const p of tracks[id].pts) groups[labels[i]].push({ f: p.f, t: p.t, foot: p.foot }); });
  const clusters = groups.map((g) => {
    const seen = new Set(), m = [];
    for (const s of g.sort((a, b) => a.f - b.f)) { if (seen.has(s.f)) continue; seen.add(s.f); m.push(s); }
    const ys = m.map((s) => s.foot[1]).sort((a, b) => a - b);
    return { samples: m, medY: ys.length ? ys[ys.length >> 1] : 0 };
  }).filter((c) => c.samples.length);
  clusters.sort((a, b) => b.medY - a.medY); // nearest (largest foot-y) = P1
  const players = {};
  clusters.forEach((c, i) => { players[String(i + 1)] = c.samples; });
  return players;
}

// videoPath → { fragments, players } in the app's on-disk shape.
async function analyzeVideo(videoPath, opts = {}) {
  const step = opts.step || 3;
  const scoreThr = opts.scoreThr ?? 0.35;
  const ffmpegPath = opts.ffmpegPath || 'ffmpeg';
  const ffprobePath = opts.ffprobePath || 'ffprobe';
  const detWidth = opts.detWidth || 640; // downscale for detection (model input is 640 anyway)
  const { onProgress, maxFrames = null, modelPath } = opts;

  const { w, h, fps, nbFrames } = probe(ffprobePath, videoPath);
  const det = await createDetector(modelPath);
  const tracker = new Tracker({ iouThr: opts.iouThr || 0.3, buffer: opts.buffer || 30 });
  const expected = maxFrames || (nbFrames ? Math.ceil(nbFrames / step) : null);

  // Detect on a downscaled frame (ffmpeg scales — better + faster than JS), then
  // map boxes back to ORIGINAL coords so the app's 1920×1080 homography holds.
  const sw = Math.min(w, detWidth);
  const sh = 2 * Math.round((h * sw) / w / 2);
  const scale = w / sw;
  const frameSize = sw * sh * 3;

  const args = ['-nostdin', '-loglevel', 'error', '-i', videoPath,
    '-vf', `select='not(mod(n\\,${step}))',scale=${sw}:${sh}`, '-vsync', '0',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
  const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });

  // Assemble fixed-size frames from the byte stream WITHOUT growing-buffer concat.
  const parts = []; let have = 0, idx = 0, processed = 0, provider = null, stop = false;
  const takeFrame = () => {
    if (parts[0].length >= frameSize) {
      const f = parts[0].subarray(0, frameSize);
      parts[0] = parts[0].subarray(frameSize);
      if (parts[0].length === 0) parts.shift();
      return f;
    }
    const out = Buffer.allocUnsafe(frameSize);
    let off = 0;
    while (off < frameSize) {
      const p = parts[0], need = frameSize - off;
      if (p.length <= need) { p.copy(out, off); off += p.length; parts.shift(); }
      else { p.copy(out, off, 0, need); parts[0] = p.subarray(need); off += need; }
    }
    return out;
  };

  for await (const chunk of proc.stdout) {
    parts.push(chunk); have += chunk.length;
    while (have >= frameSize) {
      const fb = takeFrame(); have -= frameSize;
      const rgb = new Uint8Array(fb.buffer, fb.byteOffset, frameSize);
      const f = idx * step, t = f / fps;
      const dets = await detect(det, rgb, sw, sh, { scoreThr });
      for (const d of dets) {
        d.hsv = torsoHSV(rgb, sw, sh, d.box);                 // color on the scaled frame
        d.box = d.box.map((v) => v * scale);                  // → original coords
        d.foot = [r1(d.foot[0] * scale), r1(d.foot[1] * scale)];
      }
      tracker.update(f, +t.toFixed(3), dets);
      provider = det.provider;
      idx++; processed++;
      if (onProgress && expected) onProgress(Math.min(1, processed / expected));
      if (maxFrames && idx >= maxFrames) { stop = true; break; }
    }
    if (stop) { proc.kill('SIGKILL'); break; }
  }

  const tracks = tracker.finalize();
  const players = autoPlayers(tracks);
  const meta = { video: path.basename(videoPath), fps: +fps.toFixed(3), width: w, height: h, step };
  return {
    fragments: { ...meta, tracks },
    players: { ...meta, players },
    stats: { framesProcessed: processed, provider, trackCount: Object.keys(tracks).length, playerCount: Object.keys(players).length },
  };
}

module.exports = { analyzeVideo, probe, torsoHSV, autoPlayers };
