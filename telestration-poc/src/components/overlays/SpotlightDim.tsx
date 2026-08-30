import { Group, Rect, Line } from 'react-konva';
import { footAt } from '../../geometry/tracking';
import { circleInCourt, unprojectToCourt } from '../../geometry/homography';
import type { Mat3, Pt } from '../../geometry/homography';
import type { Players, Spotlight } from '../../types';

/**
 * Spotlight = dim the whole frame, then a bright light CONE over each player: a
 * ground light-pool (elliptical base) with the cone flaring UP from the pool's
 * edges to a wider top — one cohesive cone, not a beam + separate puddle. The cone
 * column is revealed (destination-out) from the dim and given a white gradient glow.
 * Size scales with court depth (near player = bigger). Must be the FIRST Layer child.
 */
export function SpotlightDim({
  spotlights,
  players,
  inverseH,
  currentTime,
  project,
  width,
  height,
  dim = 0.6,
}: {
  spotlights: Spotlight[];
  players: Players | null;
  inverseH: Mat3;
  currentTime: number;
  project: (courtX: number, courtY: number) => Pt;
  width: number;
  height: number;
  dim?: number;
}) {
  const beams = spotlights.map((o) => {
    const foot = players ? footAt(players[o.trackId] ?? [], currentTime) : null;
    if (!foot) return null;
    const c = unprojectToCourt(inverseH, foot[0], foot[1]);
    // ground pool = projected court circle (the elliptical base)
    const poolPts = circleInCourt(c.x, c.y, 1.3, 44).map((p) => project(p.x, p.y));
    const xs = poolPts.map((p) => p.x), ys = poolPts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2, yc = (minY + maxY) / 2, baseHalf = (maxX - minX) / 2;
    // cone flares from the pool edges (base) UP to a wider top → one cohesive cone
    const beamH = baseHalf * 6, topHalf = baseHalf * 1.7, apexY = minY - beamH;
    const cone = [minX, yc, cx - topHalf, apexY, cx + topHalf, apexY, maxX, yc];
    const pool = poolPts.flatMap((p) => [p.x, p.y]);
    return { id: o.id, cone, pool, top: apexY, bottom: maxY };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <Group listening={false}>
      <Rect x={0} y={0} width={width} height={height} fill={`rgba(0,0,0,${dim})`} />
      {/* reveal video: cone column (hazy) then the ground pool (crisp) */}
      {beams.map((b) => <Line key={`${b.id}-hole`} points={b.cone} closed fill="rgba(0,0,0,0.82)" globalCompositeOperation="destination-out" listening={false} />)}
      {beams.map((b) => <Line key={`${b.id}-pool`} points={b.pool} closed fill="rgba(0,0,0,1)" globalCompositeOperation="destination-out" listening={false} />)}
      {/* white gradient glow — brighter at the top (light source), fading down */}
      {beams.map((b) => (
        <Line
          key={`${b.id}-glow`}
          points={b.cone}
          closed
          listening={false}
          fillLinearGradientStartPoint={{ x: 0, y: b.top }}
          fillLinearGradientEndPoint={{ x: 0, y: b.bottom }}
          fillLinearGradientColorStops={[0, 'rgba(255,255,255,0.32)', 1, 'rgba(255,255,255,0.03)']}
        />
      ))}
    </Group>
  );
}
