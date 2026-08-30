// ---------------------------------------------------------------------------
// Homography core.
//
// Coordinate spaces (never mix them — convert explicitly):
//   ① DOM/CSS pixels        — where the mouse click lands (see coords.ts)
//   ② video intrinsic px    — videoWidth × videoHeight; THIS is where H lives
//   ③ court meters          — (0,0)..(10.97, 23.77); the authoritative space
//
// H maps court(③) -> video(②).  H⁻¹ maps video(②) -> court(③).
// The display scaling (②⇄①) is a separate, resize-time concern in coords.ts —
// H is NEVER recomputed on resize.
//
// This is a self-contained, exact 4-point solver (equivalent to OpenCV.js
// getPerspectiveTransform). Zero dependencies, instant load, unit-verifiable.
// Swapping in OpenCV.js later is a one-function change (same signature).
// ---------------------------------------------------------------------------

export type Pt = { x: number; y: number };
export type Mat3 = number[]; // length 9, row-major: [m0 m1 m2 / m3 m4 m5 / m6 m7 m8]

/** Solve an n×n linear system A·x = b via Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]); // augmented n×(n+1)

  for (let col = 0; col < n; col++) {
    // Partial pivot: find the row with the largest magnitude in this column.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) {
      throw new Error('Singular system — calibration points are degenerate (collinear or coincident).');
    }
    [M[col], M[piv]] = [M[piv], M[col]];

    // Normalize pivot row, then eliminate the column from every other row.
    const pivVal = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pivVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Compute the 3×3 homography mapping the 4 `src` points onto the 4 `dst` points.
 * Fixes h33 = 1 and solves the remaining 8 unknowns exactly.
 * For calibration we call getPerspectiveTransform(COURT_CORNERS, imagePoints).
 */
export function getPerspectiveTransform(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('getPerspectiveTransform needs exactly 4 point correspondences.');
  }
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -X * u, -Y * u]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -X * v, -Y * v]); b.push(v);
  }
  const h = solveLinear(A, b); // [h11 h12 h13 h21 h22 h23 h31 h32]
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Analytic inverse of a 3×3 matrix (used to get H⁻¹ from H so the two are exact inverses). */
export function invert3x3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Homography is not invertible.');
  const inv = 1 / det;
  return [
    A * inv,             (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv,             (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv,             (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

/** Apply a homography to a point, with the homogeneous divide. */
export function applyMat3(m: Mat3, x: number, y: number): Pt {
  const w = m[6] * x + m[7] * y + m[8];
  return {
    x: (m[0] * x + m[1] * y + m[2]) / w,
    y: (m[3] * x + m[4] * y + m[5]) / w,
  };
}

/** court(③) -> video intrinsic px(②). All ground graphics go through this. */
export function projectCourtPoint(H: Mat3, courtX: number, courtY: number): Pt {
  return applyMat3(H, courtX, courtY);
}

/** video intrinsic px(②) -> court(③). Used to turn a click (or, later, a tracked foot point) into meters. */
export function unprojectToCourt(Hinv: Mat3, videoX: number, videoY: number): Pt {
  return applyMat3(Hinv, videoX, videoY);
}

/** Sample a circle in COURT space (meters). Projecting these points yields the perspective-correct ellipse. */
export function circleInCourt(cx: number, cy: number, radius: number, segments = 64): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return pts;
}
