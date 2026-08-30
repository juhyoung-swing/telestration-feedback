import { Circle, Group, Line } from 'react-konva';
import type { Pt } from '../../geometry/homography';

/** A line connecting points on the court, with a dot at each end. */
export function Connector({
  points,
  project,
  color = '#00E5FF',
}: {
  points: { courtX: number; courtY: number }[];
  project: (courtX: number, courtY: number) => Pt;
  color?: string;
}) {
  const disp = points.map((p) => project(p.courtX, p.courtY));
  const flat = disp.flatMap((d) => [d.x, d.y]);
  return (
    <Group listening={false}>
      <Line points={flat} stroke={color} strokeWidth={4} lineJoin="round" />
      {disp.map((d, i) => (
        <Circle key={i} x={d.x} y={d.y} radius={5} fill={color} stroke="#000" strokeWidth={1} />
      ))}
    </Group>
  );
}
