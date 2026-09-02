import { useEffect, useRef, useState } from 'react';

// Top-right Export button → screenshot (PNG) and video (MP4) export.
export function ExportDropdown({ onScreenshot, onExportVideo }: {
  onScreenshot: () => Promise<void> | void;
  onExportVideo: (onProgress: (t: number, dur: number) => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'shot' | 'video'>(null);
  const [prog, setProg] = useState({ t: 0, dur: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (busy) return; // don't close mid-export (keep the progress visible)
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, busy]);

  const runShot = async () => {
    setBusy('shot');
    try { await onScreenshot(); } finally { setBusy(null); }
  };
  const runVideo = async () => {
    setBusy('video');
    setProg({ t: 0, dur: 0 });
    try { await onExportVideo((t, dur) => setProg({ t, dur })); } finally { setBusy(null); }
  };

  const pct = prog.dur ? Math.min(100, Math.round((prog.t / prog.dur) * 100)) : 0;

  return (
    <div className="export-dd" ref={ref}>
      <button className="btn primary sm" onClick={() => setOpen((o) => !o)}>Export ▾</button>
      {open && (
        <div className="export-pop">
          <div className="panel-subtitle">내보내기</div>
          <button className="btn block" disabled={!!busy} onClick={runShot}>📷 스크린샷 저장 (PNG)</button>
          <button className="btn primary block" disabled={!!busy} onClick={runVideo}>🎬 영상 내보내기 (MP4)</button>
          {busy === 'video' && (
            <div className="analyze-progress">
              <div className="analyze-bar"><div className="analyze-bar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="analyze-pct">{pct}% · 녹화 중… (영상 길이만큼 실시간 소요)</div>
            </div>
          )}
          {busy === 'shot' && <div className="muted-note">저장 중…</div>}
          <div className="muted-note">오버레이·줌·슬로모가 그대로 반영됩니다.</div>
        </div>
      )}
    </div>
  );
}
