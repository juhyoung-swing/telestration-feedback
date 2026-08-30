import { Group, Rect, Text } from 'react-konva';
import { boxesAt, playerColor } from '../../geometry/tracking';
import type { Fragments, PlayerAnchor } from '../../types';
import type { Pt } from '../../geometry/homography';

// During player calibration: draw each detected person's box at the current frame.
// Boxes the user has anchored show in that player's color with a P-label.
export function CalibBoxes({
  fragments,
  frame,
  anchors,
  toDisplay,
}: {
  fragments: Fragments;
  frame: number;
  anchors: PlayerAnchor[];
  toDisplay: (p: Pt) => Pt;
}) {
  const anchorByFrag = new Map(anchors.map((a) => [a.fragId, a.label]));
  return (
    <>
      {boxesAt(fragments, frame).map(({ id, box }) => {
        const [x1, y1, x2, y2] = box;
        const a = toDisplay({ x: x1, y: y1 });
        const b = toDisplay({ x: x2, y: y2 });
        const lab = anchorByFrag.get(id);
        const color = lab ? playerColor(lab) : '#9aa7b8';
        return (
          <Group key={id} listening={false}>
            <Rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} stroke={color} strokeWidth={lab ? 3 : 1.5} dash={lab ? undefined : [6, 4]} />
            {lab && <Text x={a.x} y={a.y - 17} text={`P${lab}`} fill={color} fontSize={16} fontStyle="bold" stroke="#000" strokeWidth={0.5} />}
          </Group>
        );
      })}
    </>
  );
}
