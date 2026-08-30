import { Circle, Group, Line, Text } from 'react-konva';
import { fitImageLine, lineSegmentInRect, courtLineDef } from '../../geometry/lineCalib';
import type { Pt } from '../../geometry/homography';
import type { DrawnLine } from '../../types';

// Renders the lines drawn during line-calibration: each set of clicked points, plus
// the fitted line extended across the frame so the user can see it lying on the real
// court line. Committed = cyan, the line being drawn now = yellow.
export function CalibLines({
  drawnLines,
  lineDraft,
  activeLineId,
  toDisplay,
  videoW,
  videoH,
}: {
  drawnLines: DrawnLine[];
  lineDraft: Pt[];
  activeLineId: string | null;
  toDisplay: (p: Pt) => Pt;
  videoW: number;
  videoH: number;
}) {
  const fittedLine = (points: Pt[], color: string, keyBase: string, label?: string) => {
    if (points.length < 2) return null;
    const seg = lineSegmentInRect(fitImageLine(points), videoW, videoH);
    if (!seg) return null;
    const a = toDisplay(seg[0]);
    const b = toDisplay(seg[1]);
    const anchor = toDisplay(points[points.length - 1]);
    return (
      <Group key={keyBase} listening={false}>
        <Line points={[a.x, a.y, b.x, b.y]} stroke={color} strokeWidth={2.5} dash={[10, 6]} opacity={0.95} />
        {label && (
          <Text x={anchor.x + 9} y={anchor.y - 8} text={label} fontSize={13} fontStyle="bold" fill={color} stroke="#000" strokeWidth={0.5} />
        )}
      </Group>
    );
  };

  const dots = (points: Pt[], color: string, keyBase: string, radius: number) =>
    points.map((p, i) => {
      const d = toDisplay(p);
      return <Circle key={`${keyBase}-${i}`} x={d.x} y={d.y} radius={radius} fill={color} stroke="#000" strokeWidth={1} listening={false} />;
    });

  return (
    <>
      {drawnLines.map((dl) => (
        <Group key={dl.id} listening={false}>
          {fittedLine(dl.points, '#00E5FF', `fit-${dl.id}`, courtLineDef(dl.id).label)}
          {dots(dl.points, '#00E5FF', `pt-${dl.id}`, 4)}
        </Group>
      ))}
      {fittedLine(lineDraft, '#FFD400', 'active-fit', activeLineId ? courtLineDef(activeLineId).label : undefined)}
      {dots(lineDraft, '#FFD400', 'draft', 5)}
    </>
  );
}
