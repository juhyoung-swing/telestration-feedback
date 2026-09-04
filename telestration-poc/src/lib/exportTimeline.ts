// Offline timeline export: walk the edit frame-by-frame and composite
// [source frame (or black gap) + headless overlays], with SLOW-MO baked in (the
// timeline cursor advances by the playback rate) and ZOOM-IN baked in (punch-in
// transform), then encode to MP4 via WebCodecs. Reflects cuts / repeats / gaps /
// overlays / slow-mo / zoom — not tied to real-time playback.
import { clipAt, isFreeze, isGap, totalDuration } from './clips';
import type { Clip } from './clips';
import { videoToDisplay } from '../geometry/coords';
import { projectCourtPoint, unprojectToCourt } from '../geometry/homography';
import { footAt } from '../geometry/tracking';
import { HeadlessOverlayRenderer } from './headlessOverlay';
import { Mp4Encoder, webCodecsAvailable } from './mp4Encoder';
import { SourceDecoder, videoDecodeAvailable } from './sourceDecoder';
import type { CourtCalibration, Overlay, Players, PoseData } from '../types';

function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    if (Math.abs(video.currentTime - t) < 1e-4) { res(); return; }
    const on = () => { video.removeEventListener('seeked', on); res(); };
    video.addEventListener('seeked', on);
    try { video.currentTime = t; } catch { res(); }
  });
}

export type ExtraSource = { id: string; bytes: ArrayBuffer; w: number; h: number };

export type TimelineExportOpts = {
  video: HTMLVideoElement;
  sourceBytes?: ArrayBuffer | null;      // decode source frames via WebCodecs (fast); falls back to <video> seek
  extraSources?: ExtraSource[];          // inserted footage (multi-source) — decoded + letterboxed per clip.sourceId
  clips: Clip[];
  overlays: Overlay[];
  calibration: CourtCalibration | null;
  players: Players | null;
  poseData: PoseData | null;
  videoW: number; videoH: number;
  targetHeight?: number;
  fps?: number;
  bitrate?: number;
  onProgress?: (done: number, total: number) => void;
};

