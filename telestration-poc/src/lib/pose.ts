// Pose geometry: COCO-17 keypoint indices, the skeleton bone list, joint-angle
// computation, and time interpolation of the pose cache. All coordinates are in
// VIDEO px (the pose cache's space); the overlay converts to display px.
import type { Pt } from '../geometry/homography';
import type { PoseAngleId, PoseSample } from '../types';

// COCO-17 order (Ultralytics yolov8-pose)
export const KP = {
  nose: 0, lEye: 1, rEye: 2, lEar: 3, rEar: 4,
  lSh: 5, rSh: 6, lEl: 7, rEl: 8, lWr: 9, rWr: 10,
  lHip: 11, rHip: 12, lKnee: 13, rKnee: 14, lAnk: 15, rAnk: 16,
} as const;

// Bones to draw for the stick figure (index pairs into the 17 keypoints).
export const SKELETON_EDGES: [number, number][] = [
  [5, 7], [7, 9], [6, 8], [8, 10],        // arms
  [5, 6], [5, 11], [6, 12], [11, 12],     // shoulders + torso
  [11, 13], [13, 15], [12, 14], [14, 16], // legs
  [0, 5], [0, 6],                         // neck → shoulders
];

export const MIN_SCORE = 0.3; // keypoints below this confidence are treated as missing

export type PoseKptPt = { x: number; y: number; score: number };
export type PoseFrame = { pts: PoseKptPt[] }; // 17 keypoints, video px

export type AngleAnno = {
  id: PoseAngleId;
  label: string;
  value: number;                                   // degrees
  vertex: Pt;                                       // number anchor (video px)
  arc?: { center: Pt; from: Pt; to: Pt };           // optional angle arc between two limbs
};

const ANGLE_LABEL: Record<PoseAngleId, string> = {
  elbow: '팔꿈치', knee: '무릎', rotation: '어깨-엉덩이', trunk: '몸통',
};
export const poseAngleLabel = (id: PoseAngleId) => ANGLE_LABEL[id];

const mid = (a: PoseKptPt, b: PoseKptPt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const ok = (p?: PoseKptPt) => !!p && p.score >= MIN_SCORE;

// interior angle (degrees) at vertex b of the path a-b-c
function angleAt(a: Pt, b: Pt, c: Pt): number | null {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (!m1 || !m2) return null;
  let cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Interpolate the pose cache at time t. Returns 17 keypoints (video px) or null
// when t is outside the player's tracked span. Confidence is the min of the pair.
export function poseAt(samples: PoseSample[], t: number): PoseFrame | null {
  if (!samples || samples.length === 0) return null;
  if (t <= samples[0].t) return frameOf(samples[0]);
  if (t >= samples[samples.length - 1].t) return frameOf(samples[samples.length - 1]);
  // binary search for the bracketing pair
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m].t <= t) lo = m; else hi = m; }
  const a = samples[lo], b = samples[hi];
  const span = b.t - a.t;
  const w = span > 0 ? (t - a.t) / span : 0;
  const pts = a.kpts.map((ka, i) => {
    const kb = b.kpts[i];
    return { x: ka[0] + (kb[0] - ka[0]) * w, y: ka[1] + (kb[1] - ka[1]) * w, score: Math.min(ka[2], kb[2]) };
  });
  return { pts };
}
function frameOf(s: PoseSample): PoseFrame {
  return { pts: s.kpts.map((k) => ({ x: k[0], y: k[1], score: k[2] })) };
}

// Compute the requested joint angles for one pose frame. Skips angles whose
// keypoints are too low-confidence.
export function computeAngles(frame: PoseFrame, side: 'left' | 'right', ids: PoseAngleId[]): AngleAnno[] {
  const p = frame.pts;
  const out: AngleAnno[] = [];
  const L = side === 'left';

  for (const id of ids) {
    if (id === 'elbow') {
      const sh = p[L ? KP.lSh : KP.rSh], el = p[L ? KP.lEl : KP.rEl], wr = p[L ? KP.lWr : KP.rWr];
      if (ok(sh) && ok(el) && ok(wr)) {
        const v = angleAt(sh, el, wr);
        if (v != null) out.push({ id, label: ANGLE_LABEL.elbow, value: v, vertex: el, arc: { center: el, from: sh, to: wr } });
      }
    } else if (id === 'knee') {
      const hip = p[L ? KP.lHip : KP.rHip], kn = p[L ? KP.lKnee : KP.rKnee], an = p[L ? KP.lAnk : KP.rAnk];
      if (ok(hip) && ok(kn) && ok(an)) {
        const v = angleAt(hip, kn, an);
        if (v != null) out.push({ id, label: ANGLE_LABEL.knee, value: v, vertex: kn, arc: { center: kn, from: hip, to: an } });
      }
    } else if (id === 'trunk') {
      const ls = p[KP.lSh], rs = p[KP.rSh], lh = p[KP.lHip], rh = p[KP.rHip];
      if (ok(ls) && ok(rs) && ok(lh) && ok(rh)) {
        const mSh = mid(ls, rs), mHip = mid(lh, rh);
        const vx = mSh.x - mHip.x, vy = mSh.y - mHip.y;         // torso direction (hip → shoulder)
        const deg = Math.abs((Math.atan2(vx, -vy) * 180) / Math.PI); // 0 = upright
        const len = Math.hypot(vx, vy) || 1;
        out.push({ id, label: ANGLE_LABEL.trunk, value: deg, vertex: mHip, arc: { center: mHip, from: { x: mHip.x, y: mHip.y - len }, to: mSh } });
      }
    } else if (id === 'rotation') {
      const ls = p[KP.lSh], rs = p[KP.rSh], lh = p[KP.lHip], rh = p[KP.rHip];
      if (ok(ls) && ok(rs) && ok(lh) && ok(rh)) {
        const shA = Math.atan2(rs.y - ls.y, rs.x - ls.x);
        const hipA = Math.atan2(rh.y - lh.y, rh.x - lh.x);
        let d = ((shA - hipA) * 180) / Math.PI;
        d = ((d + 180) % 360 + 360) % 360 - 180;               // → [-180,180]
        const mSh = mid(ls, rs), mHip = mid(lh, rh);
        const c = mid({ ...mSh, score: 1 } as PoseKptPt, { ...mHip, score: 1 } as PoseKptPt);
        const r = 40;
        out.push({
          id, label: ANGLE_LABEL.rotation, value: Math.abs(d), vertex: c,
          arc: { center: c, from: { x: c.x + Math.cos(shA) * r, y: c.y + Math.sin(shA) * r }, to: { x: c.x + Math.cos(hipA) * r, y: c.y + Math.sin(hipA) * r } },
        });
      }
    }
  }
  return out;
}

// Pick the better-tracked side (higher wrist+elbow confidence) as the default at creation.
export function defaultSide(samples: PoseSample[]): 'left' | 'right' {
  let l = 0, r = 0;
  const n = Math.min(samples.length, 30);
  const stepN = Math.max(1, Math.floor(samples.length / n));
  for (let i = 0; i < samples.length; i += stepN) {
    const k = samples[i].kpts;
    l += (k[KP.lEl][2] + k[KP.lWr][2]);
    r += (k[KP.rEl][2] + k[KP.rWr][2]);
  }
  return r >= l ? 'right' : 'left';
}
