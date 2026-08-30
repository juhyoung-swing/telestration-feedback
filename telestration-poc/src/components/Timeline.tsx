import { useEffect, useRef, useState } from 'react';
import type { Overlay } from '../types';

const ICON: Record<Overlay['type'], string> = { 'ground-halo': '◎', 'coverage-zone': '▰' };
const MIN_LEN = 0.2; // seconds

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function ticks(dur: number): number[] {
  const step = dur <= 10 ? 2 : dur <= 30 ? 5 : dur <= 120 ? 15 : 60;
  const out: number[] = [];
  for (let t = 0; t <= dur + 0.001; t += step) out.push(Math.round(t));
  return out;
}

type Props = {
  overlays: Overlay[];
  duration: number;
  currentTime: number;
  selectedId: string | null;
  videoName: string;
  onSelect: (id: string) => void;
  onSeek: (t: number) => void;
  onToggleVisible: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onChangeRange: (id: string, start: number, end: number) => void;
};

export function Timeline(p: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const dur = p.duration > 0 ? p.duration : 1;
  const pct = (t: number) => `${(t / dur) * 100}%`;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  // seek from a pointer x within the tracks area
  const seekAt = (clientX: number) => {
    const el = areaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    p.onSeek(clamp(((clientX - r.left) / r.width) * dur, 0, dur));
  };
  const startPlayheadDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    seekAt(e.clientX);
    const move = (ev: MouseEvent) => seekAt(ev.clientX);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // move / trim a bar
  const startBarDrag = (e: React.MouseEvent, kind: 'move' | 'trim-l' | 'trim-r', o: Overlay) => {
    e.preventDefault();
    e.stopPropagation();
    p.onSelect(o.id);
    const el = areaRef.current;
    if (!el) return;
    const width = el.getBoundingClientRect().width;
    const startX = e.clientX;
    const s0 = o.startTime, e0 = o.endTime, len = e0 - s0;
    const move = (ev: MouseEvent) => {
      const dt = ((ev.clientX - startX) / width) * dur;
      let s = s0, en = e0;
      if (kind === 'move') { s = clamp(s0 + dt, 0, dur - len); en = s + len; }
      else if (kind === 'trim-l') { s = clamp(s0 + dt, 0, e0 - MIN_LEN); }
      else { en = clamp(e0 + dt, s0 + MIN_LEN, dur); }
      p.onChangeRange(o.id, s, en);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const ordered = [...p.overlays].reverse(); // latest on top

  return (
    <div className="timeline">
      <div className="tl-ruler" onMouseDown={startPlayheadDrag}>
        {ticks(dur).map((t) => (
          <span key={t} className="tl-tick" style={{ left: pct(t) }}>{fmt(t)}</span>
        ))}
        <span className="tl-time">{fmt(p.currentTime)} <span className="muted">/ {fmt(dur)}</span></span>
      </div>

      <div className="tl-tracks" ref={areaRef}>
        {ordered.map((o) => (
          <div className="tl-row" key={o.id}>
            <div
              className={`tl-bar ${o.type} ${p.selectedId === o.id ? 'selected' : ''} ${o.visible ? '' : 'off'}`}
              style={{ left: pct(o.startTime), width: pct(Math.max(0, o.endTime - o.startTime)) }}
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

        {p.overlays.length === 0 && <div className="tl-empty">효과를 만들면 여기 타임라인에 트랙으로 표시됩니다 (Highlight → Create)</div>}

        <div className="tl-row">
          <div className="tl-bar base" style={{ left: 0, width: '100%' }}>
            <span className="tl-bar-label">🎞 {p.videoName}</span>
            <span className="tl-badge">1x</span>
          </div>
        </div>

        <div className="tl-playhead" style={{ left: pct(p.currentTime) }} onMouseDown={startPlayheadDrag} />
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
