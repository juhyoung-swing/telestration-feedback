import { CORNER_LABELS } from '../../../geometry/court';
import { COURT_LINE_DEFS, courtLineDef } from '../../../geometry/lineCalib';
import type { Mode } from '../../../types';

type Props = {
  mode: Mode;
  hasCalibration: boolean;
  method: 'corner' | 'line' | null; // how the current calibration was made
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
  onSelectLine: (id: string) => void;
  onFinishLine: () => void;
  onCancelLine: () => void;
};

export function CourtPanel(p: Props) {
  return (
    <div className="panel">
      <div className="panel-title">바닥면 보정</div>

      <div className="field-label">보정 방식</div>
      <div className="btn-row">
        <button className={`btn ${p.mode === 'calibrating' ? 'active' : ''}`} onClick={p.onStartCorner}>
          {p.mode === 'calibrating' ? `점 찍는 중… (${p.draftCalibCount}/4)` : '점으로 보정'}
        </button>
        <button className={`btn ${p.mode === 'line-calibrating' ? 'active' : ''}`} onClick={p.onStartLine}>
          {p.mode === 'line-calibrating' ? '선 그리는 중…' : '선으로 보정'}
        </button>
      </div>

      {p.mode === 'calibrating' && (
        <div className="calib-hint">
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

      <button className="btn subtle" onClick={p.onReset} disabled={!p.hasCalibration && p.mode !== 'calibrating' && p.mode !== 'line-calibrating'}>
        보정 초기화
      </button>

      <div className={`status-pill ${p.hasCalibration ? 'ok' : ''}`}>
        {p.hasCalibration ? `보정 완료 ✓ (${p.method === 'line' ? '선' : '점'})` : '아직 보정 안 됨'}
      </div>
    </div>
  );
}
