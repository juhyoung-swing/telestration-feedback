// (b2) Editing toolbar. Undo / Delete / Play-Pause are real; Redo / Split / zoom
// are visual placeholders (v1 shell) to match the SportsBuddy layout.
export function EditingToolbar({
  playing,
  onPlayPause,
  onUndo,
  canUndo,
  onDelete,
  canDelete,
  cur,
  dur,
}: {
  playing: boolean;
  onPlayPause: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onDelete: () => void;
  canDelete: boolean;
  cur: number;
  dur: number;
}) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="edit-toolbar">
      <button className="tool" onClick={onUndo} disabled={!canUndo} title="실행취소">↶</button>
      <button className="tool" disabled title="다시실행 (곧)">↷</button>
      <button className="tool" disabled title="분할 (곧)">✂</button>
      <button className="tool play" onClick={onPlayPause} title={playing ? '일시정지' : '재생'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="tool danger" onClick={onDelete} disabled={!canDelete} title="선택 레이어 삭제">🗑</button>

      <span className="time">{fmt(cur)} <span className="muted">/ {fmt(dur)}</span></span>

      <div className="zoom-slider" title="타임라인 줌 (곧)">
        <span>−</span>
        <input type="range" min="0" max="100" defaultValue="50" disabled />
        <span>+</span>
      </div>
    </div>
  );
}
