// (b2) Editing toolbar: Undo / Redo / Split / Play-Pause / Delete / snap / timeline-zoom.
const ZMIN = 1, ZMAX = 16;

export function EditingToolbar({
  playing,
  onPlayPause,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onSplit,
  canSplit,
  onDelete,
  canDelete,
  cur,
  dur,
  speed,
  onSpeed,
  zoom,
  onZoom,
  loopOn,
  onToggleLoop,
  recording,
  onToggleRecord,
}: {
  playing: boolean;
  onPlayPause: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onRedo: () => void;
  canRedo: boolean;
  onSplit: () => void;
  canSplit: boolean;
  onDelete: () => void;
  canDelete: boolean;
  cur: number;
  dur: number;
  speed: number;
  onSpeed: (s: number) => void;
  zoom: number;
  onZoom: (z: number) => void;
  loopOn: boolean;
  onToggleLoop: () => void;
  recording: boolean;
  onToggleRecord: () => void;
}) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const clampZ = (z: number) => Math.max(ZMIN, Math.min(ZMAX, +z.toFixed(3)));
  return (
    <div className="edit-toolbar">
      <button className="tool" onClick={onUndo} disabled={!canUndo} title="실행취소">↶</button>
      <button className="tool" onClick={onRedo} disabled={!canRedo} title="다시실행">↷</button>
      <button className="tool" onClick={onSplit} disabled={!canSplit} title="선택 효과를 플레이헤드에서 분할">✂</button>
      <button className="tool play" onClick={onPlayPause} title={playing ? '일시정지 (Space)' : '재생 (Space)'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="tool danger" onClick={onDelete} disabled={!canDelete} title="선택 레이어 삭제 (⌫)">🗑</button>
      <button
        className={`tool ${loopOn ? 'on' : ''}`}
        onClick={onToggleLoop}
        title={loopOn ? '구간 반복 끄기 (타임라인 밴드 드래그로 조절)' : '구간 반복 — 재생헤드에 반복 밴드 추가'}
      >🔁</button>
      <button
        className={`tool ${recording ? 'rec' : ''}`}
        onClick={onToggleRecord}
        title={recording ? '녹음 중지' : '음성 나레이션 녹음 — 재생헤드부터 재생되며 마이크 녹음'}
      >{recording ? '⏺ 녹음중' : '🎙'}</button>

      <span className="time">{fmt(cur)} <span className="muted">/ {fmt(dur)}</span></span>

      <select className="speed-sel" value={speed} onChange={(e) => onSpeed(Number(e.target.value))} title="재생 배속">
        <option value={0.25}>0.25×</option>
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={1.5}>1.5×</option>
        <option value={2}>2×</option>
      </select>

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
