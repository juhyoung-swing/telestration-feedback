import { Arrow } from 'react-konva';
import type { Pt } from '../../geometry/homography';

/** A path on the court, drawn as a polyline with an arrowhead at the end. */
export function PathArrow({
  points,
  project,
  color = '#FF3B3B',
  arrow = true,
}: {
  points: { courtX: number; courtY: number }[];
  project: (courtX: number, courtY: number) => Pt;
  color?: string;
  arrow?: boolean;
}) {
  const flat: number[] = [];
  for (const p of points) {
    const d = project(p.courtX, p.courtY);
    flat.push(d.x, d.y);
  }
  return (
    <Arrow
      points={flat}
      stroke={color}
      fill={color}
      strokeWidth={4}
      pointerLength={arrow ? 15 : 0}
      pointerWidth={arrow ? 15 : 0}
      lineJoin="round"
      listening={false}
    />
  );
}
