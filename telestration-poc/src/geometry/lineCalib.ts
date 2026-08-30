// ---------------------------------------------------------------------------
// Line-based calibration.
//
// A homography can be recovered from LINE correspondences, not just points:
// if points map as x' = H·x, then lines map as l' = H⁻ᵀ·l, equivalently Hᵀ·l' = L.
//
// Why this is better for a tennis court:
//   • The court IS lines — long, high-contrast, easy to click precisely.
//   • You click 2+ points anywhere ALONG a visible line; the exact corner (its
//     endpoint) need not be visible or even on-screen — it's just where two lines
//     intersect, which the homography reproduces for free.
//   • More lines → an over-determined least-squares fit → more robust.
//
// We stack, for each correspondence (court line L, image line l), the constraint
// (Mₙ·lₙ) × Lₙ = 0 where Mₙ = Hₙᵀ, then take the null space (smallest eigenvector
// of AᵀA). Points and lines are Hartley-normalized for conditioning.
// ---------------------------------------------------------------------------
import type { Pt, Mat3 } from './homography';
import { invert3x3 } from './homography';
import {
  DOUBLES_WIDTH, COURT_LENGTH, NET_Y, SERVICE_FAR_Y, SERVICE_NEAR_Y,
  CENTER_X, SINGLES_LEFT_X, SINGLES_RIGHT_X,
} from './court';

export type Line3 = [number, number, number]; // a·x + b·y + c = 0
export type LineFamily = 'horizontal' | 'vertical'; // court y=const vs x=const

export type CourtLineDef = { id: string; label: string; family: LineFamily; vec: Line3 };

// Every known court line, as an infinite line in court meters. The user draws any
// subset; a valid solve needs ≥4 lines spanning BOTH families (else the x- or
// y-direction is unconstrained).
export const COURT_LINE_DEFS: CourtLineDef[] = [
  { id: 'far-baseline', label: '먼 베이스라인', family: 'horizontal', vec: [0, 1, 0] },
  { id: 'near-baseline', label: '가까운 베이스라인', family: 'horizontal', vec: [0, 1, -COURT_LENGTH] },
  { id: 'net', label: '네트 라인', family: 'horizontal', vec: [0, 1, -NET_Y] },
  { id: 'far-service', label: '먼 서비스라인', family: 'horizontal', vec: [0, 1, -SERVICE_FAR_Y] },
  { id: 'near-service', label: '가까운 서비스라인', family: 'horizontal', vec: [0, 1, -SERVICE_NEAR_Y] },
  { id: 'left-doubles', label: '왼쪽 더블스 사이드라인', family: 'vertical', vec: [1, 0, 0] },
  { id: 'right-doubles', label: '오른쪽 더블스 사이드라인', family: 'vertical', vec: [1, 0, -DOUBLES_WIDTH] },
  { id: 'left-singles', label: '왼쪽 싱글스 사이드라인', family: 'vertical', vec: [1, 0, -SINGLES_LEFT_X] },
  { id: 'right-singles', label: '오른쪽 싱글스 사이드라인', family: 'vertical', vec: [1, 0, -SINGLES_RIGHT_X] },
  { id: 'center-service', label: '센터 서비스라인', family: 'vertical', vec: [1, 0, -CENTER_X] },
];