export async function exportTimelineMp4(opts: TimelineExportOpts): Promise<Blob> {
  if (!webCodecsAvailable()) throw new Error('이 환경은 WebCodecs를 지원하지 않습니다');
  const { video, clips: rawClips, overlays, calibration, players, poseData, videoW, videoH } = opts;
  const fps = opts.fps ?? 30;
  const dt = 1 / fps;
  const H = Math.min(opts.targetHeight ?? 720, videoH || 720);
  const W = Math.round(H * (videoW / videoH) / 2) * 2; // even width for H.264
  const bitrate = opts.bitrate ?? Math.round(W * H * fps * 0.12);
  const clips: Clip[] = rawClips.length ? rawClips : [{ id: 'clip-0', srcStart: 0, srcEnd: video.duration || 0, timelineStart: 0 }];
  const total = totalDuration(clips);

  const view = { scaleX: W / videoW, scaleY: H / videoH };
  const project = (cx: number, cy: number) => videoToDisplay(projectCourtPoint(calibration!.homography, cx, cy), view);

  // slow-mo: rate of the speed segment covering timeline time T (else 1×)
  const rateAt = (T: number): number => {
    const seg = overlays.find((o) => o.type === 'speed' && o.visible && T >= o.startTime && T <= o.endTime);
    return seg && seg.type === 'speed' ? Math.max(0.05, seg.rate) : 1;
  };
  // zoom-in punch-in transform at T (about a court point or tracked foot), or null
  const zoomAt = (T: number, srcTime: number): { tx: number; ty: number; s: number } | null => {
    if (!calibration) return null;
    const z = [...overlays].reverse().find((o) => o.type === 'zoom-in' && o.visible && T >= o.startTime && T <= o.endTime);
    if (!z || z.type !== 'zoom-in') return null;
    let zx = z.courtX, zy = z.courtY;
    if (z.trackId && players) {
      const foot = footAt(players[z.trackId] ?? [], srcTime);
      if (foot) { const c = unprojectToCourt(calibration.inverseHomography, foot[0], foot[1]); zx = c.x; zy = c.y; }
    }
    const sc = project(zx, zy);
    const cy = z.trackId ? sc.y - H * 0.12 : sc.y;
    const s = z.scale;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    return { tx: clamp(W / 2 - s * sc.x, W - s * W, 0), ty: clamp(H / 2 - s * cy, H - s * H, 0), s };
  };

  const enc = new Mp4Encoder(W, H, fps, bitrate);
  await enc.init();
  const overlayR = calibration ? new HeadlessOverlayRenderer(W, H, videoW, videoH) : null;
  const composite = document.createElement('canvas');
  composite.width = W; composite.height = H;
  const ctx = composite.getContext('2d')!;

  // ── overlay render cache ──────────────────────────────────────────────────
  // Most telestration is STATIC (markers/zones/arrows): its render is identical
  // every frame, so re-running the (costly) headless React/Konva render each frame
  // is pure waste. Snapshot the render and reuse it until the active overlay set
  // changes; only DYNAMIC overlays (pose, spotlight, tracked/animated) re-render
  // every frame. Empty frames skip the render (and the draw) entirely.
  const isDyn = (o: Overlay): boolean =>
    o.type === 'pose' || o.type === 'spotlight' ||
    (o.type === 'ground-halo' && (!!o.trackId || !!o.drawOn)) ||
    (o.type === 'path' && !!o.drawOn) ||
    (o.type === 'sector' && !!o.drawOn);
  const ovCache = overlayR ? document.createElement('canvas') : null;
  if (ovCache) { ovCache.width = W; ovCache.height = H; }
  const ovCacheCtx = ovCache?.getContext('2d') ?? null;
  let ovKey: string | null = null;   // signature of the currently-cached static render
  let ovEmpty = true;                // last state: nothing to draw

  // fast frame source: WebCodecs decoder (no per-frame seeking); else <video> seek.
  let dec: SourceDecoder | null = null;
  if (opts.sourceBytes && videoDecodeAvailable()) {
    try { dec = new SourceDecoder(opts.sourceBytes); } catch { dec = null; }
  }
  // inserted-footage decoders (multi-source), keyed by source id + their intrinsic dims (for letterbox)
  const extraDecs = new Map<string, SourceDecoder>();
  const extraDims = new Map<string, { w: number; h: number }>();
  if (videoDecodeAvailable()) {
    for (const s of opts.extraSources ?? []) {
      try { extraDecs.set(s.id, new SourceDecoder(s.bytes)); extraDims.set(s.id, { w: s.w, h: s.h }); } catch { /* skip a bad source */ }
    }
  }
  const insertedSourceId = (cc: Clip | null): string | null =>
    cc && !isGap(cc) && !isFreeze(cc) && cc.sourceId && extraDecs.has(cc.sourceId) ? cc.sourceId : null;

  const wasPaused = video.paused;
  video.pause();
  try {
    let T = 0, guard = 0;
    while (T < total - 1e-6 && guard < 500_000) {
      guard++;
      const c = clipAt(clips, T);
      const gap = isGap(c);
      const srcTime = !c || gap ? 0
        : isFreeze(c) ? (c.srcFreeze ?? c.srcStart)   // held frame — constant source time
        : c.srcStart + (T - c.timelineStart);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const z = zoomAt(T, srcTime);
      if (z) ctx.setTransform(z.s, 0, 0, z.s, z.tx, z.ty); // punch-in video + overlays together
      if (!gap) {
        const insId = insertedSourceId(c);
        if (insId) {
          // inserted footage → decode from its own source and LETTERBOX into the frame
          // (different aspect ratio), ignoring the court zoom (which is main-only).
          const frame = await extraDecs.get(insId)!.frameAt(srcTime);
          if (frame) {
            const sd = extraDims.get(insId)!;
            const sc = Math.min(W / sd.w, H / sd.h);
            const dw = sd.w * sc, dh = sd.h * sc, dx = (W - dw) / 2, dy = (H - dh) / 2;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(frame, dx, dy, dw, dh); frame.close();
            if (z) ctx.setTransform(z.s, 0, 0, z.s, z.tx, z.ty); // restore for the overlay draw
          }
        } else if (dec) {
          const frame = await dec.frameAt(srcTime);
          if (frame) { ctx.drawImage(frame, 0, 0, W, H); frame.close(); }
        } else {
          await seekVideo(video, srcTime);
          if (video.readyState >= 2) ctx.drawImage(video, 0, 0, W, H);
        }
      }
      if (overlayR && calibration && ovCache && ovCacheCtx) {
        const active = overlays.filter((o) => o.visible && T >= o.startTime && T <= o.endTime);
        if (active.length === 0) {
          ovEmpty = true; ovKey = null;            // nothing active → skip render + draw
        } else {
          const dyn = active.some(isDyn);
          // key changes only at span/clip boundaries; the clip id guards clipId-scoped visibility
          const key = (c?.id ?? '-') + '#' + active.map((o) => o.id).sort().join('|');
          if (dyn || key !== ovKey) {
            const ov = overlayR.render({ overlays, currentTime: T, sourceTime: srcTime, calibration, players, poseData });
            ovCacheCtx.clearRect(0, 0, W, H);
            ovCacheCtx.drawImage(ov, 0, 0);        // snapshot (renderer reuses its canvas next frame)
            ovKey = dyn ? null : key;              // dynamic → force re-render next frame
            ovEmpty = false;
          }
          if (!ovEmpty) ctx.drawImage(ovCache, 0, 0, W, H);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const q = enc.addFrame(composite);
      if (q > 8) await new Promise((r) => setTimeout(r, 0));
      opts.onProgress?.(Math.min(total, T), total);
      T += rateAt(T) * dt; // slow-mo → T advances slower → more output frames (stretched)
    }
  } finally {
    overlayR?.dispose();
    dec?.dispose();
    for (const d of extraDecs.values()) d.dispose();
    if (!wasPaused) void video.play().catch(() => {});
  }
  const buf = await enc.finish();
  return new Blob([buf], { type: 'video/mp4' });
}
