// P2a smoke test — verify onnxruntime-node runs yolov8n.onnx and MEASURE
// ms/frame on this machine (CoreML vs CPU), and that it detects the players.
// Runs with plain `node electron/ml/smoke-test.cjs`.
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const { createDetector, detect } = require('./detector.cjs');

const MODEL = path.join(__dirname, '..', '..', 'resources', 'models', 'yolov8n.onnx');
const VIDEO = path.join(__dirname, '..', '..', 'public', 'court.mp4');
const AT = process.argv[2] || '30'; // timestamp (s)

function probeDims(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w, h] = out.split(',').map(Number);
  return { w, h };
}

function grabFrame(file, t, w, h) {
  // spawnSync so a non-zero ffmpeg exit (banner/SIGPIPE) doesn't throw away stdout.
  const r = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: w * h * 3 + 1024 * 1024 });
  const buf = r.stdout;
  if (!buf || buf.length < w * h * 3) {
    throw new Error(`frame grab failed: ${buf ? buf.length : 0} bytes; stderr=${(r.stderr || '').toString().slice(0, 200)}`);
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, w * h * 3);
}

async function bench(provider, rgb, w, h, iters = 20) {
  const det = await createDetector(MODEL, provider === 'cpu' ? ['cpu'] : [provider]);
  // warmup
  const first = await detect(det, rgb, w, h);
  const times = [];
  for (let i = 0; i < iters; i++) {
    const t0 = process.hrtime.bigint();
    await detect(det, rgb, w, h);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return {
    requestedProvider: provider,
    actualProvider: det.provider,
    persons: first.length,
    ms_median: +times[Math.floor(iters / 2)].toFixed(1),
    ms_min: +times[0].toFixed(1),
    ms_max: +times[iters - 1].toFixed(1),
  };
}

(async () => {
  const { w, h } = probeDims(VIDEO);
  console.log(`video ${w}x${h}, frame @ ${AT}s`);
  const rgb = grabFrame(VIDEO, AT, w, h);
  console.log(`frame bytes: ${rgb.length} (expected ${w * h * 3})`);

  const results = [];
  for (const p of ['coreml', 'cpu']) {
    try { results.push(await bench(p, rgb, w, h)); }
    catch (e) { results.push({ requestedProvider: p, error: String(e.message || e).slice(0, 200) }); }
  }
  console.log(JSON.stringify(results, null, 2));
})();
