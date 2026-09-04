// Fast source-frame provider for the offline exporter: demux the MP4 (mp4box) and
// decode with WebCodecs VideoDecoder — hardware-accelerated, sequential, NO per-frame
// <video> seeking (which cost ~27ms/frame). Forward requests stream from the decoder;
// a backward request (repeat / reorder) resets to the nearest keyframe.
import { createFile, MP4BoxBuffer, DataStream } from 'mp4box';
import type { Sample } from 'mp4box';

export const videoDecodeAvailable = () => typeof window !== 'undefined' && 'VideoDecoder' in window;

// avcC/hvcC/… codec description bytes from a sample entry (strip the 8-byte box header).
function descriptionOf(sample: Sample): Uint8Array | undefined {
  const entry = sample.description as unknown as Record<string, { write: (s: DataStream) => void }>;
  const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0); // default big-endian (MP4)
  box.write(stream);
  return new Uint8Array((stream.buffer as ArrayBuffer).slice(8));
}

export class SourceDecoder {
  private samples: Sample[] = [];
  private timescale = 1;
  private codec = 'avc1.640028';
  private description?: Uint8Array;
  private decoder: VideoDecoder | null = null;
  private queue: VideoFrame[] = [];      // decoded frames waiting, ascending timestamp (µs)
  private nextFeed = 0;                   // next sample index to feed
  private lastReq = -1;                   // last requested source time (s)
  private ready: Promise<void>;

  constructor(bytes: ArrayBuffer) { this.ready = this.load(bytes); }

  private load(bytes: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createFile();
      file.onError = (e: unknown) => reject(new Error(String(e)));
      file.onReady = (info) => {
        const track = info.videoTracks[0];
        if (!track) { reject(new Error('영상 트랙 없음')); return; }
        this.timescale = track.timescale;
        this.codec = (track as unknown as { codec: string }).codec;
        file.setExtractionOptions(track.id, null, { nbSamples: Number.MAX_SAFE_INTEGER });
        file.start();
      };
      file.onSamples = (_id, _u, s: Sample[]) => { for (const x of s) this.samples.push(x); };
      file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes.slice(0), 0), true);
      file.flush();
      if (!this.samples.length) { reject(new Error('샘플 추출 실패')); return; }
      this.description = descriptionOf(this.samples[0]);
      this.configureDecoder();
      resolve();
    });
  }

  private configureDecoder() {
    this.decoder = new VideoDecoder({ output: (f) => this.onFrame(f), error: () => {} });
    const cfg: VideoDecoderConfig = { codec: this.codec };
    if (this.description) cfg.description = this.description;
    this.decoder.configure(cfg);
  }

  private waiters: Array<() => void> = [];
  private notify() { if (!this.waiters.length) return; const ws = this.waiters; this.waiters = []; for (const r of ws) r(); }
  // Resolve as soon as the decoder emits ANY frame (its output callback is a macrotask,
  // so a microtask/`Promise.resolve()` would never let it run); `ms` guards against a
  // stuck decoder. This replaces a `setTimeout(0)` drain whose nested-timeout 4ms clamp
  // cost ~4ms per requested frame.
  private waitOutput(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(fin, ms);
      this.waiters.push(fin);
    });
  }

  private onFrame(f: VideoFrame) {
    // keep the queue sorted by timestamp
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].timestamp > f.timestamp) i--;
    this.queue.splice(i, 0, f);
    this.notify();
  }

  private sec(s: Sample) { return s.cts / this.timescale; }

  private feedOne() {
    const s = this.samples[this.nextFeed++];
    this.decoder!.decode(new EncodedVideoChunk({
      type: s.is_sync ? 'key' : 'delta',
      timestamp: Math.round((s.cts / this.timescale) * 1e6),
      duration: Math.round((s.duration / this.timescale) * 1e6),
      data: s.data as Uint8Array,
    }));
  }

  private seekToKeyframe(targetSec: number) {
    let ki = 0;
    for (let i = 0; i < this.samples.length; i++) {
      if (this.sec(this.samples[i]) > targetSec) break;
      if (this.samples[i].is_sync) ki = i;
    }
    this.decoder!.reset();
    this.configureDecoder();
    for (const f of this.queue) f.close();
    this.queue = [];
    this.nextFeed = ki;
  }

  private hasFrameAtOrAfter(us: number) { return this.queue.some((f) => f.timestamp >= us); }

  /** The decoded frame nearest to `sourceSec`. Caller must call frame.close() after drawing. */
  async frameAt(sourceSec: number): Promise<VideoFrame | null> {
    await this.ready;
    if (!this.decoder) return null;
    if (sourceSec < this.lastReq - 0.001) this.seekToKeyframe(sourceSec); // backward jump
    this.lastReq = sourceSec;
    const targetUs = sourceSec * 1e6;

    let spins = 0;
    while (!this.hasFrameAtOrAfter(targetUs) && spins < 200_000) {
      spins++;
      while (this.decoder.decodeQueueSize < 16 && this.nextFeed < this.samples.length) this.feedOne();
      if (this.nextFeed >= this.samples.length) { await this.decoder.flush().catch(() => {}); break; } // EOF: drain tail
      await this.waitOutput(200); // wake on the next decoded frame (not a fixed timeout)
    }
    // pick the closest frame; close the ones before it
    let best: VideoFrame | null = null;
    const keep: VideoFrame[] = [];
    for (const f of this.queue) {
      if (f.timestamp <= targetUs + 1) { if (best) best.close(); best = f; }
      else if (!best) { best = f; }         // nothing at/before → take first after
      else keep.push(f);
    }
    this.queue = keep;
    return best;
  }

  dispose() {
    for (const f of this.queue) f.close();
    this.queue = [];
    try { this.decoder?.close(); } catch { /* ignore */ }
  }
}
