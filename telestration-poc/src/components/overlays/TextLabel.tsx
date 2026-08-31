import { Group, Rect, Text } from 'react-konva';
import type { Pt } from '../../geometry/homography';
import { hexToRgba } from '../../utils/color';

/** A resizable text box anchored (top-left) to a court point. Text wraps to the box width. */
export function TextLabel({
  courtX,
  courtY,
  text,
  project,
  color = '#FFFFFF',
  fontSize = 20,
  fontFamily = 'sans-serif',
  bold = true,
  align = 'center',
  boxW = 180,
  boxH = 52,
  bg = true,
  bgColor = '#000000',
  bgOpacity = 0.55,
}: {
  courtX: number;
  courtY: number;
  text: string;
  project: (courtX: number, courtY: number) => Pt;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  boxW?: number;
  boxH?: number;
  bg?: boolean;
  bgColor?: string;
  bgOpacity?: number;
}) {
  const d = project(courtX, courtY); // top-left
  const pad = 8;
  return (
    <Group listening={false}>
      {bg && <Rect x={d.x} y={d.y} width={boxW} height={boxH} fill={hexToRgba(bgColor, bgOpacity)} cornerRadius={6} />}
      <Text
        x={d.x + pad} y={d.y}
        width={boxW - pad * 2} height={boxH}
        text={text}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fontStyle={bold ? 'bold' : 'normal'}
        align={align}
        verticalAlign="middle"
        wrap="word"
        fill={color}
        listening={false}
      />
    </Group>
  );
}
