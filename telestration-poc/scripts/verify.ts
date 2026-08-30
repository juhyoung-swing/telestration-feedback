// Manual geometry verification. Run: `npm run verify`
// Proves the homography solver, its inverse, round-trips, and the perspective
// property — no browser needed.
import {
  getPerspectiveTransform,
  invert3x3,
  applyMat3,
  projectCourtPoint,
  unprojectToCourt,
} from '../src/geometry/homography';
import { COURT_CORNERS, courtLines, NET_Y, DOUBLES_WIDTH, CENTER_X } from '../src/geometry/court';
import { COURT_LINE_DEFS, courtLineDef, fitImageLine, homographyFromLines, type Line3 } from '../src/geometry/lineCalib';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}  ${detail}`);
  }
}
function approx(name: string, a: number, b: number, tol = 1e-6) {
  check(name, Math.abs(a - b) <= tol, `(${a} vs ${b}, tol ${tol})`);
}
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

// A realistic fixed-camera trapezoid in a 1920×1080 frame:
// far edge (top) short, near edge (bottom) wide — classic elevated baseline view.
const IMG = [
  { x: 705, y: 120 }, // far-left
  { x: 1240, y: 120 }, // far-right
  { x: 1810, y: 980 }, // near-right
  { x: 130, y: 980 }, // near-left
];

console.log('\n[1] getPerspectiveTransform maps each court corner exactly onto its image point');
const H = getPerspectiveTransform(COURT_CORNERS, IMG);
for (let i = 0; i < 4; i++) {
  const p = projectCourtPoint(H, COURT_CORNERS[i].x, COURT_CORNERS[i].y);
  approx(`corner ${i + 1} x`, p.x, IMG[i].x, 1e-6);
  approx(`corner ${i + 1} y`, p.y, IMG[i].y, 1e-6);
}

console.log('\n[2] H⁻¹ is an exact inverse (project ∘ unproject = identity)');
const Hinv = invert3x3(H);
for (const p of [
  { x: 400, y: 300 },
  { x: 1600, y: 900 },
  { x: 960, y: 540 },
]) {
  const court = applyMat3(Hinv, p.x, p.y); // video -> court
  const back = applyMat3(H, court.x, court.y); // court -> video
  approx(`img (${p.x},${p.y}) round-trip x`, back.x, p.x, 1e-6);
  approx(`img (${p.x},${p.y}) round-trip y`, back.y, p.y, 1e-6);
}

console.log('\n[3] court round-trip (unproject ∘ project = identity)');
for (const c of [
  { x: 0, y: 0 },
  { x: DOUBLES_WIDTH, y: 0 },
  { x: CENTER_X, y: NET_Y },
  { x: 3.2, y: 17.5 },
]) {
  const img = projectCourtPoint(H, c.x, c.y);
  const rt = unprojectToCourt(Hinv, img.x, img.y);
  approx(`court (${c.x},${c.y}) x`, rt.x, c.x, 1e-6);
  approx(`court (${c.x},${c.y}) y`, rt.y, c.y, 1e-6);
}

console.log('\n[4] perspective property: the near baseline is WIDER in pixels than the far baseline');
const farL = projectCourtPoint(H, 0, 0);
const farR = projectCourtPoint(H, DOUBLES_WIDTH, 0);
const nearL = projectCourtPoint(H, 0, 23.77);
const nearR = projectCourtPoint(H, DOUBLES_WIDTH, 23.77);
const farW = dist(farL.x, farL.y, farR.x, farR.y);
const nearW = dist(nearL.x, nearL.y, nearR.x, nearR.y);
check(`near (${nearW.toFixed(1)}px) > far (${farW.toFixed(1)}px)`, nearW > farW);

console.log('\n[5] all debug court lines project to finite pixels');
let finite = true;
for (const ln of courtLines()) {
  for (const p of ln.points) {
    const d = projectCourtPoint(H, p.x, p.y);
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) finite = false;
  }
}
check('every projected court-line vertex is finite', finite);

console.log('\n[6] a court circle projects to a non-degenerate, perspective-distorted polygon');
// halo at the net center, r = 0.8m; its projected vertical extent (top vs bottom of
// the circle in court y) should differ from a screen circle — just assert it has area.
const top = projectCourtPoint(H, CENTER_X, NET_Y - 0.8);
const bot = projectCourtPoint(H, CENTER_X, NET_Y + 0.8);
const left = projectCourtPoint(H, CENTER_X - 0.8, NET_Y);
const right = projectCourtPoint(H, CENTER_X + 0.8, NET_Y);
const vExtent = dist(top.x, top.y, bot.x, bot.y);
const hExtent = dist(left.x, left.y, right.x, right.y);
check(`halo has vertical extent (${vExtent.toFixed(1)}px) and horizontal extent (${hExtent.toFixed(1)}px)`, vExtent > 1 && hExtent > 1);

// --- line-based calibration -------------------------------------------------
// Simulate "clicking 2 points along a court line": sample 2 court points on the
// line, project through the ground-truth H, fit an image line through them.
function courtPointsOnLine(vec: Line3, family: string): { x: number; y: number }[] {
  if (family === 'horizontal') { const y = -vec[2]; return [{ x: 2, y }, { x: 9, y }]; }
  const x = -vec[2]; return [{ x, y: 3 }, { x, y: 20 }];
}
function imageLineFor(id: string, HH: number[], noiseFn?: (k: number) => number): Line3 {
  const def = courtLineDef(id);
  const pts = courtPointsOnLine(def.vec, def.family).map((c, j) => {
    const p = projectCourtPoint(HH, c.x, c.y);
    const n = noiseFn ? noiseFn(j) : 0;
    return { x: p.x + n, y: p.y - n };
  });
  return fitImageLine(pts);
}

console.log('\n[7] line-based homography recovers H from the 4 perimeter lines (no corner clicks)');
{
  const perim = ['far-baseline', 'near-baseline', 'left-doubles', 'right-doubles'];
  const corr = perim.map((id) => ({ court: courtLineDef(id).vec, image: imageLineFor(id, H) }));
  const Hl = homographyFromLines(corr, 1920, 1080);
  for (let i = 0; i < 4; i++) {
    const a = projectCourtPoint(H, COURT_CORNERS[i].x, COURT_CORNERS[i].y);
    const b = projectCourtPoint(Hl, COURT_CORNERS[i].x, COURT_CORNERS[i].y);
    approx(`corner ${i + 1} x`, b.x, a.x, 1e-2);
    approx(`corner ${i + 1} y`, b.y, a.y, 1e-2);
  }
}

console.log('\n[8] over-determined (all 10 lines) + click noise stays accurate');
{
  const noise = (di: number) => (k: number) => (((di * 7 + k * 13) % 11) - 5) * 0.5; // ±2.5px, deterministic
  const corr = COURT_LINE_DEFS.map((def, di) => ({ court: def.vec, image: imageLineFor(def.id, H, noise(di)) }));
  const Hn = homographyFromLines(corr, 1920, 1080);
  let maxErr = 0;
  for (let i = 0; i < 4; i++) {
    const a = projectCourtPoint(H, COURT_CORNERS[i].x, COURT_CORNERS[i].y);
    const b = projectCourtPoint(Hn, COURT_CORNERS[i].x, COURT_CORNERS[i].y);
    maxErr = Math.max(maxErr, dist(a.x, a.y, b.x, b.y));
  }
  check(`max corner reprojection error under noise = ${maxErr.toFixed(2)}px (< 12px)`, maxErr < 12);
}

console.log('\n[9] off-screen corner is recovered from lines (far-left at x<0)');
{
  const IMG2 = [
    { x: -140, y: 135 }, // far-left corner OFF-SCREEN
    { x: 1240, y: 120 },
    { x: 1810, y: 980 },
    { x: 130, y: 980 },
  ];
  const H2 = getPerspectiveTransform(COURT_CORNERS, IMG2);
  // recover from lines whose sampled points we still fit (corner never clicked)
  const corr = COURT_LINE_DEFS.map((def) => ({ court: def.vec, image: imageLineFor(def.id, H2) }));
  const H2l = homographyFromLines(corr, 1920, 1080);
  const truth = projectCourtPoint(H2, 0, 0); // the off-screen corner
  const got = projectCourtPoint(H2l, 0, 0);
  check(`recovered off-screen far-left ≈ (${got.x.toFixed(1)}, ${got.y.toFixed(1)}) vs truth (${truth.x.toFixed(1)}, ${truth.y.toFixed(1)})`,
    dist(truth.x, truth.y, got.x, got.y) < 1);
  check('and it is genuinely off-screen (x < 0)', got.x < 0);
}

console.log('');
if (failures === 0) {
  console.log('ALL GEOMETRY CHECKS PASSED ✅\n');
  process.exit(0);
} else {
  console.error(`${failures} CHECK(S) FAILED ❌\n`);
  process.exit(1);
}
