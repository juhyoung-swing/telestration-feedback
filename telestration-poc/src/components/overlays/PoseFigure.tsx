import { Arc, Circle, Line, Text } from 'react-konva';
import type { Pt } from '../../geometry/homography';
import type { PoseAngleDisplay, PoseAngleId } from '../../types';
import { SKELETON_EDGES, MIN_SCORE, computeAngles, trailPath, inTarget, type PoseFrame } from '../../lib/pose';
import type { PoseSample } from '../../types';

const GREEN = '#3ddc84', RED = '#ff5a5a';

// Draw a player's skeleton (bones + joints), annotate joint angles (with optional
// target-range coloring), and optionally trace a joint's path (swing trail).
// Keypoints arrive in video px; `toDisplay` maps them to the overlay's display px.
export function PoseFigure({
  frame, samples, trailEndT, toDisplay, color = '#E4EF3D', skeleton, angles, side, selected,
  strokeWidth = 3, opacity = 1, showJoints = true, jointSize = 3,
  angleDisplay = 'both', angleFontSize = 14, targets, trailJoint, trailSec = 1.2,
}: {
  frame: PoseFrame;
  samples?: PoseSample[];
  trailEndT?: number;
  toDisplay: (p: Pt) => Pt;
  color?: string;
  skeleton: boolean;
  angles: PoseAngleId[];
  side: 'left' | 'right';
  selected: boolean;
  strokeWidth?: number;
  opacity?: number;
  showJoints?: boolean;
  jointSize?: number;
  angleDisplay?: PoseAngleDisplay;
  angleFontSize?: number;
  targets?: Partial<Record<PoseAngleId, [number, number]>>;
  trailJoint?: number | null;
  trailSec?: number;
}) {
  const pts = frame.pts.map((k) => ({ ...toDisplay(k), score: k.score }));
  const w = strokeWidth + (selected ? 1 : 0);

  // swing trail: the chosen joint's path over the last `trailSec` seconds
  let trail: number[] = [];
  if (trailJoint != null && samples && trailEndT != null) {
    const raw = trailPath(samples, trailJoint, trailEndT - trailSec, trailEndT);
    trail = raw.flatMap((p) => { const d = toDisplay(p); return [d.x, d.y]; });
  }

  return (
    <>
      {trail.length >= 4 && (
        <Line points={trail} stroke={color} strokeWidth={Math.max(2, strokeWidth - 1)} opacity={0.85}
          lineCap="round" lineJoin="round" listening={false} shadowColor="#000" shadowBlur={3} shadowOpacity={0.5} />
      )}

      {skeleton && SKELETON_EDGES.map(([a, b], i) => {
        const pa = pts[a], pb = pts[b];
        if (pa.score < MIN_SCORE || pb.score < MIN_SCORE) return null;
        return (
          <Line key={`e${i}`} points={[pa.x, pa.y, pb.x, pb.y]} stroke={color} strokeWidth={w} opacity={opacity}
            lineCap="round" listening={false} shadowColor="#000" shadowBlur={selected ? 6 : 3} shadowOpacity={0.55} />
        );
      })}
      {skeleton && showJoints && pts.map((p, i) => (p.score < MIN_SCORE ? null : (
        <Circle key={`j${i}`} x={p.x} y={p.y} radius={jointSize + (selected ? 1 : 0)} fill="#fff" stroke={color} strokeWidth={1.5} opacity={opacity} listening={false} />
      )))}

      {computeAngles(frame, side, angles).map((an) => {
        if (!an.arc) return null;
        const range = targets?.[an.id];
        const aColor = range ? (inTarget(an.value, range) ? GREEN : RED) : color;
        const c = toDisplay(an.arc.center), f = toDisplay(an.arc.from), t = toDisplay(an.arc.to);
        const a1 = Math.atan2(f.y - c.y, f.x - c.x) * 180 / Math.PI;
        const a2 = Math.atan2(t.y - c.y, t.x - c.x) * 180 / Math.PI;
        let sweep = ((a2 - a1 + 540) % 360) - 180;
        const rot = sweep >= 0 ? a1 : a2;
        sweep = Math.abs(sweep);
        const R = 26;
        const bis = ((rot + sweep / 2) * Math.PI) / 180;
        const lx = c.x + Math.cos(bis) * (R + 16), ly = c.y + Math.sin(bis) * (R + 16);
        return (
          <PoseAngle key={an.id} cx={c.x} cy={c.y} R={R} rot={rot} sweep={sweep} color={aColor}
            label={`${Math.round(an.value)}°`} lx={lx} ly={ly} fontSize={angleFontSize}
            showArc={angleDisplay !== 'number'} showNum={angleDisplay !== 'arc'} />
        );
      })}
    </>
  );
}

function PoseAngle({ cx, cy, R, rot, sweep, color, label, lx, ly, fontSize, showArc, showNum }: {
  cx: number; cy: number; R: number; rot: number; sweep: number; color: string; label: string;
  lx: number; ly: number; fontSize: number; showArc: boolean; showNum: boolean;
}) {
  return (
    <>
      {showArc && (
        <Arc x={cx} y={cy} innerRadius={R - 2.5} outerRadius={R} angle={sweep} rotation={rot}
          fill={color} opacity={0.95} listening={false} shadowColor="#000" shadowBlur={3} shadowOpacity={0.5} />
      )}
      {showNum && (
        <Text x={lx - 30} y={ly - fontSize / 2} width={60} align="center" text={label} fontSize={fontSize} fontStyle="bold"
          fill={color === '#E4EF3D' ? '#fff' : color} listening={false} shadowColor="#000" shadowBlur={4} shadowOpacity={0.9} />
      )}
    </>
  );
}
