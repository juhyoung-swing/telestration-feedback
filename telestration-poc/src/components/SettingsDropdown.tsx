import { useEffect, useRef, useState } from 'react';

// Top-right ⚙ Settings dropdown (next to Export) — project-level actions.
// (Player/pose analysis is now per-clip, done from the clip inspector.)
export function SettingsDropdown({ onRecalibrate }: {
  onRecalibrate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="export-dd" ref={ref}>
      <button className="btn ghost sm" onClick={() => setOpen((o) => !o)} title="설정">⚙ 설정 ▾</button>
      {open && (
        <div className="export-pop settings-pop">
          <div className="panel-subtitle">설정</div>
          <button className="btn block" onClick={() => { setOpen(false); onRecalibrate(); }}>🎯 바닥면 재보정</button>
        </div>
      )}
    </div>
  );
}
