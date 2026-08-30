import type { CutoutSample, FootSample, Fragments, Players } from '../types';

/** Nearest silhouette polygon to a video frame (no interpolation). */
export function polyAt(samples: CutoutSample[], frame: number, maxGap = 5): [number, number][] | null {
  if (!samples || samples.length === 0) return null;
  const hi = samples.length - 1;
  if (frame <= samples[0].f) return Math.abs(samples[0].f - frame) <= maxGap ? samples[0].poly : null;
  if (frame >= samples[hi].f) return Math.abs(samples[hi].f - frame) <= maxGap ? samples[hi].poly : null;
  let lo = 0, h = hi;
  while (h - lo > 1) { const m = (lo + h) >> 1; if (samples[m].f <= frame) lo = m; else h = m; }
  const a = samples[lo], b = samples[h];
  const near = Math.abs(a.f - frame) <= Math.abs(b.f - frame) ? a : b;
  return Math.abs(near.f - frame) <= maxGap ? near.poly : null;
}

/** Distinct per-player colors (P1..P4 and cycling beyond). */
export const PLAYER_COLORS = ['#E4EF3D', '#00E5FF', '#FF5FA2', '#7CFF6B'];
export const playerColor = (label: string) => PLAYER_COLORS[(Number(label) - 1) % PLAYER_COLORS.length];

// ── user-anchored re-ID ─────────────────────────────────────────────────────
/** HSV descriptor → feature (hue as circular×sat, value weak) for matching. */
export function hsvFeat(desc: [number, number, number]): [number, number, number] {
  const h = (desc[0] * 2 * Math.PI) / 180, s = desc[1] / 255, v = desc[2] / 255;
  return [Math.cos(h) * s, Math.sin(h) * s, v * 0.35];
}
const featDist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Fragment whose box at ~frame contains (x,y). Smallest (tightest) box wins on overlap. */
export function hitTestFragment(fragments: Fragments, x: number, y: number, frame: number): string | null {
  let best: string | null = null, bestArea = Infinity;
  for (const [id, fr] of Object.entries(fragments)) {
    let p = null, bd = Infinity;
    for (const s of fr.pts) { const d = Math.abs(s.f - frame); if (d < bd) { bd = d; p = s; } }
    if (!p || bd > 5) continue;
    const [x1, y1, x2, y2] = p.box;
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
      const area = (x2 - x1) * (y2 - y1);
      if (area < bestArea) { bestArea = area; best = id; }
    }
  }
  return best;
}

/** Detection boxes present at ~frame (for drawing during player calibration). */
export function boxesAt(fragments: Fragments, frame: number) {
  const out: { id: string; box: [number, number, number, number] }[] = [];
  for (const [id, fr] of Object.entries(fragments)) {
    let p = null, bd = Infinity;
    for (const s of fr.pts) { const d = Math.abs(s.f - frame); if (d < bd) { bd = d; p = s; } }
    if (p && bd <= 3) out.push({ id, box: p.box });
  }
  return out;
}

/** Assign every fragment to the nearest anchor by appearance → merged Players. */
export function assignFragments(
  fragments: Fragments,
  anchors: { label: string; desc: [number, number, number] }[],
): Players {
  const feats = anchors.map((a) => hsvFeat(a.desc));
  const byLabel: Record<string, FootSample[]> = {};
  for (const a of anchors) byLabel[a.label] = [];
  for (const fr of Object.values(fragments)) {
    const ff = hsvFeat(fr.desc);
    let bi = 0, bd = Infinity;
    feats.forEach((f, i) => { const d = featDist(ff, f); if (d < bd) { bd = d; bi = i; } });
    const lab = anchors[bi].label;
    for (const s of fr.pts) byLabel[lab].push({ f: s.f, t: s.t, foot: s.foot });
  }
  const players: Players = {};
  for (const lab of Object.keys(byLabel)) {
    const seen = new Set<number>(); const merged: FootSample[] = [];
    for (const s of byLabel[lab].sort((a, b) => a.f - b.f)) { if (seen.has(s.f)) continue; seen.add(s.f); merged.push(s); }
    players[lab] = merged;
  }
  return players;
}

/**
 * Foot position at time `t`, with linear interpolation across short gaps so the
 * halo moves smoothly instead of freezing/vanishing. Long gaps (> 2·maxGapSec)
 * return null unless `t` is within maxGapSec of an endpoint.
 */
export function footAt(samples: FootSample[], t: number, maxGapSec = 0.5): [number, number] | null {
  if (!samples || samples.length === 0) return null;
  const hiEnd = samples.length - 1;
  if (t <= samples[0].t) return Math.abs(samples[0].t - t) <= maxGapSec ? samples[0].foot : null;
  if (t >= samples[hiEnd].t) return Math.abs(samples[hiEnd].t - t) <= maxGapSec ? samples[hiEnd].foot : null;

  let lo = 0, hi = hiEnd;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const gap = b.t - a.t;
  if (gap <= 2 * maxGapSec) {
    const w = gap > 0 ? (t - a.t) / gap : 0; // interpolate across the short gap
    return [a.foot[0] + (b.foot[0] - a.foot[0]) * w, a.foot[1] + (b.foot[1] - a.foot[1]) * w];
  }
  const near = Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
  return Math.abs(near.t - t) <= maxGapSec ? near.foot : null;
}

/** Player trajectories with time span + a near/far position hint (median foot y). */
export function playersBySpan(players: Players) {
  return Object.entries(players)
    .map(([id, pts]) => {
      const ys = pts.map((p) => p.foot[1]).sort((a, b) => a - b);
      return {
        id,
        count: pts.length,
        t0: pts[0]?.t ?? 0,
        t1: pts[pts.length - 1]?.t ?? 0,
        medY: ys.length ? ys[ys.length >> 1] : 0,
      };
    })
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/** Rough court-position label from median foot y (video px, 1080-tall frame). */
export function posLabel(medY: number): string {
  if (medY > 600) return '근접';
  if (medY > 300) return '중앙';
  if (medY > 210) return '먼쪽';
  return '뒤/피더';
}
