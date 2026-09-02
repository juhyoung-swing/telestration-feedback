import { Line } from 'react-konva';
import type { Pt } from '../../geometry/homography';
import { hexToRgba } from '../../utils/color';
import { truncatePolyline, reverseFlat } from '../../lib/polyline';

/**
 * A filled radial sector (fan) lying on the court floor: a wedge of `spread`
 * degrees pointing at `dir`, out to `radiusM` metres from the centre. Vertices
 * are sampled in court metres (centre + arc) and projected through H, so the
 * shape follows the court perspective — like CoverageZone but arc-generated.
 *
 * Draw-on: the outline (centre → radius → around the arc → back) reveals with progress
 * while the fill fades in; full filled fan at ≥1.
 */
export function Sector({
  courtX, courtY, radiusM, dir, spread,
  project, color = '#7C5CFF', opacity = 0.22,
  drawProgress = 1, drawReverse = false,
}: {
  courtX: number; courtY: number; radiusM: number; dir: number; spread: number;
  project: (courtX: number, courtY: number) => Pt;
  color?: string; opacity?: number;
  drawProgress?: number; drawReverse?: boolean;
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

  if (drawProgress < 1) {
    if (drawProgress <= 0) return null;
    const outline = [...flat, c.x, c.y]; // close back to the centre for the reveal
    const loop = drawReverse ? reverseFlat(outline) : outline;
    const arc = truncatePolyline(loop, drawProgress);
    return (
      <>
        <Line points={flat} closed fill={hexToRgba(color, opacity * drawProgress)} listening={false} />
        {arc.length >= 4 && (
          <Line points={arc} stroke={color} strokeWidth={3} lineJoin="round" lineCap="round" listening={false} />
        )}
      </>
    );
  }

  return (
    <Line points={flat} closed fill={hexToRgba(color, opacity)} stroke={color} strokeWidth={3} lineJoin="round" listening={false} />
  );
}
