import { Line } from 'react-konva';
import { circleInCourt } from '../../geometry/homography';
import type { Pt } from '../../geometry/homography';
import { hexToRgba } from '../../utils/color';

/**
 * A halo lying on the court floor.
 *
 * The circle is defined in COURT meters and sampled into 64 points; each point is
 * projected to the screen, so the rendered polygon is automatically perspective-
 * distorted (a ground circle reads as a tilted ellipse). We never draw a screen
 * ellipse.
 *
 * `courtX`/`courtY` are props so a tracked player position can drive it later:
 *   <GroundHalo courtX={player.x} courtY={player.y} radiusMeters={0.8} project={...} />
 *
 * Perspective is kept (near = big, far = small), but a far halo never renders below
 * `minScreenRadius` on screen — it's scaled up around its centroid so it stays
 * visible while keeping its tilted-ellipse shape.
 */
export function GroundHalo({
  courtX,
  courtY,
  radiusMeters,
  project,
  color = '#E4EF3D',
  opacity = 0.2,
  minScreenRadius = 20,
}: {
  courtX: number;
  courtY: number;
  radiusMeters: number;
  project: (courtX: number, courtY: number) => Pt; // court -> display px
  color?: string;
  opacity?: number;
  minScreenRadius?: number;
}) {
  const flat: number[] = [];
  for (const p of circleInCourt(courtX, courtY, radiusMeters, 64)) {
    const d = project(p.x, p.y);
    flat.push(d.x, d.y);
  }
  // Floor the on-screen size so far halos don't vanish (keeps shape/orientation).
  const n = flat.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < flat.length; i += 2) { cx += flat[i]; cy += flat[i + 1]; }
  cx /= n; cy /= n;
  let maxD = 0;
  for (let i = 0; i < flat.length; i += 2) maxD = Math.max(maxD, Math.hypot(flat[i] - cx, flat[i + 1] - cy));
  if (maxD > 0 && maxD < minScreenRadius) {
    const s = minScreenRadius / maxD;
    for (let i = 0; i < flat.length; i += 2) {
      flat[i] = cx + (flat[i] - cx) * s;
      flat[i + 1] = cy + (flat[i + 1] - cy) * s;
    }
  }
  return (
    <Line
      points={flat}
      closed
      fill={hexToRgba(color, opacity)}
      stroke={color}
      strokeWidth={4}
      lineJoin="round"
      listening={false}
    />
  );
}
