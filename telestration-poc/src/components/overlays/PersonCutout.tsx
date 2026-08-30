import { Line } from 'react-konva';
import { hexToRgba } from '../../utils/color';
import type { Pt } from '../../geometry/homography';

/** A person cutout — the player's silhouette polygon (video px) as a colored outline. */
export function PersonCutout({
  poly,
  toDisplay,
  color = '#E4EF3D',
}: {
  poly: [number, number][];
  toDisplay: (p: Pt) => Pt;
  color?: string;
}) {
  const flat: number[] = [];
  for (const [x, y] of poly) {
    const d = toDisplay({ x, y });
    flat.push(d.x, d.y);
  }
  return (
    <Line points={flat} closed fill={hexToRgba(color, 0.16)} stroke={color} strokeWidth={3} lineJoin="round" listening={false} />
  );
}
