import { Line } from 'react-konva';
import type { Pt } from '../../geometry/homography';
import { hexToRgba } from '../../utils/color';

/**
 * A filled radial sector (fan) lying on the court floor: a wedge of `spread`
 * degrees pointing at `dir`, out to `radiusM` metres from the centre. Vertices
 * are sampled in court metres (centre + arc) and projected through H, so the
 * shape follows the court perspective — like CoverageZone but arc-generated.
 */
export function Sector({
  courtX, courtY, radiusM, dir, spread,
  project, color = '#7C5CFF', opacity = 0.22,
}: {
  courtX: number; courtY: number; radiusM: number; dir: number; spread: number;
  project: (courtX: number, courtY: number) => Pt;
  color?: string; opacity?: number;
}) {
  const a0 = ((dir - spread / 2) * Math.PI) / 180;
  const a1 = ((dir + spread / 2) * Math.PI) / 180;
  const N = 24;
  const c = project(courtX, courtY);
  const flat: number[] = [c.x, c.y];
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    const p = project(courtX + radiusM * Math.cos(a), courtY + radiusM * Math.sin(a));
    flat.push(p.x, p.y);
  }
  return (
    <Line points={flat} closed fill={hexToRgba(color, opacity)} stroke={color} strokeWidth={3} lineJoin="round" listening={false} />
  );
}
