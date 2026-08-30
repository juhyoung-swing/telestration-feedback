import { Group, Rect, Text } from 'react-konva';
import type { Pt } from '../../geometry/homography';

/** A text label anchored to a court point, with a dark chip for readability. */
export function TextLabel({
  courtX,
  courtY,
  text,
  project,
  color = '#FFFFFF',
  fontSize = 20,
}: {
  courtX: number;
  courtY: number;
  text: string;
  project: (courtX: number, courtY: number) => Pt;
  color?: string;
  fontSize?: number;
}) {
  const d = project(courtX, courtY);
  const pad = 7;
  const w = Math.max(24, text.length * fontSize * 0.62) + pad * 2;
  const h = fontSize + pad * 2;
  return (
    <Group listening={false}>
      <Rect x={d.x - w / 2} y={d.y - h / 2} width={w} height={h} fill="rgba(0,0,0,0.55)" cornerRadius={5} />
      <Text x={d.x - w / 2} y={d.y - fontSize / 2} width={w} align="center" text={text} fontSize={fontSize} fontStyle="bold" fill={color} />
    </Group>
  );
}
