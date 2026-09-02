import { useMemo } from 'react';
import { Line } from 'react-konva';
import type { Pt } from '../../geometry/homography';
import { hexToRgba } from '../../utils/color';
import type { ZoneFill } from '../../types';

// A small tiled canvas of diagonal strokes → used as a repeating hatch fill pattern.
function makeHatch(color: string, opacity: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const s = 10;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.strokeStyle = hexToRgba(color, Math.min(1, Math.max(0.35, opacity + 0.2)));
  ctx.lineWidth = 2;
  // one diagonal + its two wrap segments so the tile repeats seamlessly
  for (const off of [-s, 0, s]) { ctx.beginPath(); ctx.moveTo(off, s); ctx.lineTo(off + s, 0); ctx.stroke(); }
  return c;
}

/**
 * A polygon lying on the court floor. Court-space vertices are projected through H, so it
 * conforms to the court perspective. Style: border (solid/dash, thickness), fill
 * (solid tint / diagonal hatch / outline-only), and a straight or smooth (spline) boundary.
 */
export function CoverageZone({
  points,
  project,
  closed = true,
  color = '#17335F',
  opacity = 0.18,
  fillStyle = 'solid',
  dashed = false,
  strokeWidth = 4,
  curved = false,
}: {
  points: { courtX: number; courtY: number }[];
  project: (courtX: number, courtY: number) => Pt; // court -> display px
  closed?: boolean;
  color?: string;
  opacity?: number;
  fillStyle?: ZoneFill;
  dashed?: boolean;
  strokeWidth?: number;
  curved?: boolean;
}) {
  const flat: number[] = [];
  for (const p of points) {
    const d = project(p.courtX, p.courtY);
    flat.push(d.x, d.y);
  }

  const hatch = useMemo(
    () => (closed && fillStyle === 'hatch' ? makeHatch(color, opacity) : null),
    [closed, fillStyle, color, opacity],
  );

  const solidFill = closed && fillStyle === 'solid' ? hexToRgba(color, opacity) : undefined;

  return (
    <Line
      points={flat}
      closed={closed}
      fill={solidFill}
      fillPatternImage={(hatch ?? undefined) as unknown as HTMLImageElement | undefined}
      fillPatternRepeat="repeat"
      stroke={color}
      strokeWidth={strokeWidth}
      dash={dashed ? [Math.max(8, strokeWidth * 3), Math.max(6, strokeWidth * 2)] : undefined}
      tension={curved ? 0.5 : 0}
      lineJoin="round"
      listening={false}
    />
  );
}
