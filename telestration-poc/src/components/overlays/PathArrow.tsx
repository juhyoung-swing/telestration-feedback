import { Line } from 'react-konva';
import type { Pt } from '../../geometry/homography';

/**
 * A directional path. `space` decides where the two endpoints live and how they map to the
 * display: 'court' projects court metres onto the floor (perspective); 'screen' maps video px
 * flat. `shape` 'line' is straight; 'arc' bows UP in screen space by `height` × chord length —
 * a 3D-look lob/trajectory that lifts off the floor rather than a flat ground curve.
 *
 * The arrowhead is drawn by hand (not Konva's <Arrow>) so it can be: aligned to the TRUE end
 * tangent (an arc's tip follows the bezier tangent, not the last tiny polyline segment),
 * kept sharp (length > width), and scaled by perspective — a court arrow's head shrinks as the
 * tip recedes, matching the floor's px-per-metre there.
 */
export function PathArrow({
  space,
  shape,
  points,
  height = 0,
  dashed = false,
  toDisplay,
  color = '#FF3B3B',
  arrow = true,
}: {
  space: 'court' | 'screen';
  shape: 'line' | 'arc';
  points: { x: number; y: number }[];
  height?: number;
  dashed?: boolean;
  toDisplay: (space: 'court' | 'screen', x: number, y: number) => Pt; // → display px
  color?: string;
  arrow?: boolean;
}) {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const a = toDisplay(space, start.x, start.y);
  const b = toDisplay(space, end.x, end.y);
  const isArc = shape === 'arc' && Math.abs(height) > 0.001;

  // Screen-space control point (arc) + the exact end tangent direction at the tip b.
  let cx = 0, cy = 0;
  let dirX: number, dirY: number;
  if (isArc) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    cx = mx; cy = my - chord * height; // control lifted straight up (screen -y)
    dirX = b.x - cx; dirY = b.y - cy;  // quadratic bezier tangent at t=1 ∝ (b − control)
  } else {
    dirX = b.x - a.x; dirY = b.y - a.y;
  }
  const dlen = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / dlen, uy = dirY / dlen; // unit tangent at the tip

  // Perspective-aware head size: for a floor (court) arrow, size the head to the local
  // px-per-metre at the tip so a receding arrow gets a smaller head. Screen arrows are flat.
  let headLen = 16;
  if (arrow && space === 'court') {
    let tdx = end.x - start.x, tdy = end.y - start.y;
    const tl = Math.hypot(tdx, tdy) || 1; tdx /= tl; tdy /= tl; // travel dir in court metres
    const p1 = toDisplay('court', end.x, end.y);
    const p2 = toDisplay('court', end.x - tdx, end.y - tdy); // one metre back along the path, at the tip
    const pxPerM = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (pxPerM > 0.001) headLen = pxPerM * 0.5; // ~0.5 m arrowhead
  }
  headLen = Math.max(8, Math.min(26, headLen)); // never vanish, never dominate
  const headW = headLen * 0.6; // length > width → sharp (was a blunt 16×16 square)

  const strokeWidth = 4;
  // Shaft stops just inside the head so its round cap never pokes past the sharp tip.
  const stopBack = arrow ? Math.min(headLen * 0.9, headLen - strokeWidth * 0.5) : 0;
  const stop: Pt = { x: b.x - ux * stopBack, y: b.y - uy * stopBack };

  let flat: number[];
  if (isArc) {
    const N = 24;
    flat = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      flat.push(u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y);
    }
    flat[flat.length - 2] = stop.x; flat[flat.length - 1] = stop.y; // hide the tip under the head
  } else {
    flat = [a.x, a.y, stop.x, stop.y];
  }

  // Arrowhead triangle: tip at b, base a headLen back along −tangent, corners ±headW/2 perpendicular.
  const perpX = -uy, perpY = ux;
  const baseX = b.x - ux * headLen, baseY = b.y - uy * headLen;
  const head = [
    b.x, b.y,
    baseX + perpX * headW / 2, baseY + perpY * headW / 2,
    baseX - perpX * headW / 2, baseY - perpY * headW / 2,
  ];

  return (
    <>
      <Line
        points={flat}
        stroke={color}
        strokeWidth={strokeWidth}
        dash={dashed ? [14, 10] : undefined}
        lineJoin="round"
        lineCap="round"
        listening={false}
      />
      {arrow && (
        <Line points={head} closed fill={color} stroke={color} strokeWidth={1} lineJoin="round" listening={false} />
      )}
    </>
  );
}
