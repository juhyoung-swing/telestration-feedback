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
  if (!o.drawOn) return 1;
  const sec = o.drawSec && o.drawSec > 0 ? o.drawSec : 1.2; // default when only drawOn was toggled
  const local = currentTime - (o.startTime + (o.drawDelay ?? 0));
  if (local < 0) return 0; // still in the delay window → nothing drawn yet

  let raw: number;
  if (o.drawLoop) {
    const cycle = sec * 2; // draw for `sec`, then hold fully drawn for `sec`, repeat
    const phase = local % cycle;
    raw = phase < sec ? phase / sec : 1;
  } else {
    raw = Math.min(1, local / sec);
  }
  return o.drawEase === 'inout' ? easeInOut(raw) : raw;
}
