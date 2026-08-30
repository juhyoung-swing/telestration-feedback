import { Line } from 'react-konva';
import { courtLines } from '../../geometry/court';
import type { CourtLineKind } from '../../geometry/court';
import type { Pt } from '../../geometry/homography';

// Debug grid: known court lines projected through H. If these overlap the real
// painted lines in the video, the calibration is good.
const COLOR: Record<CourtLineKind, string> = {
  perimeter: '#39FF14',
  singles: '#39FF14',
  service: '#39FF14',
  center: '#39FF14',
  net: '#FF3B3B', // net highlighted in red
};

export function CourtGrid({ project }: { project: (courtX: number, courtY: number) => Pt }) {
  return (
    <>
      {courtLines().map((ln) => {
        const flat: number[] = [];
        for (const p of ln.points) {
          const d = project(p.x, p.y);
          flat.push(d.x, d.y);
        }
        return (
          <Line
            key={ln.name}
            points={flat}
            stroke={COLOR[ln.kind]}
            strokeWidth={ln.kind === 'net' ? 3 : 2}
            opacity={0.9}
            listening={false}
          />
        );
      })}
    </>
  );
}
