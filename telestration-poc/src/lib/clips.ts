// Edit Decision List (EDL) for the base video track. The timeline is a sequence
// of clips, each referencing a source range [srcStart, srcEnd] placed at a
// timeline position. This decouples TIMELINE time from SOURCE (video) time, so a
// segment can be duplicated (repeat) or reordered for a coaching feedback edit.
//
// Invariant kept simple for now: one video track, clips laid CONTIGUOUS (no gaps)
// in timeline order. `normalizeClips` re-lays timelineStart from cumulative
// durations. The identity EDL — one clip covering the whole source at position 0 —
// makes timeline time == source time, so all existing time-based behavior is
// unchanged until a clip is actually split / duplicated / moved.
export type Clip = {
  id: string;
  srcStart: number;      // source in-point (seconds)
  srcEnd: number;        // source out-point (seconds)
  timelineStart: number; // position on the timeline (seconds) — derived by normalizeClips
};

export const clipDur = (c: Clip) => Math.max(0, c.srcEnd - c.srcStart);
export const totalDuration = (clips: Clip[]) => clips.reduce((s, c) => s + clipDur(c), 0);

/** The identity EDL: a single clip covering the whole source. timeline time == source time. */
export const singleClip = (duration: number): Clip[] =>
  [{ id: 'clip-0', srcStart: 0, srcEnd: Math.max(0, duration), timelineStart: 0 }];

/** Sort by timelineStart and re-lay contiguous (recompute each timelineStart). */
export function normalizeClips(clips: Clip[]): Clip[] {
  const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
  let t = 0;
  return sorted.map((c) => { const nc = { ...c, timelineStart: t }; t += clipDur(c); return nc; });
}

/** The clip whose timeline span contains T (clamped to the last clip at the very end). */
export function clipAt(clips: Clip[], T: number): Clip | null {
  for (const c of clips) if (T >= c.timelineStart && T < c.timelineStart + clipDur(c)) return c;
  return clips.length ? clips[clips.length - 1] : null;
}

/** Timeline time (T) → source (video) time, via the clip under T. Identity EDL → src == T. */
export function srcAt(clips: Clip[], T: number): number {
  if (!clips.length) return T;
  const c = clipAt(clips, T);
  if (!c) return T;
  const local = Math.max(0, Math.min(clipDur(c), T - c.timelineStart));
  return c.srcStart + local;
}

/** Source time within a specific clip → timeline time. */
export function timelineAtClip(c: Clip, srcTime: number): number {
  return c.timelineStart + Math.max(0, Math.min(clipDur(c), srcTime - c.srcStart));
}
