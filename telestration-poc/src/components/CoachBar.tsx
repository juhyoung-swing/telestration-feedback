// Live-authoring control strip above the timeline. Play and TALK (voice → narration
// track); mid-take FREEZE the frame (hold + keep talking) and DRAW. Everything lands
// on the editable timeline — no flattened video. These three actions are the heart of
// coach feedback, so they get a dedicated bar rather than hiding among the effect tiles.
export function CoachBar({
  recording,
  onToggleRecord,
  frozen,
  onToggleFreeze,
  penOn,
  onTogglePen,
  penColor,
  penWidth,
  onPenColor,
  onPenWidth,
}: {
  recording: boolean;
  onToggleRecord: () => void;
  frozen: boolean;
  onToggleFreeze: () => void;
  penOn: boolean;
  onTogglePen: () => void;
  penColor: string;
  penWidth: number;
  onPenColor: (c: string) => void;
  onPenWidth: (w: number) => void;
}) {
  return (
    <div className={`coach-bar ${recording ? 'recording' : ''}`}>
      <button className={`coach-btn rec ${recording ? 'on' : ''}`} onClick={onToggleRecord}
        title={recording ? '녹음 정지 — 음성이 나레이션 트랙으로 타임라인에 남습니다' : '녹음 시작 — 재생하며 말하면 음성이 타임라인에 기록됩니다'}>
        {recording ? '■ 녹음 정지' : '● 녹음 시작'}
      </button>

      <button className={`coach-btn ${frozen ? 'on' : ''}`} onClick={onToggleFreeze}
        title={recording
          ? (frozen ? '재개 — 여기까지 정지 화면(홀드)으로 타임라인에 남깁니다' : '화면 정지 — 멈춘 채 계속 설명하세요 (홀드로 기록)')
          : '화면 정지(홀드) — 재생헤드에 3초 정지 화면 삽입'}>
        {frozen ? '▶ 재개' : '⏸ 화면 정지'}
      </button>

      <button className={`coach-btn ${penOn ? 'on' : ''}`} onClick={onTogglePen}
        title="그리기 — 화면에 드래그해서 그립니다 (프리핸드 트랙으로 기록). 다시 누르면 끄기">
        ✏️ 그리기
      </button>
      <span className="coach-pen-opts">
        <input type="color" value={penColor} onChange={(e) => onPenColor(e.target.value)} title="그리기 색" />
        <input type="range" min={1} max={16} step={1} value={penWidth} onChange={(e) => onPenWidth(Number(e.target.value))} title={`선 굵기 ${penWidth}px`} />
      </span>

      {recording && <span className="coach-hint">{frozen ? '정지 화면에 설명 중… ▶ 재개로 계속' : '녹음 중 — 말하고 · ⏸로 멈춰 설명 · ✏️로 그리기'}</span>}
    </div>
  );
}
