// Offline timeline export: walk the edit frame-by-frame and composite
// [source frame (or black gap) + headless overlays], with SLOW-MO baked in (the
// timeline cursor advances by the playback rate) and ZOOM-IN baked in (punch-in
// transform), then encode to MP4 via WebCodecs. Reflects cuts / repeats / gaps /
// overlays / slow-mo / zoom — not tied to real-time playback.
import { clipAt, isGap, totalDuration } from './clips';
import type { Clip } from './clips';
import { videoToDisplay } from '../geometry/coords';
import { projectCourtPoint, unprojectToCourt } from '../geometry/homography';
import { footAt } from '../geometry/tracking';
import { HeadlessOverlayRenderer } from './headlessOverlay';
import { Mp4Encoder, webCodecsAvailable } from './mp4Encoder';
import type { CourtCalibration, Overlay, Players, PoseData } from '../types';

function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    if (Math.abs(video.currentTime - t) < 1e-4) { res(); return; }
    const on = () => { video.removeEventListener('seeked', on); res(); };
    video.addEventListener('seeked', on);
    try { video.currentTime = t; } catch { res(); }
  });
}

export type TimelineExportOpts = {
  video: HTMLVideoElement;
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

  const wasPaused = video.paused;
  video.pause();
  try {
    let T = 0, guard = 0;
    while (T < total - 1e-6 && guard < 500_000) {
      guard++;
      const c = clipAt(clips, T);
      const gap = isGap(c);
      const srcTime = c && !gap ? c.srcStart + (T - c.timelineStart) : 0;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const z = zoomAt(T, srcTime);
      if (z) ctx.setTransform(z.s, 0, 0, z.s, z.tx, z.ty); // punch-in video + overlays together
      if (!gap) {
        await seekVideo(video, srcTime);
        if (video.readyState >= 2) ctx.drawImage(video, 0, 0, W, H);
      }
      if (overlayR && calibration) {
        const ov = overlayR.render({ overlays, currentTime: T, sourceTime: srcTime, calibration, players, poseData });
        ctx.drawImage(ov, 0, 0, W, H);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const q = enc.addFrame(composite);
      if (q > 8) await new Promise((r) => setTimeout(r, 0));
      opts.onProgress?.(Math.min(total, T), total);
      T += rateAt(T) * dt; // slow-mo → T advances slower → more output frames (stretched)
    }
  } finally {
    overlayR?.dispose();
    if (!wasPaused) void video.play().catch(() => {});
  }
  const buf = await enc.finish();
  return new Blob([buf], { type: 'video/mp4' });
}
