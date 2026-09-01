import { useEffect, useRef, useState } from 'react';

// Top-right ⚙ Settings dropdown (next to Export) — project-level actions:
// re-calibrate the court and (desktop only) re-run player analysis.
export function SettingsDropdown({ onRecalibrate, onReanalyze, analyzed }: {
  onRecalibrate: () => void;
  onReanalyze?: () => void; // undefined when local ML (Electron) is unavailable
  analyzed: boolean;
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
          <button className="btn block" onClick={() => { setOpen(false); onRecalibrate(); }}>🎯 코트 재보정</button>
          {onReanalyze && (
            <button className="btn block" onClick={() => { setOpen(false); onReanalyze(); }}>
              🏃 {analyzed ? '선수 재분석' : '선수 분석'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
