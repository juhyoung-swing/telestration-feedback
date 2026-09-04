// H.264 → MP4 encoder using WebCodecs (VideoEncoder, hardware-accelerated in
// Chromium/Electron) + mp4-muxer. Push composited canvas frames; get an MP4
// ArrayBuffer (video only — audio is mixed/muxed separately, e.g. by ffmpeg).
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export const webCodecsAvailable = () =>
  typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;

// Pick an AVC codec string the encoder actually supports (level scales with size).
async function pickAvcCodec(width: number, height: number, fps: number, bitrate: number): Promise<string> {
  const candidates = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640020', 'avc1.42001f'];
  for (const codec of candidates) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps });
      if (s.supported) return codec;
    } catch { /* try next */ }
  }
  return 'avc1.42001f'; // baseline fallback
}

export class Mp4Encoder {
  private muxer!: Muxer<ArrayBufferTarget>;
  private encoder!: VideoEncoder;
  private frameDur: number; // microseconds per frame
  private idx = 0;
  private error: unknown = null;

  constructor(readonly width: number, readonly height: number, readonly fps = 30, readonly bitrate = 12_000_000) {
    this.frameDur = 1e6 / fps;
  }

  async init() {
    const codec = await pickAvcCodec(this.width, this.height, this.fps, this.bitrate);
    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: this.width, height: this.height },
      fastStart: 'in-memory',
    });
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (e) => { this.error = e; },
    });
    this.encoder.configure({ codec, width: this.width, height: this.height, bitrate: this.bitrate, framerate: this.fps });
  }

  /** Encode one frame from a canvas (drawn at width×height). Keyframe every ~2s. */
  addFrame(canvas: HTMLCanvasElement | OffscreenCanvas) {
    if (this.error) throw this.error;
    const frame = new VideoFrame(canvas as CanvasImageSource, { timestamp: Math.round(this.idx * this.frameDur), duration: Math.round(this.frameDur) });
    this.encoder.encode(frame, { keyFrame: this.idx % (this.fps * 2) === 0 });
    frame.close();
    this.idx++;
    // keep the encoder queue from ballooning during a fast render loop
    return this.encoder.encodeQueueSize;
  }

  get frameCount() { return this.idx; }

  async finish(): Promise<ArrayBuffer> {
    await this.encoder.flush();
    if (this.error) throw this.error;
    this.muxer.finalize();
    return this.muxer.target.buffer;
  }
}
