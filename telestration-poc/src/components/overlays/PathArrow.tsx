import { Arrow } from 'react-konva';
import type { Pt } from '../../geometry/homography';

type CourtPt = { courtX: number; courtY: number };

/**
 * A directional path on the court floor. Straight (curvature 0) draws the polyline as-is;
 * a parabola bows by `curvature` metres perpendicular to the start→end chord — sampled as a
 * quadratic Bézier in COURT space, then each sample projected, so the arc stays glued to the floor.
 */
export function PathArrow({
  points,
  curvature = 0,
  project,
  color = '#FF3B3B',
  arrow = true,
}: {
  points: CourtPt[];
  curvature?: number;
  project: (courtX: number, courtY: number) => Pt;
  color?: string;
  arrow?: boolean;
}) {
  let court: CourtPt[];
  if (Math.abs(curvature) < 0.01 || points.length < 2) {
    court = points; // straight: draw the given endpoints (perspective handled by project)
  } else {
    const A = points[0], B = points[points.length - 1];
    const mx = (A.courtX + B.courtX) / 2, my = (A.courtY + B.courtY) / 2;
    const dx = B.courtX - A.courtX, dy = B.courtY - A.courtY;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;               // unit perpendicular to the chord
    const cx = mx + px * curvature, cy = my + py * curvature; // Bézier control point
    const N = 24;
    court = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      court.push({
        courtX: u * u * A.courtX + 2 * u * t * cx + t * t * B.courtX,
        courtY: u * u * A.courtY + 2 * u * t * cy + t * t * B.courtY,
      });
    }
  }

  const flat: number[] = [];
  for (const c of court) {
    const d = project(c.courtX, c.courtY);
    flat.push(d.x, d.y);
  }
  return (
    <Arrow
      points={flat}
      stroke={color}
      fill={color}
      strokeWidth={4}
      pointerLength={arrow ? 16 : 0}
      pointerWidth={arrow ? 16 : 0}
      lineJoin="round"
      lineCap="round"
      listening={false}
    />
  );
}
