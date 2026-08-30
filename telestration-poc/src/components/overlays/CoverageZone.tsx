import { Line } from 'react-konva';
import type { Pt } from '../../geometry/homography';
import { hexToRgba } from '../../utils/color';

/**
 * A polygon lying on the court floor. Only court-space vertices are stored; the
 * screen polygon is derived by projecting each vertex through H, so it conforms
 * to the court perspective.
 */
export function CoverageZone({
  points,
  project,
  closed = true,
  color = '#17335F',
  opacity = 0.18,
}: {
  points: { courtX: number; courtY: number }[];
  project: (courtX: number, courtY: number) => Pt; // court -> display px
  closed?: boolean;
  color?: string;
  opacity?: number;
}) {
  const flat: number[] = [];
  for (const p of points) {
    const d = project(p.courtX, p.courtY);
    flat.push(d.x, d.y);
  }
  return (
    <Line
      points={flat}
      closed={closed}
      fill={closed ? hexToRgba(color, opacity) : undefined}
      stroke={color}
      strokeWidth={4}
      lineJoin="round"
      listening={false}
    />
  );
}
