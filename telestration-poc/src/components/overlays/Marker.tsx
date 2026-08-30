import { Circle } from 'react-konva';
import type { Pt } from '../../geometry/homography';

/** A point marker on the court (a dot with a white ring). */
export function Marker({
  courtX,
  courtY,
  project,
  color = '#FF3B3B',
}: {
  courtX: number;
  courtY: number;
  project: (courtX: number, courtY: number) => Pt;
  color?: string;
}) {
  const d = project(courtX, courtY);
  return (
    <>
      <Circle x={d.x} y={d.y} radius={9} fill={color} stroke="#fff" strokeWidth={2.5} listening={false} />
      <Circle x={d.x} y={d.y} radius={3} fill="#fff" listening={false} />
    </>
  );
}
