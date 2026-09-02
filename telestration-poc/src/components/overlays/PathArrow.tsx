import { Arrow } from 'react-konva';
import type { Pt } from '../../geometry/homography';

// Keep only the first `progress` (0..1) of a flat [x,y,x,y,…] polyline by arc length,
// interpolating the cut on the final segment. Konva's <Arrow> puts its head on the LAST
// point, so a truncated polyline draws the line growing with the arrowhead riding the tip.
// Reverse a flat [x,y,x,y,…] polyline point order.
function reverseFlat(flat: number[]): number[] {
  const out: number[] = [];
  for (let i = flat.length - 2; i >= 0; i -= 2) out.push(flat[i], flat[i + 1]);
  return out;
}

function truncatePolyline(flat: number[], progress: number): number[] {
  const n = flat.length / 2;
  if (progress >= 1 || n < 2) return flat;
  if (progress <= 0) return [];
  let total = 0;
  for (let i = 0; i < n - 1; i++) total += Math.hypot(flat[2 * i + 2] - flat[2 * i], flat[2 * i + 3] - flat[2 * i + 1]);
  const target = total * progress;
  const out = [flat[0], flat[1]];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const x0 = flat[2 * i], y0 = flat[2 * i + 1], x1 = flat[2 * i + 2], y1 = flat[2 * i + 3];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (acc + l >= target) {
      const t = l > 0 ? (target - acc) / l : 1;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      return out;
    }
    acc += l; out.push(x1, y1);
  }
  return out;
}

/**
 * A directional path. `space` decides where the two endpoints live and how they map to the
 * display: 'court' projects court metres onto the floor (perspective); 'screen' maps video px
 * flat. `shape` 'line' is straight; 'arc' bows UP in screen space by `height` × chord length —
 * a 3D-look lob/trajectory that lifts off the floor rather than a flat ground curve.
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
  drawProgress = 1,
  drawReverse = false,
}: {
  space: 'court' | 'screen';
  shape: 'line' | 'arc';
  points: { x: number; y: number }[];
  height?: number;
  dashed?: boolean;
  toDisplay: (space: 'court' | 'screen', x: number, y: number) => Pt; // → display px
  color?: string;
  arrow?: boolean;
  drawProgress?: number; // 0..1 draw-on reveal (1 = fully drawn)
  drawReverse?: boolean; // reveal end→start (head rides toward the start)
}) {
  if (points.length < 2) return null;
  const a = toDisplay(space, points[0].x, points[0].y);
  const b = toDisplay(space, points[points.length - 1].x, points[points.length - 1].y);

  let flat: number[];
  if (shape === 'arc' && Math.abs(height) > 0.001) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const cx = mx, cy = my - chord * height; // control point lifted straight up (screen -y)
    const N = 24;
    flat = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      flat.push(u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y);
    }
  } else {
    flat = [a.x, a.y, b.x, b.y];
  }

  // reverse → reveal from the end; flip the polyline so the head rides toward the start
  const src = drawReverse ? reverseFlat(flat) : flat;
  const drawn = truncatePolyline(src, drawProgress);
  if (drawn.length < 4) return null; // not yet started / too short to draw

  return (
    <Arrow
      points={drawn}
      stroke={color}
      fill={color}
      strokeWidth={4}
      dash={dashed ? [14, 10] : undefined}
      pointerLength={arrow ? 16 : 0}
      pointerWidth={arrow ? 16 : 0}
      lineJoin="round"
      lineCap="round"
      listening={false}
    />
  );
}
