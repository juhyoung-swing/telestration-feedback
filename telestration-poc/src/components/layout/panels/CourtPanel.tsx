import { CORNER_LABELS } from '../../../geometry/court';
import { COURT_LINE_DEFS } from '../../../geometry/lineCalib';
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
      <div className="panel-head">
        <div className="panel-title">바닥면 보정</div>
        <div className="panel-desc">화면 속 바닥을 실제 코트 좌표에 맞춰, 원·존·따라가기 효과가 바닥에 딱 붙어 움직이게 합니다.</div>
      </div>

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

      {p.mode === 'line-calibrating' && (() => {
        const isLineDone = (id: string) =>
          p.currentLineIds.includes(id) && !(p.activeLineId === id && p.lineDraftCount < 2);
        const renderChip = (d: (typeof COURT_LINE_DEFS)[number]) => {
          const isActive = p.activeLineId === d.id;
          const isDone = isLineDone(d.id);
          return (
            <button key={d.id} className={`mini-chip ${d.family} ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`} onClick={() => p.onSelectLine(d.id)}>
              {isDone ? '✓ ' : ''}{d.label}
            </button>
          );
        };
        const required = COURT_LINE_DEFS.filter((d) => d.required);
        const extra = COURT_LINE_DEFS.filter((d) => !d.required);
        const requiredDone = required.filter((d) => isLineDone(d.id)).length;
        return (
          <div className="calib-hint">
            <div className="line-section">
              <div className="line-group-label">필수 <span className="lg-count">{requiredDone}/4</span></div>
              <div className="chip-wrap">{required.map(renderChip)}</div>
            </div>

            <div className="line-section-sep" />

            <div className="line-section">
              <div className="line-group-label muted">추가</div>
              <div className="chip-wrap">{extra.map(renderChip)}</div>
              <div className="line-group-desc">더 찍을수록 정확하게 그릴 수 있습니다.</div>
            </div>

            <div className="btn-row line-actions">
              <button className="btn primary" onClick={p.onFinishLine} disabled={!p.canFinishLines}>완료</button>
              <button className="btn" onClick={p.onCancelLine}>취소</button>
            </div>
          </div>
        );
      })()}

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
