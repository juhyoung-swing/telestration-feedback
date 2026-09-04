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
  kind?: 'video' | 'gap' | 'freeze'; // 'gap' = black/empty; 'freeze' = one held source frame; default 'video'
  sourceId?: string;     // which video source plays (absent = the main/original video); inserted footage sets this
  srcStart: number;      // source in-point (seconds) — for a gap/freeze, 0..duration is just its length
  srcEnd: number;        // source out-point (seconds)
  srcFreeze?: number;    // freeze only: the SOURCE time of the single held frame
  timelineStart: number; // position on the timeline (seconds) — derived by normalizeClips
};

export const isGap = (c: Clip | null | undefined) => c?.kind === 'gap';
export const isFreeze = (c: Clip | null | undefined) => c?.kind === 'freeze';

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
  if (isFreeze(c)) return c.srcFreeze ?? c.srcStart; // held frame — source time is constant
  const local = Math.max(0, Math.min(clipDur(c), T - c.timelineStart));
  return c.srcStart + local;
}

/** Source time within a specific clip → timeline time. */
export function timelineAtClip(c: Clip, srcTime: number): number {
  return c.timelineStart + Math.max(0, Math.min(clipDur(c), srcTime - c.srcStart));
}

// One output frame of the exported timeline: its timeline time T, the SOURCE time to
// grab from the video (ignored when gap), and whether it's a black gap frame.
export type TimelineFrame = { T: number; srcTime: number; gap: boolean };

// Walk the EDL in timeline order and emit every output frame at `fps`. Duplicated
// clips (repeats) re-emit their source range; reordering is honored (clips are in
// timeline order); gaps emit black frames. This drives the offline exporter.
export function timelineFrames(clips: Clip[], fps: number, videoDuration = 0): TimelineFrame[] {
  const dt = 1 / fps;
  const src = clips.length ? clips : singleClip(videoDuration);
  const out: TimelineFrame[] = [];
  for (const c of src) {
    const n = Math.max(0, Math.round(clipDur(c) * fps));
    const frozen = isFreeze(c) ? (c.srcFreeze ?? c.srcStart) : null;
    for (let k = 0; k < n; k++) {
      const T = c.timelineStart + k * dt;
      if (isGap(c)) out.push({ T, srcTime: 0, gap: true });
      else if (frozen != null) out.push({ T, srcTime: frozen, gap: false }); // held frame
      else out.push({ T, srcTime: c.srcStart + k * dt, gap: false });
    }
  }
  return out;
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

/** Insert a black GAP clip right after `afterId` (or at the end). Ripples following clips + overlays. */
export function insertGap<T extends TimedItem>(clips: Clip[], items: T[], afterId: string | null, newId: string, seconds = 2): { clips: Clip[]; items: T[] } {
  const idx = afterId ? clips.findIndex((c) => c.id === afterId) : clips.length - 1;
  const after = idx >= 0 ? clips[idx] : null;
  const at = after ? after.timelineStart + clipDur(after) : totalDuration(clips);
  const gap: Clip = { id: newId, kind: 'gap', srcStart: 0, srcEnd: Math.max(0.2, seconds), timelineStart: at + EPS };
  return relayout(clips, [...clips, gap], items);
}

/**
 * Insert a FREEZE (hold) clip that holds the source frame at `srcFreeze` for
 * `seconds`, splitting the clip under `atTimeline` so the hold lands exactly at the
 * playhead (ripples the rest). Returns the new freeze clip's id via `newId`.
 */
export function insertFreeze<T extends TimedItem>(
  clips: Clip[], items: T[], atTimeline: number, srcFreeze: number, newId: string, seconds = 3,
): { clips: Clip[]; items: T[] } {
  const dur = Math.max(0.2, seconds);
  const c = clipAt(clips, atTimeline);
  const freeze: Clip = { id: newId, kind: 'freeze', srcStart: 0, srcEnd: dur, srcFreeze, timelineStart: atTimeline + EPS / 2 };
  // Mid-clip: split the host so later frames ripple after the hold; overlays past the cut follow.
  if (c && !isGap(c) && !isFreeze(c) && atTimeline > c.timelineStart + 0.05 && atTimeline < c.timelineStart + clipDur(c) - 0.05) {
    const srcSplit = c.srcStart + (atTimeline - c.timelineStart);
    const c1: Clip = { ...c, srcEnd: srcSplit };
    const c2: Clip = { ...c, id: `${newId}-r`, srcStart: srcSplit, timelineStart: atTimeline + EPS };
    const reassigned = items.map((it) => (it.clipId === c.id && it.startTime >= atTimeline - 1e-6 ? { ...it, clipId: c2.id } : it));
    return relayout(clips, [...clips.map((x) => (x.id === c.id ? c1 : x)), freeze, c2], reassigned);
  }
  return relayout(clips, [...clips, freeze], items);
}

/**
 * Insert a VIDEO clip from another source (`sourceId`, [srcStart,srcEnd]) at `atTimeline`,
 * splitting the clip under it so the insert lands exactly at the playhead (ripples the rest).
 */
export function insertVideoClip<T extends TimedItem>(
  clips: Clip[], items: T[], atTimeline: number, sourceId: string, srcStart: number, srcEnd: number, newId: string,
): { clips: Clip[]; items: T[] } {
  const seg: Clip = { id: newId, kind: 'video', sourceId, srcStart, srcEnd: Math.max(srcStart + 0.1, srcEnd), timelineStart: atTimeline + EPS / 2 };
  const c = clipAt(clips, atTimeline);
  if (c && !isGap(c) && !isFreeze(c) && atTimeline > c.timelineStart + 0.05 && atTimeline < c.timelineStart + clipDur(c) - 0.05) {
    const srcSplit = c.srcStart + (atTimeline - c.timelineStart);
    const c1: Clip = { ...c, srcEnd: srcSplit };
    const c2: Clip = { ...c, id: `${newId}-r`, srcStart: srcSplit, timelineStart: atTimeline + EPS };
    const reassigned = items.map((it) => (it.clipId === c.id && it.startTime >= atTimeline - 1e-6 ? { ...it, clipId: c2.id } : it));
    return relayout(clips, [...clips.map((x) => (x.id === c.id ? c1 : x)), seg, c2], reassigned);
  }
  return relayout(clips, [...clips, seg], items);
}

/** Replace a GAP clip with an inserted video clip (fills the empty slot with footage). */
export function fillGapWithVideo<T extends TimedItem>(
  clips: Clip[], items: T[], gapId: string, sourceId: string, srcStart: number, srcEnd: number,
): { clips: Clip[]; items: T[] } {
  const g = clips.find((c) => c.id === gapId);
  if (!g || !isGap(g)) return { clips, items };
  const filled: Clip = { ...g, kind: 'video', sourceId, srcStart, srcEnd: Math.max(srcStart + 0.1, srcEnd) };
  return relayout(clips, clips.map((c) => (c.id === gapId ? filled : c)), items);
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
