import { Line } from 'react-konva';
import type { Pt } from '../../geometry/homography';

/**
 * A freehand pen stroke: a flat, screen-space polyline drawn straight on the frame
 * (video px → display via `toDisplay`). Smoothed with tension + round caps/joins so
 * it reads like a telestrator pen. Not projected onto the court.
 */
export function FreehandLine({
  points,
  toDisplay,
  color = '#FFD400',
  width = 4,
}: {
  points: { x: number; y: number }[];
  toDisplay: (p: Pt) => Pt;
  color?: string;
  width?: number;
}) {
  if (points.length < 2) return null;
  const flat = points.flatMap((p) => { const d = toDisplay(p); return [d.x, d.y]; });
  return (
    <Line
      points={flat}
      stroke={color}
      strokeWidth={width}
      lineCap="round"
      lineJoin="round"
      tension={0.4}
      listening={false}
      shadowColor="#000"
      shadowBlur={3}
      shadowOpacity={0.45}
    />
  );
}
