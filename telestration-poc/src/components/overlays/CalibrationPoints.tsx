import { Circle, Group, Text } from 'react-konva';
import type { Pt } from '../../geometry/homography';

/**
 * Renders the calibration corners (in VIDEO px) as numbered markers.
 * `draft` = points still being collected; `committed` = the stored 4-point set.
 */
export function CalibrationPoints({
  points,
  toDisplay,
  committed = false,
}: {
  points: Pt[]; // video intrinsic px
  toDisplay: (p: Pt) => Pt; // video -> display px
  committed?: boolean;
}) {
  const color = committed ? '#A8D93A' : '#CCFF00'; // tennis-ball optic yellow-green
  return (
    <>
      {points.map((p, i) => {
        const d = toDisplay(p);
        return (
          <Group key={i} listening={false}>
            <Circle x={d.x} y={d.y} radius={6} fill={color} stroke="#000" strokeWidth={1.5} />
            <Text
              x={d.x + 10}
              y={d.y - 9}
              text={String(i + 1)}
              fontSize={17}
              fontStyle="bold"
              fill={color}
              stroke="#000"
              strokeWidth={0.6}
            />
          </Group>
        );
      })}
    </>
  );
}