export function courtLineDef(id: string): CourtLineDef {
  const d = COURT_LINE_DEFS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown court line ${id}`);
  return d;
}

// ---- small matrix / vector helpers ----------------------------------------
const transpose3 = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

function matMul3(A: Mat3, B: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j];
      r[i * 3 + j] = s;
    }
  return r;
}

const invTranspose3 = (m: Mat3): Mat3 => transpose3(invert3x3(m));

// apply a 3×3 to a line vector (pure linear map, no homogeneous divide)
const applyToLine = (M: Mat3, l: Line3): Line3 => [
  M[0] * l[0] + M[1] * l[1] + M[2] * l[2],
  M[3] * l[0] + M[4] * l[1] + M[5] * l[2],
  M[6] * l[0] + M[7] * l[1] + M[8] * l[2],
];

function normalizeLine(l: Line3): Line3 {
  let n = Math.hypot(l[0], l[1]);
  if (n < 1e-12) n = Math.hypot(l[0], l[1], l[2]) || 1;
  return [l[0] / n, l[1] / n, l[2] / n];
}

const similarity = (cx: number, cy: number, s: number): Mat3 => [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];

// ---- line fitting & geometry ----------------------------------------------

/** Total-least-squares (PCA) line through ≥2 image points → homogeneous [a,b,c], (a,b) unit. */
export function fitImageLine(points: Pt[]): Line3 {
  const n = points.length;
  if (n < 2) throw new Error('need at least 2 points to fit a line');
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  // normal = eigenvector of the SMALLEST eigenvalue of [[sxx,sxy],[sxy,syy]]
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (sxx * syy - sxy * sxy)));
  const lambdaMin = tr / 2 - disc;
  let nx: number, ny: number;
  if (Math.abs(sxy) > 1e-12) {
    nx = sxy; ny = lambdaMin - sxx;
  } else {
    // axis-aligned spread: smaller-variance axis is the normal
    if (sxx <= syy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
  }
  const len = Math.hypot(nx, ny) || 1;
  nx /= len; ny /= len;
  return [nx, ny, -(nx * cx + ny * cy)];
}

/** Intersection of two image lines (homogeneous cross product). Result may lie off-screen. */
export function lineIntersect(l1: Line3, l2: Line3): Pt {
  const x = l1[1] * l2[2] - l1[2] * l2[1];
  const y = l1[2] * l2[0] - l1[0] * l2[2];
  const w = l1[0] * l2[1] - l1[1] * l2[0];
  return { x: x / w, y: y / w };
}

/** The two points where a line crosses the frame rectangle, for drawing an extended preview. */
export function lineSegmentInRect(l: Line3, w: number, h: number): [Pt, Pt] | null {
  const [a, b, c] = l;
  const pts: Pt[] = [];
  const push = (x: number, y: number) => {
    if (x >= -0.5 && x <= w + 0.5 && y >= -0.5 && y <= h + 0.5) pts.push({ x, y });
  };
  if (Math.abs(b) > 1e-9) { push(0, -c / b); push(w, -(a * w + c) / b); }
  if (Math.abs(a) > 1e-9) { push(-c / a, 0); push(-(b * h + c) / a, h); }
  const uniq = pts.filter((p, i) => pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.5) === i);
  return uniq.length >= 2 ? [uniq[0], uniq[1]] : null;
}

// ---- symmetric eigensolver (cyclic Jacobi) --------------------------------
function jacobiEigen(Sin: number[][]): { values: number[]; vectors: number[][] } {
  const n = Sin.length;
  const S = Sin.map((r) => r.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let iter = 0; iter < 100; iter++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += S[p][q] * S[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = S[p][q];
        if (Math.abs(apq) < 1e-20) continue;
        const theta = (S[q][q] - S[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) { const kp = S[k][p], kq = S[k][q]; S[k][p] = c * kp - s * kq; S[k][q] = s * kp + c * kq; }
        for (let k = 0; k < n; k++) { const pk = S[p][k], qk = S[q][k]; S[p][k] = c * pk - s * qk; S[q][k] = s * pk + c * qk; }
        for (let k = 0; k < n; k++) { const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
      }
    }
  }
  return { values: S.map((r, i) => r[i]), vectors: V };
}

// ---- the solver ------------------------------------------------------------
export type LineCorrespondence = { court: Line3; image: Line3 };

/**
 * Recover H (court meters → image px) from ≥4 line correspondences via a
 * normalized line-DLT + least squares. Over-determined input is welcome.
 */
export function homographyFromLines(corr: LineCorrespondence[], imgW: number, imgH: number): Mat3 {
  if (corr.length < 4) throw new Error('need at least 4 line correspondences');

  const Timg = similarity(imgW / 2, imgH / 2, 2 / Math.max(imgW, imgH));
  const Tcourt = similarity(CENTER_X, NET_Y, 2 / COURT_LENGTH);
  const TimgInvT = invTranspose3(Timg);
  const TcourtInvT = invTranspose3(Tcourt);

  const rows: number[][] = [];
  for (const { court, image } of corr) {
    const [lx, ly, lz] = normalizeLine(applyToLine(TimgInvT, image));
    const [Lx, Ly, Lz] = normalizeLine(applyToLine(TcourtInvT, court));
    // Mₙ = Hₙᵀ, m row-major; constraint (Mₙ·l) × L = 0 → two rows
    rows.push([0, 0, 0, Lz * lx, Lz * ly, Lz * lz, -Ly * lx, -Ly * ly, -Ly * lz]);
    rows.push([-Lz * lx, -Lz * ly, -Lz * lz, 0, 0, 0, Lx * lx, Lx * ly, Lx * lz]);
  }

  // AᵀA (9×9), then smallest-eigenvalue eigenvector
  const ATA: number[][] = Array.from({ length: 9 }, () => new Array(9).fill(0));
  for (const r of rows) for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) ATA[i][j] += r[i] * r[j];
  const { values, vectors } = jacobiEigen(ATA);
  let mi = 0;
  for (let i = 1; i < 9; i++) if (values[i] < values[mi]) mi = i;
  const m = vectors.map((row) => row[mi]) as Mat3; // Mₙ row-major

  const Hn = transpose3(m); // Hₙ = Mₙᵀ
  const H = matMul3(matMul3(invert3x3(Timg), Hn), Tcourt); // denormalize
  const scale = Math.abs(H[8]) > 1e-12 ? 1 / H[8] : 1;
  return H.map((v) => v * scale) as Mat3;
}

/** Family coverage check — a well-posed solve needs both orientations. */
export function familiesCovered(ids: string[]): { horizontal: number; vertical: number; ok: boolean } {
  let horizontal = 0, vertical = 0;
  for (const id of ids) {
    const d = COURT_LINE_DEFS.find((x) => x.id === id);
    if (d?.family === 'horizontal') horizontal++;
    else if (d?.family === 'vertical') vertical++;
  }
  return { horizontal, vertical, ok: horizontal >= 2 && vertical >= 2 };
}
