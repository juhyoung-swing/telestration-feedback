// Client-side export: composite the on-screen result (video frame + Konva overlays + the
// zoom CSS transform) into a canvas, then save it as a PNG (screenshot) or record it in
// real time with MediaRecorder (video). Because we capture exactly what's on screen — the
// live video frame, the live overlay canvas, and the zoom transform — overlays, zoom-in and
// slow-mo all bake in for free (slow-mo is just the playback rate while we record).

type StageLike = { toCanvas: (config?: { pixelRatio?: number }) => HTMLCanvasElement };

const overlayEl = () => document.querySelector('.konva-overlay') as HTMLElement | null;
const liveOverlayCanvases = () => [...document.querySelectorAll('.konva-overlay canvas')] as HTMLCanvasElement[];

// The zoom-content div's CSS transform (translate + uniform scale), or identity when off.
function zoomMatrix(): DOMMatrix {
  const zc = document.querySelector('.zoom-content') as HTMLElement | null;
  const t = zc ? getComputedStyle(zc).transform : 'none';
  try { return t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix(); } catch { return new DOMMatrix(); }
}

// Draw one composited frame into ctx at target W×H. Overlays come from `overlaySources`
// (a crisp stage.toCanvas() for a screenshot, or the live layer canvases for video).
function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  video: HTMLVideoElement,
  overlaySources: HTMLCanvasElement[],
) {
  const ov = overlayEl();
  const dispW = ov?.clientWidth || W;
  const dispH = ov?.clientHeight || H;
  const scale = W / dispW; // display px → target px
  const m = zoomMatrix();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // target = scale · zoom · displayPoint  (video + overlays live in unzoomed display space)
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, dispW, dispH);
  for (const c of overlaySources) ctx.drawImage(c, 0, 0, dispW, dispH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** A crisp PNG of the current frame at the video's native resolution (overlays re-rendered sharp). */
export function screenshotCanvas(video: HTMLVideoElement, stage: StageLike | null): HTMLCanvasElement {
  const W = video.videoWidth || overlayEl()?.clientWidth || 1280;
  const H = video.videoHeight || overlayEl()?.clientHeight || 720;
  const dispW = overlayEl()?.clientWidth || W;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;
  const overlays = stage ? [stage.toCanvas({ pixelRatio: W / dispW })] : liveOverlayCanvases();
  drawFrame(ctx, W, H, video, overlays);
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, quality));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Record the composited output in real time → WebM Blob. Plays the video from the start to end
 * (so the on-screen render — overlays, zoom, slow-mo — is what gets captured), with audio.
 * `onProgress(t, dur)` fires each frame. Target height caps the encode so real time stays smooth.
 */
export async function recordCompositeWebM(
  video: HTMLVideoElement,
  onProgress?: (t: number, dur: number) => void,
  targetHeight = 720,
): Promise<Blob> {
  const dispW = overlayEl()?.clientWidth || 1280;
  const dispH = overlayEl()?.clientHeight || 720;
  const aspect = dispW / dispH;
  const H = Math.min(targetHeight, video.videoHeight || targetHeight);
  const W = Math.round(H * aspect);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;

  const stream = out.captureStream(30);
  // pull the audio track from the source video so the export has sound
  try {
    const vs = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    const at = vs?.getAudioTracks?.() ?? [];
    if (at[0]) stream.addTrack(at[0]);
  } catch { /* no audio / not supported */ }

  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' })); });

  const dur = video.duration || 0;
  let raf = 0;
  const loop = () => {
    drawFrame(ctx, W, H, video, liveOverlayCanvases());
    onProgress?.(video.currentTime, dur);
    raf = requestAnimationFrame(loop);
  };

  video.pause();
  video.currentTime = 0;
  await new Promise((r) => { const f = () => { video.removeEventListener('seeked', f); r(null); }; video.addEventListener('seeked', f); });
  await video.play();
  rec.start(250);
  loop();

  await new Promise<void>((res) => {
    const onEnd = () => res();
    video.addEventListener('ended', onEnd, { once: true });
    const watch = () => {
      if (video.ended || (dur && video.currentTime >= dur - 0.05)) res();
      else requestAnimationFrame(watch);
    };
    watch();
  });

  cancelAnimationFrame(raf);
  video.pause();
  rec.stop();
  return stopped;
}
