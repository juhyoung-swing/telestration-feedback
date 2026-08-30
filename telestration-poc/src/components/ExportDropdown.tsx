import { useEffect, useRef, useState } from 'react';

// Top-right Export button → dropdown popover (replaces the old right column).
// Contents are a visual placeholder — no backend/export in this POC.
export function ExportDropdown({ videoName }: { videoName: string }) {
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
      <button className="btn primary sm" onClick={() => setOpen((o) => !o)}>Export ▾</button>
      {open && (
        <div className="export-pop">
          <div className="panel-subtitle">Export Settings</div>
          <div className="field"><label>Name</label><input type="text" defaultValue={videoName} disabled /></div>
          <div className="field"><label>Quality</label><select disabled defaultValue="high"><option value="high">High</option></select></div>
          <button className="btn primary block" disabled>⬆ New Export</button>
          <button className="btn block" disabled>Download File</button>
          <div className="share-row">
            <button className="icon-btn" disabled>𝕏</button>
            <button className="icon-btn" disabled>f</button>
            <button className="icon-btn" disabled>r</button>
            <button className="icon-btn" disabled>🔗</button>
          </div>
          <div className="demo-note">데모 UI · 백엔드/Export 없음 (POC)</div>
        </div>
      )}
    </div>
  );
}
