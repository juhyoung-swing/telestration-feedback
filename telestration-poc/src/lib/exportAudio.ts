// Audio side of the offline export: build the output audio from the EDL + slow-mo
// (source audio segments) and narration, mixed via OfflineAudioContext → WAV. The
// WAV is muxed onto the silent WebCodecs video by ffmpeg (Electron).
import { clipAt, clipDur, isFreeze, isGap, totalDuration } from './clips';
import type { Clip } from './clips';
import type { Narration, Overlay } from '../types';

// One constant-(clip, rate) run of the output: which source range plays, at what
// rate, over which OUTPUT time — and the TIMELINE range it came from (for placing
// narration). Slow-mo (rate<1) stretches outDur; gaps are silent.
export type AudioSeg = { outStart: number; outDur: number; srcStart: number; srcEnd: number; rate: number; gap: boolean; tlStart: number; tlEnd: number };

export function audioSegments(clips: Clip[], overlays: Overlay[]): { segs: AudioSeg[]; outDur: number } {
  const speeds = overlays
    .filter((o): o is Extract<Overlay, { type: 'speed' }> => o.type === 'speed' && o.visible)
    .map((s) => ({ start: s.startTime, end: s.endTime, rate: Math.max(0.05, s.rate) }));
  const rateAt = (t: number) => { const s = speeds.find((x) => t >= x.start && t < x.end); return s ? s.rate : 1; };

  const total = totalDuration(clips);
  const bounds = new Set<number>([0, total]);
  for (const c of clips) { bounds.add(c.timelineStart); bounds.add(c.timelineStart + clipDur(c)); }
  for (const s of speeds) { bounds.add(s.start); bounds.add(s.end); }
  const cuts = [...bounds].filter((b) => b >= 0 && b <= total).sort((a, b) => a - b);

  const segs: AudioSeg[] = [];
  let out = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const t0 = cuts[i], t1 = cuts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const c = clipAt(clips, (t0 + t1) / 2);
    if (!c) continue;
    const rate = rateAt((t0 + t1) / 2);
    const outDur = (t1 - t0) / rate;
    const silent = isGap(c) || isFreeze(c) || (!!c.sourceId && c.kind !== 'gap' && c.kind !== 'freeze'); // inserted footage: silent in v1 (narrate over it)
    segs.push({ outStart: out, outDur, srcStart: c.srcStart + (t0 - c.timelineStart), srcEnd: c.srcStart + (t1 - c.timelineStart), rate, gap: silent, tlStart: t0, tlEnd: t1 });
    out += outDur;
  }
  return { segs, outDur: out };
}

/** Map a TIMELINE time to OUTPUT time (accounts for slow-mo stretch), for placing narration. */
export function timelineToOutput(segs: AudioSeg[], tlTime: number): number {
  for (const s of segs) if (tlTime >= s.tlStart - 1e-6 && tlTime <= s.tlEnd + 1e-6) return s.outStart + (tlTime - s.tlStart) / s.rate;
  const last = segs[segs.length - 1];
  return last ? last.outStart + last.outDur : tlTime;
}

/** Where each narration should start in OUTPUT time. */
export function narrationOutputStarts(segs: AudioSeg[], narrations: Narration[]): { key: string; outStart: number; dur: number }[] {
  return narrations.map((n) => ({ key: n.key, outStart: timelineToOutput(segs, n.startTime), dur: n.dur }));
}

// Mix the output audio (source video audio per the EDL/slow-mo + narration) via
// OfflineAudioContext and return a 16-bit PCM WAV. Null when there's no audio.
export async function mixExportAudioWav(opts: {
  clips: Clip[];
  overlays: Overlay[];
  narrations: Narration[];
  sourceAudioBytes: ArrayBuffer | null;             // the video file's bytes (its audio is decoded)
  loadNarration: (key: string) => Promise<ArrayBuffer | null>;
}): Promise<ArrayBuffer | null> {
  const { segs, outDur } = audioSegments(opts.clips, opts.overlays);
  if (outDur <= 0) return null;
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(outDur * sr)), sr);
  let scheduled = 0;

  if (opts.sourceAudioBytes) {
    let srcBuf: AudioBuffer | null = null;
    try { srcBuf = await ctx.decodeAudioData(opts.sourceAudioBytes.slice(0)); } catch { srcBuf = null; }
    if (srcBuf && srcBuf.duration > 0) {
      for (const s of segs) {
        if (s.gap || s.srcEnd - s.srcStart < 1e-3) continue;
        const node = ctx.createBufferSource();
        node.buffer = srcBuf;
        node.playbackRate.value = s.rate;
        node.connect(ctx.destination);
        node.start(s.outStart, Math.min(s.srcStart, srcBuf.duration), Math.min(s.srcEnd - s.srcStart, Math.max(0, srcBuf.duration - s.srcStart)));
        scheduled++;
      }
    }
  }

  for (const n of narrationOutputStarts(segs, opts.narrations)) {
    const bytes = await opts.loadNarration(n.key);
    if (!bytes) continue;
    let buf: AudioBuffer | null = null;
    try { buf = await ctx.decodeAudioData(bytes.slice(0)); } catch { buf = null; }
    if (!buf) continue;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    node.start(n.outStart);
    scheduled++;
  }

  if (scheduled === 0) return null; // nothing to mix → keep the video silent
  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}

// AudioBuffer → 16-bit PCM WAV (interleaved).
function audioBufferToWav(buf: AudioBuffer): ArrayBuffer {
  const ch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate, n = buf.length;
  const data = new ArrayBuffer(44 + n * ch * 2);
  const view = new DataView(data);
  const wr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); view.setUint32(4, 36 + n * ch * 2, true); wr(8, 'WAVE');
  wr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * ch * 2, true); view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
  wr(36, 'data'); view.setUint32(40, n * ch * 2, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true); off += 2;
  }
  return data;
}
