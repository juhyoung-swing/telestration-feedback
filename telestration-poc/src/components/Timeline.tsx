import { useEffect, useRef, useState } from 'react';
import { useElementSize } from '../hooks/useElementSize';
import { clipDur } from '../lib/clips';
import type { Clip } from '../lib/clips';
import type { Narration, Overlay } from '../types';

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
  speed: number;              // preview playback rate (shown on the base track)
  loop: { start: number; end: number } | null; // A-B repeat band (null = off)
  onSetLoop: (l: { start: number; end: number } | null) => void;
  clips: Clip[];                       // base-video EDL → clip bars on the base track
  clipAnalyzed: Record<string, { pos: boolean; pose: boolean }>; // per-clip analysis coverage
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onSplitClip: () => void;             // split the clip under the playhead
  onDuplicateClip: (id: string) => void;
  onDeleteClip: (id: string) => void;
  onMoveClip: (id: string, toIndex: number) => void;
  onInsertGap: (afterId: string) => void; // insert a black gap clip after this one
  onInsertVideo: (clipId: string) => void; // insert another video (fill a gap / split at playhead)
  narrations: Narration[];             // voice-over segments → their own timeline track
  onMoveNarration: (id: string, startTime: number) => void;
  onDeleteNarration: (id: string) => void;
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
  const [clipMenu, setClipMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [clipDrag, setClipDrag] = useState<{ id: string; dx: number } | null>(null);
  const dur = p.duration > 0 ? p.duration : 1;

  // px/second: zoom==1 fills the viewport exactly; higher zoom overflows → horizontal scroll.
  const viewW = size.width > 0 ? size.width : 800;
  const contentW = viewW * p.zoom;
  const pxPerSec = contentW / dur;
  const x = (t: number) => t * pxPerSec;

  useEffect(() => {
    if (!menu && !clipMenu) return;
    const close = () => { setMenu(null); setClipMenu(null); };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu, clipMenu]);

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

  // A-B repeat band: drag body to move, edges to resize. Snaps to overlay edges / playhead / ends.
  const startLoopDrag = (e: React.MouseEvent, kind: 'move' | 'trim-l' | 'trim-r') => {
    if (!p.loop) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const s0 = p.loop.start, e0 = p.loop.end, len = e0 - s0;
    const move = (ev: MouseEvent) => {
      const dt = (ev.clientX - startX) / pxPerSec;
      let s = s0, en = e0;
      if (kind === 'move') { s = clamp(snapTime(clamp(s0 + dt, 0, dur - len), '') , 0, dur - len); en = s + len; }
      else if (kind === 'trim-l') { s = clamp(snapTime(clamp(s0 + dt, 0, e0 - MIN_LEN), ''), 0, e0 - MIN_LEN); }
      else { en = clamp(snapTime(clamp(e0 + dt, s0 + MIN_LEN, dur), ''), s0 + MIN_LEN, dur); }
      p.onSetLoop({ start: s, end: en });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Drag a base-video clip horizontally to reorder it (contiguous). A plain click
  // (no drag) just selects it. Drop position → insertion index among the other clips.
  const startClipDrag = (e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    p.onSelectClip(clip.id);
    const startX = e.clientX;
    let moved = false;
    const move = (ev: MouseEvent) => { const dx = ev.clientX - startX; if (Math.abs(dx) > 3) moved = true; setClipDrag({ id: clip.id, dx }); };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setClipDrag(null);
      if (moved) {
        const dropT = timeAt(ev.clientX);
        const others = p.clips.filter((c) => c.id !== clip.id);
        let idx = 0;
        for (const c of others) if (dropT > c.timelineStart + clipDur(c) / 2) idx++;
        p.onMoveClip(clip.id, idx);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Drag a narration bar to reposition its start time (snaps to edges/playhead).
  const startNarrDrag = (e: React.MouseEvent, n: Narration) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, s0 = n.startTime;
    const move = (ev: MouseEvent) => p.onMoveNarration(n.id, Math.max(0, snapTime(s0 + (ev.clientX - startX) / pxPerSec, '')));
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
            {p.narrations.length > 0 && (
              <div className="tl-row tl-narrrow">
                {p.narrations.map((n) => (
                  <div key={n.id} className="tl-narr"
                    style={{ left: x(n.startTime), width: Math.max(26, x(n.dur)) }}
                    onMouseDown={(e) => startNarrDrag(e, n)}
                    onContextMenu={(e) => { e.preventDefault(); p.onDeleteNarration(n.id); }}
                    title={`나레이션 ${fmt(n.startTime)} · ${n.dur.toFixed(1)}s (우클릭: 삭제)`}
                  >
                    <span className="tl-narr-label">🎙 {n.dur.toFixed(1)}s</span>
                  </div>
                ))}
              </div>
            )}
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
                  <span className="tl-bar-label">{o.name}</span>
                  <div className="tl-handle r" onMouseDown={(e) => startBarDrag(e, 'trim-r', o)} />
                </div>
              </div>
            ))}

            {p.overlays.length === 0 && <div className="tl-empty">효과를 만들면 여기 타임라인에 트랙으로 표시됩니다 (Effect → Create)</div>}

            <div className="tl-row tl-cliprow">
              {p.clips.map((c, i) => {
                const dragging = clipDrag?.id === c.id;
                const a = p.clipAnalyzed[c.id];
                const isGapClip = c.kind === 'gap';
                const isFreezeClip = c.kind === 'freeze';
                const isInsertedClip = !isGapClip && !isFreezeClip && !!c.sourceId;
                const special = isGapClip || isFreezeClip || isInsertedClip;
                return (
                  <div
                    key={c.id}
                    className={`tl-clip ${isGapClip ? 'gap' : ''} ${isFreezeClip ? 'freeze' : ''} ${isInsertedClip ? 'inserted' : ''} ${p.selectedClipId === c.id ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
                    style={{ left: x(c.timelineStart) + (dragging ? clipDrag!.dx : 0), width: Math.max(6, x(clipDur(c))), zIndex: dragging ? 6 : 1 }}
                    onMouseDown={(e) => startClipDrag(e, c)}
                    onContextMenu={(e) => { e.preventDefault(); p.onSelectClip(c.id); setClipMenu({ x: e.clientX, y: e.clientY, id: c.id }); }}
                    title={isGapClip ? `빈 구간(검정) · ${clipDur(c).toFixed(1)}s`
                      : isFreezeClip ? `⏸ 홀드(정지) · ${fmt(c.srcFreeze ?? 0)} · ${clipDur(c).toFixed(1)}s`
                      : isInsertedClip ? `🎞 삽입 영상 · ${clipDur(c).toFixed(1)}s`
                      : `${p.videoName} · 클립 ${i + 1} · ${fmt(c.srcStart)}–${fmt(c.srcEnd)}${a?.pos ? ' · 위치분석✓' : ''}${a?.pose ? ' · 자세분석✓' : ''} (우클릭: 분할·복제·삭제)`}
                  >
                    <span className="tl-clip-label">{isGapClip ? '⬛ 빈 구간' : isFreezeClip ? '⏸ 홀드' : isInsertedClip ? '🎞 영상' : `🎬 ${i + 1}`}</span>
                    {!special && a?.pos && <span className="clip-dot pos" title="위치 분석됨" />}
                    {!special && a?.pose && <span className="clip-dot pose" title="자세 분석됨" />}
                    {i === 0 && !special && <span className="tl-badge">{p.speed}×</span>}
                  </div>
                );
              })}
              {p.clips.length === 0 && (
                <div className="tl-bar base" style={{ left: 0, width: contentW }} onMouseDown={(e) => e.stopPropagation()}>
                  <span className="tl-bar-label">{p.videoName}</span>
                </div>
              )}
            </div>
          </div>

          {p.loop && (
            <div
              className="tl-loop"
              style={{ left: x(p.loop.start), width: Math.max(6, x(p.loop.end - p.loop.start)) }}
            >
              <div className="tl-loop-move" onMouseDown={(e) => startLoopDrag(e, 'move')} title="반복 구간 이동 (양끝: 길이 조절)">
                🔁 {fmt(p.loop.start)}–{fmt(p.loop.end)}
              </div>
              <div className="tl-loop-handle l" onMouseDown={(e) => startLoopDrag(e, 'trim-l')} />
              <div className="tl-loop-handle r" onMouseDown={(e) => startLoopDrag(e, 'trim-r')} />
            </div>
          )}

          <div className="tl-playhead" style={{ left: x(p.currentTime) }} onMouseDown={startPlayheadDrag}>
            <div className="tl-playhead-head" />
          </div>
        </div>
      </div>

      {menu && (
        <ul className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <li onClick={() => { p.onToggleVisible(menu.id); setMenu(null); }}>
            {p.overlays.find((o) => o.id === menu.id)?.visible ? '숨기기' : '표시'}
          </li>
          <li onClick={() => { p.onDuplicate(menu.id); setMenu(null); }}>Duplicate ⌘K</li>
          <li onClick={() => { p.onRemove(menu.id); setMenu(null); }}>Remove ⌫</li>
        </ul>
      )}

      {clipMenu && (
        <ul className="ctx-menu" style={{ left: clipMenu.x, top: clipMenu.y }} onClick={(e) => e.stopPropagation()}>
          <li onClick={() => { p.onSplitClip(); setClipMenu(null); }}>재생헤드에서 분할 ✂</li>
          <li onClick={() => { p.onDuplicateClip(clipMenu.id); setClipMenu(null); }}>복제 · 반복 ⧉</li>
          <li onClick={() => { p.onInsertVideo(clipMenu.id); setClipMenu(null); }}>영상 삽입 🎞</li>
          <li onClick={() => { p.onInsertGap(clipMenu.id); setClipMenu(null); }}>뒤에 빈 구간(검정) 추가 ⬛</li>
          <li className={p.clips.length <= 1 ? 'disabled' : ''}
            onClick={() => { if (p.clips.length > 1) { p.onDeleteClip(clipMenu.id); setClipMenu(null); } }}>삭제 ⌫</li>
        </ul>
      )}
    </div>
  );
}
