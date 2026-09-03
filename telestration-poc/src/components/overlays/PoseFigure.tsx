import { Arc, Circle, Line, Text } from 'react-konva';
import type { Pt } from '../../geometry/homography';
import type { PoseAngleId } from '../../types';
import { SKELETON_EDGES, MIN_SCORE, computeAngles, type PoseFrame } from '../../lib/pose';

// Draw a player's skeleton (bones + joints) and annotate the selected joint angles.
// Keypoints arrive in video px; `toDisplay` maps them to the overlay's display px.
export function PoseFigure({
  frame, toDisplay, color = '#E4EF3D', skeleton, angles, side, selected,
}: {
  frame: PoseFrame;
  toDisplay: (p: Pt) => Pt;
  color?: string;
  skeleton: boolean;
  angles: PoseAngleId[];
  side: 'left' | 'right';
  selected: boolean;
}) {
  const pts = frame.pts.map((k) => ({ ...toDisplay(k), score: k.score }));
  const w = selected ? 4 : 3;

  return (
    <>
      {skeleton && SKELETON_EDGES.map(([a, b], i) => {
        const pa = pts[a], pb = pts[b];
        if (pa.score < MIN_SCORE || pb.score < MIN_SCORE) return null;
        return (
          <Line key={`e${i}`} points={[pa.x, pa.y, pb.x, pb.y]} stroke={color} strokeWidth={w}
            lineCap="round" listening={false} shadowColor="#000" shadowBlur={selected ? 6 : 3} shadowOpacity={0.55} />
        );
      })}
      {skeleton && pts.map((p, i) => (p.score < MIN_SCORE ? null : (
        <Circle key={`j${i}`} x={p.x} y={p.y} radius={selected ? 4 : 3} fill="#fff" stroke={color} strokeWidth={1.5} listening={false} />
      )))}

      {computeAngles(frame, side, angles).map((an) => {
        const label = `${Math.round(an.value)}°`;
        if (!an.arc) return null;
        const c = toDisplay(an.arc.center), f = toDisplay(an.arc.from), t = toDisplay(an.arc.to);
        const a1 = Math.atan2(f.y - c.y, f.x - c.x) * 180 / Math.PI;
        const a2 = Math.atan2(t.y - c.y, t.x - c.x) * 180 / Math.PI;
        let sweep = ((a2 - a1 + 540) % 360) - 180; // → [-180,180]
        const rot = sweep >= 0 ? a1 : a2;
        sweep = Math.abs(sweep);
        const R = 26;
        const bis = ((rot + sweep / 2) * Math.PI) / 180;
        const lx = c.x + Math.cos(bis) * (R + 16), ly = c.y + Math.sin(bis) * (R + 16);
        return (
          <PoseAngle key={an.id} cx={c.x} cy={c.y} R={R} rot={rot} sweep={sweep} color={color}
            label={label} lx={lx} ly={ly} />
        );
      })}
    </>
  );
}

function PoseAngle({ cx, cy, R, rot, sweep, color, label, lx, ly }: {
  cx: number; cy: number; R: number; rot: number; sweep: number; color: string; label: string; lx: number; ly: number;
}) {
  return (
    <>
      <Arc x={cx} y={cy} innerRadius={R - 2.5} outerRadius={R} angle={sweep} rotation={rot}
        fill={color} opacity={0.95} listening={false} shadowColor="#000" shadowBlur={3} shadowOpacity={0.5} />
      <Text x={lx - 26} y={ly - 9} width={52} align="center" text={label} fontSize={14} fontStyle="bold"
        fill="#fff" listening={false} shadowColor="#000" shadowBlur={4} shadowOpacity={0.9} />
    </>
  );
}
