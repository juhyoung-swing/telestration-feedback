// Draw-on progress (0..1) for a Path, driven by the video timeline so it reproduces on
// scrub and export. Honors delay, easing, and looping. Direction (reverse) is applied at
// render time by flipping the polyline, so it's not handled here.
type DrawAnim = {
  startTime: number;
  drawOn?: boolean;
  drawSec?: number;
  drawDelay?: number;
  drawEase?: 'linear' | 'inout';
  drawLoop?: boolean;
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function drawOnProgress(o: DrawAnim, currentTime: number): number {
  if (!o.drawOn || !o.drawSec || o.drawSec <= 0) return 1;
  const local = currentTime - (o.startTime + (o.drawDelay ?? 0));
  if (local < 0) return 0; // still in the delay window → nothing drawn yet

  let raw: number;
  if (o.drawLoop) {
    const cycle = o.drawSec * 2; // draw for drawSec, then hold fully drawn for drawSec, repeat
    const phase = local % cycle;
    raw = phase < o.drawSec ? phase / o.drawSec : 1;
  } else {
    raw = Math.min(1, local / o.drawSec);
  }
  return o.drawEase === 'inout' ? easeInOut(raw) : raw;
}
