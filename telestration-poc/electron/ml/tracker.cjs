// ByteTrack-lite — validated in the P2b spike (reproduced Ultralytics ByteTrack
// on clean detections: 56/56 tracks, 100% transition-consistency, 0 ID switches).
// IoU + constant-velocity prediction + track buffer + greedy matching. Not a
// neural net → cheap CPU JS, no GPU. Accumulates per-track foot/box points and
// torso-color samples so finalize() emits the app's fragments shape.
const { iou } = require('./detector.cjs');

const r1 = (v) => Math.round(v * 10) / 10;

class Tracker {
  constructor({ iouThr = 0.3, buffer = 30 } = {}) {
    this.iouThr = iouThr;
    this.buffer = buffer;
    this.nextId = 1;
    this.tracks = [];
    this.done = [];
    this.prevF = null;
  }

  update(f, t, dets) {
    const dt = this.prevF == null ? 1 : (f - this.prevF);
    const cand = [];
    this.tracks.forEach((tr, ti) => {
      const sx = tr.vx * dt, sy = tr.vy * dt;
      const pb = [tr.box[0] + sx, tr.box[1] + sy, tr.box[2] + sx, tr.box[3] + sy];
      dets.forEach((d, di) => { const v = iou(pb, d.box); if (v >= this.iouThr) cand.push([v, ti, di]); });
    });
    cand.sort((a, b) => b[0] - a[0]);

    const tu = new Set(), du = new Set();
    for (const [, ti, di] of cand) {
      if (tu.has(ti) || du.has(di)) continue;
      tu.add(ti); du.add(di);
      const tr = this.tracks[ti], d = dets[di];
      const ocx = (tr.box[0] + tr.box[2]) / 2, ocy = (tr.box[1] + tr.box[3]) / 2;
      const ncx = (d.box[0] + d.box[2]) / 2, ncy = (d.box[1] + d.box[3]) / 2;
      tr.vx = (ncx - ocx) / dt; tr.vy = (ncy - ocy) / dt;
      tr.box = d.box; tr.miss = 0; tr.last = f;
      this.#append(tr, f, t, d);
    }
    dets.forEach((d, di) => {
      if (du.has(di)) return;
      const tr = { id: this.nextId++, box: d.box, vx: 0, vy: 0, miss: 0, last: f, pts: [], colors: [] };
      this.#append(tr, f, t, d);
      this.tracks.push(tr);
    });

    this.tracks.forEach((tr) => { if (tr.last !== f) tr.miss += dt; });
    const alive = [];
    for (const tr of this.tracks) (tr.miss > this.buffer ? this.done : alive).push(tr);
    this.tracks = alive;
    this.prevF = f;
  }

  #append(tr, f, t, d) {
    tr.pts.push({ f, t, foot: d.foot, box: d.box.map(r1) });
    if (d.hsv) tr.colors.push(d.hsv);
  }

  // → { "<id>": { desc:[H,S,V], pts:[{f,t,foot,box}] } }
  finalize(minLen = 2) {
    const all = [...this.done, ...this.tracks].filter((tr) => tr.pts.length >= minLen);
    all.sort((a, b) => a.pts[0].f - b.pts[0].f);
    const out = {};
    let id = 1;
    for (const tr of all) out[String(id++)] = { desc: medianHSV(tr.colors), pts: tr.pts };
    return out;
  }
}

function medianHSV(colors) {
  if (!colors.length) return [0, 0, 0];
  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1]; };
  return [0, 1, 2].map((c) => r1(med(colors.map((x) => x[c]))));
}

module.exports = { Tracker };
