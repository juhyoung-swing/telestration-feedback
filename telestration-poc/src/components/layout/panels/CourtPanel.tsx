import { CORNER_LABELS } from '../../../geometry/court';
import { COURT_LINE_DEFS, courtLineDef } from '../../../geometry/lineCalib';
import type { Mode } from '../../../types';

type Props = {
  mode: Mode;
  hasCalibration: boolean;
  method: 'corner' | 'line' | null; // how the current calibration was made
  showGrid: boolean;
  draftCalibCount: number;
  // line calibration
  activeLineId: string | null;
  lineDraftCount: number;
  currentLineIds: string[];
  lineCoverage: { horizontal: number; vertical: number };
  canFinishLines: boolean;
  onStartCorner: () => void;
  onStartLine: () => void;
  onReset: () => void;
  onToggleGrid: () => void;
  onSelectLine: (id: string) => void;
  onFinishLine: () => void;
  onCancelLine: () => void;
};

export function CourtPanel(p: Props) {
  const nextCorner = CORNER_LABELS[p.draftCalibCount] ?? '완료';

  return (
    <div className="panel">
      <div className="panel-title">Court · 코트 보정</div>
      <p className="panel-desc">코트 4개 점 또는 선으로 호모그래피를 만듭니다. 그래픽은 코트 좌표(m)로 저장됩니다.</p>

      <div className="field-label">방식</div>
      <div className="btn-row">
        <button className={`btn ${p.mode === 'calibrating' ? 'active' : ''}`} onClick={p.onStartCorner}>
          {p.mode === 'calibrating' ? `모서리 클릭… (${p.draftCalibCount}/4)` : '모서리 4점'}
        </button>
        <button className={`btn ${p.mode === 'line-calibrating' ? 'active' : ''}`} onClick={p.onStartLine}>
          {p.mode === 'line-calibrating' ? '선 그리는 중…' : '선으로'}
        </button>
      </div>

      {p.mode === 'calibrating' && (
        <div className="calib-hint">
          더블스 모서리를 순서대로 클릭 — 다음 <b className="accent">{nextCorner}</b>
          <div className="chip-wrap">
            {CORNER_LABELS.map((l, i) => (
              <span key={i} className={`mini-chip ${i < p.draftCalibCount ? 'done' : i === p.draftCalibCount ? 'now' : ''}`}>{l}</span>
            ))}
          </div>
        </div>
      )}

      {p.mode === 'line-calibrating' && (
        <div className="calib-hint">
          그릴 선을 고르고 그 선 위를 <b>2점+</b> 클릭. 끝점(코너)은 안 찍어도 됩니다.
          <div className="chip-wrap">
            {COURT_LINE_DEFS.map((d) => {
              const isActive = p.activeLineId === d.id;
              const isDone = p.currentLineIds.includes(d.id) && !(isActive && p.lineDraftCount < 2);
              return (
                <button key={d.id} className={`mini-chip ${d.family} ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`} onClick={() => p.onSelectLine(d.id)}>
                  {isDone ? '✓ ' : ''}{d.label}
                </button>
              );
            })}
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={p.onFinishLine} disabled={!p.canFinishLines}>
              완료 · H 계산 ({p.currentLineIds.length}선)
            </button>
            <button className="btn" onClick={p.onCancelLine}>취소</button>
          </div>
          <div className="muted-note">
            가로 {p.lineCoverage.horizontal} · 세로 {p.lineCoverage.vertical}
            {p.activeLineId ? ` · 지금 ${courtLineDef(p.activeLineId).label} (${p.lineDraftCount}점)` : ' · 선을 고르세요'}
          </div>
        </div>
      )}

      <div className="panel-divider" />

      <label className="switch-row">
        <input type="checkbox" checked={p.showGrid} onChange={p.onToggleGrid} disabled={!p.hasCalibration} />
        <span>코트 그리드 (디버그)</span>
      </label>

      <button className="btn subtle" onClick={p.onReset} disabled={!p.hasCalibration && p.mode !== 'calibrating' && p.mode !== 'line-calibrating'}>
        캘리브레이션 리셋
      </button>

      <div className={`status-pill ${p.hasCalibration ? 'ok' : ''}`}>
        {p.hasCalibration ? `캘리브레이션 완료 ✓ (${p.method === 'line' ? '선' : '모서리'})` : '캘리브레이션 없음'}
      </div>
    </div>
  );
}
