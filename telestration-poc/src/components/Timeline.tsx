import { useEffect, useRef, useState } from 'react';
import { useElementSize } from '../hooks/useElementSize';
import type { Overlay } from '../types';

const ICON: Record<Overlay['type'], string> = {
  'ground-halo': '◎', 'coverage-zone': '▰', marker: '📍', text: '🅣', path: '↝', connector: '🔗', cutout: '🧍', spotlight: '🔦', 'zoom-in': '🔍',
};
const MIN_LEN = 0.2;       // seconds
const SNAP_PX = 7;         // snap radius in screen px
const TICK_TARGET_PX = 72; // aim for ~one label per this many px

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Choose a "nice" tick step (seconds) so labels land ~TICK_TARGET_PX apart at this zoom.
function tickStep(pxPerSec: number): number {
  const cand = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of cand) if (s * pxPerSec >= TICK_TARGET_PX) return s;
  return 900;
}

type Props = {
  overlays: Overlay[];
  duration: number;
  currentTime: number;
  selectedId: string | null;
  videoName: string;
  zoom: number;               // 1 = fit whole clip; >1 = zoomed in
  snap: boolean;
  onBeginHistory: () => void; // called once at drag-start so a whole drag is one undo step
  onSelect: (id: string) => void;
  onSeek: (t: number) => void;
  onToggleVisible: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onChangeRange: (id: string, start: number, end: number) => void;
};

export function Timeline(p: Props) {
  const { ref: scrollRef, size } = useElementSize<HTMLDivElement>();
  const contentRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const dur = p.duration > 0 ? p.duration : 1;

  // px/second: zoom==1 fills the viewport exactly; higher zoom overflows → horizontal scroll.
  const viewW = size.width > 0 ? size.width : 800;
  const contentW = viewW * p.zoom;
  const pxPerSec = contentW / dur;
  const x = (t: number) => t * pxPerSec;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  // Keep the playhead in view when it moves off-screen (follow during playback / far scrubs).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const px = x(p.currentTime);
    const left = el.scrollLeft, right = left + el.clientWidth;
    if (px < left + 4 || px > right - 4) el.scrollLeft = clamp(px - el.clientWidth / 2, 0, contentW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.currentTime, pxPerSec]);

  const timeAt = (clientX: number) => {
    const el = contentRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return clamp((clientX - r.left) / pxPerSec, 0, dur);
  };
  const startPlayheadDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    p.onSeek(timeAt(e.clientX));
    const move = (ev: MouseEvent) => p.onSeek(timeAt(ev.clientX));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Snap a candidate time to the playhead / clip ends / other bars' edges (within SNAP_PX).
  const snapTime = (v: number, exceptId: string): number => {
    if (!p.snap) return v;
    const targets = [0, dur, p.currentTime];
    for (const o of p.overlays) if (o.id !== exceptId) targets.push(o.startTime, o.endTime);
    const th = SNAP_PX / pxPerSec;
    let best = v, bd = th;
    for (const t of targets) { const d = Math.abs(t - v); if (d < bd) { bd = d; best = t; } }
    return best;
  };

  const startBarDrag = (e: React.MouseEvent, kind: 'move' | 'trim-l' | 'trim-r', o: Overlay) => {
    e.preventDefault();
    e.stopPropagation();
    p.onSelect(o.id);
    const startX = e.clientX;
    const s0 = o.startTime, e0 = o.endTime, len = e0 - s0;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (!moved) { moved = true; p.onBeginHistory(); } // snapshot on first move → one undo step per drag
      const dt = (ev.clientX - startX) / pxPerSec;
      let s = s0, en = e0;
      if (kind === 'move') {
        s = clamp(s0 + dt, 0, dur - len);
        // snap whichever edge lands on a target, preserving length
        const ss = snapTime(s, o.id);
        if (ss !== s) s = clamp(ss, 0, dur - len);
        else { const se = snapTime(s + len, o.id); if (se !== s + len) s = clamp(se - len, 0, dur - len); }
        en = s + len;
      } else if (kind === 'trim-l') {
        s = clamp(snapTime(clamp(s0 + dt, 0, e0 - MIN_LEN), o.id), 0, e0 - MIN_LEN);
      } else {
        en = clamp(snapTime(clamp(e0 + dt, s0 + MIN_LEN, dur), o.id), s0 + MIN_LEN, dur);
      }
      p.onChangeRange(o.id, s, en);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const ordered = [...p.overlays].reverse(); // latest on top
  const step = tickStep(pxPerSec);
  const ticks: number[] = [];
  for (let t = 0; t <= dur + 0.001; t += step) ticks.push(Math.round(t));

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-content" ref={contentRef} style={{ width: contentW }}>
          <div className="tl-ruler" onMouseDown={startPlayheadDrag}>
            {ticks.map((t) => (
              <span key={t} className="tl-tick" style={{ left: x(t) }}>{fmt(t)}</span>
            ))}
          </div>

          <div className="tl-tracks" onMouseDown={startPlayheadDrag}>
            {ordered.map((o) => (
              <div className="tl-row" key={o.id}>
                <div
                  className={`tl-bar ${o.type} ${p.selectedId === o.id ? 'selected' : ''} ${o.visible ? '' : 'off'}`}
                  style={{ left: x(o.startTime), width: Math.max(2, x(o.endTime - o.startTime)) }}
                  onMouseDown={(e) => startBarDrag(e, 'move', o)}
                  onContextMenu={(e) => { e.preventDefault(); p.onSelect(o.id); setMenu({ x: e.clientX, y: e.clientY, id: o.id }); }}
                  title={`${o.name} · ${fmt(o.startTime)}–${fmt(o.endTime)}`}
                >
                  <div className="tl-handle l" onMouseDown={(e) => startBarDrag(e, 'trim-l', o)} />
                  <span className="tl-bar-label">{ICON[o.type]} {o.name}</span>
                  <button
                    className="tl-eye"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); p.onToggleVisible(o.id); }}
                    title={o.visible ? '숨기기' : '표시'}
                  >{o.visible ? '👁' : '⊘'}</button>
                  <div className="tl-handle r" onMouseDown={(e) => startBarDrag(e, 'trim-r', o)} />
                </div>
              </div>
            ))}

            {p.overlays.length === 0 && <div className="tl-empty">효과를 만들면 여기 타임라인에 트랙으로 표시됩니다 (Effect → Create)</div>}

            <div className="tl-row">
              <div className="tl-bar base" style={{ left: 0, width: contentW }} onMouseDown={(e) => e.stopPropagation()}>
                <span className="tl-bar-label">{p.videoName}</span>
                <span className="tl-badge">1x</span>
              </div>
            </div>
          </div>

          <div className="tl-playhead" style={{ left: x(p.currentTime) }} onMouseDown={startPlayheadDrag}>
            <div className="tl-playhead-head" />
          </div>
        </div>
      </div>

      {menu && (
        <ul className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <li onClick={() => { p.onRemove(menu.id); setMenu(null); }}>Remove ⌫</li>
          <li onClick={() => { p.onDuplicate(menu.id); setMenu(null); }}>Duplicate ⌘K</li>
          <li className="disabled">Speed ▸</li>
          <li className="disabled">Mute ⌘M</li>
        </ul>
      )}
    </div>
  );
}
