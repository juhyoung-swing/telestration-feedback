// (b2) Editing toolbar. Undo / Delete / Play-Pause / timeline-zoom / snap are real;
// Redo / Split are visual placeholders (removed in a later UX pass).
const ZMIN = 1, ZMAX = 16;

export function EditingToolbar({
  playing,
  onPlayPause,
  onUndo,
  canUndo,
  onDelete,
  canDelete,
  cur,
  dur,
  zoom,
  onZoom,
  snap,
  onToggleSnap,
}: {
  playing: boolean;
  onPlayPause: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onDelete: () => void;
  canDelete: boolean;
  cur: number;
  dur: number;
  zoom: number;
  onZoom: (z: number) => void;
  snap: boolean;
  onToggleSnap: () => void;
}) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const clampZ = (z: number) => Math.max(ZMIN, Math.min(ZMAX, +z.toFixed(3)));
  return (
    <div className="edit-toolbar">
      <button className="tool" onClick={onUndo} disabled={!canUndo} title="실행취소">↶</button>
      <button className="tool" disabled title="다시실행 (곧)">↷</button>
      <button className="tool" disabled title="분할 (곧)">✂</button>
      <button className="tool play" onClick={onPlayPause} title={playing ? '일시정지 (Space)' : '재생 (Space)'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="tool danger" onClick={onDelete} disabled={!canDelete} title="선택 레이어 삭제 (⌫)">🗑</button>
      <button
        className={`tool ${snap ? 'on' : ''}`}
        onClick={onToggleSnap}
        title={`스냅 ${snap ? '켜짐' : '꺼짐'} (S) — 드래그 시 플레이헤드·경계에 붙음`}
      >🧲</button>

      <span className="time">{fmt(cur)} <span className="muted">/ {fmt(dur)}</span></span>

      <div className="zoom-slider" title="타임라인 줌 (+/−)">
        <button className="zoom-btn" onClick={() => onZoom(clampZ(zoom / 1.5))} disabled={zoom <= ZMIN} title="축소 (−)">−</button>
        <input
          type="range" min={ZMIN} max={ZMAX} step="0.1" value={zoom}
          onChange={(e) => onZoom(clampZ(Number(e.target.value)))}
        />
        <button className="zoom-btn" onClick={() => onZoom(clampZ(zoom * 1.5))} disabled={zoom >= ZMAX} title="확대 (+)">+</button>
      </div>
    </div>
  );
}
