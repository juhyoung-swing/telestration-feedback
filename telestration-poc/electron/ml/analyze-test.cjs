// P2b end-to-end test: analyze court.mp4 and validate the output structure +
// sanity (tracks, players, foot points in-frame) + timing.
// Usage: node electron/ml/analyze-test.cjs [maxFrames] [step]
const path = require('path');
const { analyzeVideo } = require('./analyze.cjs');

const MODEL = process.env.MODEL || path.join(__dirname, '..', '..', 'resources', 'models', 'yolov8n.onnx');
const VIDEO = path.join(__dirname, '..', '..', 'public', 'court.mp4');
const FFMPEG = require('ffmpeg-static');
const FFPROBE = require('ffprobe-static').path;

const maxFrames = process.argv[2] ? parseInt(process.argv[2], 10) : 120;
const step = process.argv[3] ? parseInt(process.argv[3], 10) : 3;

(async () => {
  const t0 = Date.now();
  let lastPct = 0;
  const res = await analyzeVideo(VIDEO, {
    modelPath: MODEL, ffmpegPath: FFMPEG, ffprobePath: FFPROBE, step, maxFrames,
    onProgress: (p) => { if (p - lastPct >= 0.25) { lastPct = p; process.stderr.write(`  ${Math.round(p * 100)}%\n`); } },
  });
  const secs = (Date.now() - t0) / 1000;

  const { width: W, height: H, fps } = res.fragments;
  const fragIds = Object.keys(res.fragments.tracks);
  const playerIds = Object.keys(res.players.players);

  // sanity: every foot point inside the frame
  let footTotal = 0, footBad = 0;
  for (const id of fragIds) for (const p of res.fragments.tracks[id].pts) {
    footTotal++;
    if (p.foot[0] < 0 || p.foot[0] > W || p.foot[1] < 0 || p.foot[1] > H) footBad++;
  }

  const sampleFrag = res.fragments.tracks[fragIds[0]];
  const samplePlayer = playerIds[0] && res.players.players[playerIds[0]];

  console.log(JSON.stringify({
    timing: { secs: +secs.toFixed(1), framesProcessed: res.stats.framesProcessed, msPerFrame: +(secs * 1000 / res.stats.framesProcessed).toFixed(1), provider: res.stats.provider },
    video: { W, H, fps, step },
    fragments: { count: fragIds.length, footPoints: footTotal, footOutOfFrame: footBad },
    players: { count: playerIds.length, spans: playerIds.map((id) => { const s = res.players.players[id]; return { id, frames: s.length, t0: s[0]?.t, t1: s[s.length - 1]?.t }; }) },
    sampleFragment: sampleFrag && { desc: sampleFrag.desc, len: sampleFrag.pts.length, firstPt: sampleFrag.pts[0] },
    samplePlayerFirstFoot: samplePlayer && samplePlayer[0],
    structureOK: {
      fragmentShape: !!(sampleFrag && sampleFrag.desc && Array.isArray(sampleFrag.pts) && sampleFrag.pts[0].f !== undefined && sampleFrag.pts[0].foot && sampleFrag.pts[0].box),
      playerShape: !!(samplePlayer && samplePlayer[0].f !== undefined && samplePlayer[0].foot),
    },
  }, null, 2));
})();
