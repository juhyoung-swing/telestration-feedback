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

// ── clip editing (split / duplicate / delete / move) ─────────────────────────
// Overlays are bound to a clip (clipId) and carry ABSOLUTE timeline times. Editing
// clips re-lays the timeline; `relayout` shifts each bound overlay by how much its
// clip moved, so annotations stay glued to their clip instance.
const EPS = 1e-4;
export type TimedItem = { id: string; clipId?: string; startTime: number; endTime: number };

export function relayout<T extends TimedItem>(oldClips: Clip[], newClips: Clip[], items: T[]): { clips: Clip[]; items: T[] } {
  const clips = normalizeClips(newClips);
  const oldStart = new Map(oldClips.map((c) => [c.id, c.timelineStart]));
  const newStart = new Map(clips.map((c) => [c.id, c.timelineStart]));
  const shifted = items.map((it) => {
    if (!it.clipId) return it;
    const o = oldStart.get(it.clipId), n = newStart.get(it.clipId);
    if (o == null || n == null) return it;
    const d = n - o;
    return d ? { ...it, startTime: it.startTime + d, endTime: it.endTime + d } : it;
  });
  return { clips, items: shifted };
}

/** Copy a clip right after itself (a repeat). The copy carries NO overlays (Q1-a). */
export function duplicateClip<T extends TimedItem>(clips: Clip[], items: T[], id: string, newId: string): { clips: Clip[]; items: T[] } {
  const c = clips.find((x) => x.id === id);
  if (!c) return { clips, items };
  const copy: Clip = { ...c, id: newId, timelineStart: c.timelineStart + EPS };
  return relayout(clips, [...clips, copy], items);
}

/** Remove a clip (and its bound overlays). Keeps at least one clip. */
export function deleteClip<T extends TimedItem>(clips: Clip[], items: T[], id: string): { clips: Clip[]; items: T[] } {
  if (clips.length <= 1) return { clips, items };
  const remaining = clips.filter((c) => c.id !== id);
  const kept = items.filter((it) => it.clipId !== id);
  return relayout(clips, remaining, kept);
}

/** Split the clip under `atTimeline` into two at that point. Overlays past the cut move to the new half. */
export function splitClip<T extends TimedItem>(clips: Clip[], items: T[], atTimeline: number, newId: string): { clips: Clip[]; items: T[] } {
  const c = clipAt(clips, atTimeline);
  if (!c) return { clips, items };
  const srcSplit = c.srcStart + (atTimeline - c.timelineStart);
  if (srcSplit <= c.srcStart + 0.05 || srcSplit >= c.srcEnd - 0.05) return { clips, items }; // too close to a boundary
  const c1: Clip = { ...c, srcEnd: srcSplit };
  const c2: Clip = { ...c, id: newId, srcStart: srcSplit, timelineStart: c.timelineStart + EPS };
  const reassigned = items.map((it) => (it.clipId === c.id && it.startTime >= atTimeline - 1e-6 ? { ...it, clipId: newId } : it));
  return relayout(clips, [...clips.map((x) => (x.id === c.id ? c1 : x)), c2], reassigned);
}

/** Reorder: move a clip to a new index (contiguous re-lay). Bound overlays follow. */
export function moveClip<T extends TimedItem>(clips: Clip[], items: T[], id: string, toIndex: number): { clips: Clip[]; items: T[] } {
  const idx = clips.findIndex((c) => c.id === id);
  if (idx < 0) return { clips, items };
  const arr = [...clips];
  const [c] = arr.splice(idx, 1);
  arr.splice(Math.max(0, Math.min(arr.length, toIndex)), 0, c);
  const ordered = arr.map((cc, i) => ({ ...cc, timelineStart: i })); // integer order → normalize re-lays
  return relayout(clips, ordered, items);
}
