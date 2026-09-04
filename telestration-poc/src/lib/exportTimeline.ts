// Offline timeline export: walk the EDL frame-by-frame, composite [source frame
// (or black gap) + headless overlays], and encode to MP4 via WebCodecs. Not tied
// to real-time playback → faster + reflects the edit (cuts/repeats/gaps/overlays).
// The frame SOURCE here seeks an <video> (simple + correct); a later step swaps it
// for a WebCodecs decoder for full speed. Audio is added afterwards (ffmpeg).
import { timelineFrames } from './clips';
import type { Clip } from './clips';
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
  videoW: number; videoH: number;      // intrinsic video size
  targetHeight?: number;                // export height (width follows aspect)
  fps?: number;
  bitrate?: number;
  onProgress?: (done: number, total: number) => void;
};

export async function exportTimelineMp4(opts: TimelineExportOpts): Promise<Blob> {
  if (!webCodecsAvailable()) throw new Error('이 환경은 WebCodecs를 지원하지 않습니다');
  const { video, clips, overlays, calibration, players, poseData, videoW, videoH } = opts;
  const fps = opts.fps ?? 30;
  const H = Math.min(opts.targetHeight ?? 720, videoH || 720);
  const W = Math.round(H * (videoW / videoH) / 2) * 2; // even width for H.264
  const bitrate = opts.bitrate ?? Math.round(W * H * fps * 0.12);

  const frames = timelineFrames(clips, fps, video.duration || 0);
  const enc = new Mp4Encoder(W, H, fps, bitrate);
  await enc.init();
  const overlayR = calibration ? new HeadlessOverlayRenderer(W, H, videoW, videoH) : null;

  const composite = document.createElement('canvas');
  composite.width = W; composite.height = H;
  const ctx = composite.getContext('2d')!;

  const wasPaused = video.paused;
  video.pause();
  try {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H); // black base (also the gap frame)
      if (!f.gap) {
        await seekVideo(video, f.srcTime);
        if (video.readyState >= 2) ctx.drawImage(video, 0, 0, W, H);
      }
      if (overlayR && calibration) {
        const ov = overlayR.render({ overlays, currentTime: f.T, sourceTime: f.srcTime, calibration, players, poseData });
        ctx.drawImage(ov, 0, 0, W, H);
      }
      const q = enc.addFrame(composite);
      if (q > 8) await new Promise((r) => setTimeout(r, 0)); // let the encoder drain
      opts.onProgress?.(i + 1, frames.length);
    }
  } finally {
    overlayR?.dispose();
    if (!wasPaused) void video.play().catch(() => {});
  }
  const buf = await enc.finish();
  return new Blob([buf], { type: 'video/mp4' });
}
