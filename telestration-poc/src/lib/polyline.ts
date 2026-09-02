// Flat [x,y,x,y,…] polyline helpers shared by draw-on animations (Path shaft, Circle outline).

/** Reverse a flat polyline's point order. */
export function reverseFlat(flat: number[]): number[] {
  const out: number[] = [];
  for (let i = flat.length - 2; i >= 0; i -= 2) out.push(flat[i], flat[i + 1]);
  return out;
}

/**
 * Keep only the first `progress` (0..1) of a flat polyline by arc length, interpolating the
 * cut on the final segment. Returns [] when progress ≤ 0 and the whole array when ≥ 1.
 */
export function truncatePolyline(flat: number[], progress: number): number[] {
  const n = flat.length / 2;
  if (progress >= 1 || n < 2) return flat;
  if (progress <= 0) return [];
  let total = 0;
  for (let i = 0; i < n - 1; i++) total += Math.hypot(flat[2 * i + 2] - flat[2 * i], flat[2 * i + 3] - flat[2 * i + 1]);
  const target = total * progress;
  const out = [flat[0], flat[1]];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const x0 = flat[2 * i], y0 = flat[2 * i + 1], x1 = flat[2 * i + 2], y1 = flat[2 * i + 3];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (acc + l >= target) {
      const t = l > 0 ? (target - acc) / l : 1;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      return out;
    }
    acc += l; out.push(x1, y1);
  }
  return out;
}
