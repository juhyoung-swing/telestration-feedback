import { Arrow } from 'react-konva';
import type { Pt } from '../../geometry/homography';

/**
 * A directional path. `space` decides where the two endpoints live and how they map to the
 * display: 'court' projects court metres onto the floor (perspective); 'screen' maps video px
 * flat. `shape` 'line' is straight; 'arc' bows UP in screen space by `height` × chord length —
 * a 3D-look lob/trajectory that lifts off the floor rather than a flat ground curve.
 */
export function PathArrow({
  space,
  shape,
  points,
  height = 0,
  dashed = false,
  toDisplay,
  color = '#FF3B3B',
  arrow = true,
}: {
  space: 'court' | 'screen';
  shape: 'line' | 'arc';
  points: { x: number; y: number }[];
  height?: number;
  dashed?: boolean;
  toDisplay: (space: 'court' | 'screen', x: number, y: number) => Pt; // → display px
  color?: string;
  arrow?: boolean;
}) {
  if (points.length < 2) return null;
  const a = toDisplay(space, points[0].x, points[0].y);
  const b = toDisplay(space, points[points.length - 1].x, points[points.length - 1].y);

  let flat: number[];
  if (shape === 'arc' && Math.abs(height) > 0.001) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const cx = mx, cy = my - chord * height; // control point lifted straight up (screen -y)
    const N = 24;
    flat = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      flat.push(u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y);
    }
  } else {
    flat = [a.x, a.y, b.x, b.y];
  }

  return (
    <Arrow
      points={flat}
      stroke={color}
      fill={color}
      strokeWidth={4}
      dash={dashed ? [14, 10] : undefined}
      pointerLength={arrow ? 16 : 0}
      pointerWidth={arrow ? 16 : 0}
      lineJoin="round"
      lineCap="round"
      listening={false}
    />
  );
}
