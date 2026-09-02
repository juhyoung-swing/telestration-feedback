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
  const nextCorner = CORNER_LABELS[p.draftCalibCount] ?? '완료';

  return (
    <div className="panel">
      <div className="panel-title">Court · 코트 보정</div>

      <div className="field-label">보정 방식</div>
      <div className="btn-row">
        <button className={`btn ${p.mode === 'calibrating' ? 'active' : ''}`} onClick={p.onStartCorner}>
          {p.mode === 'calibrating' ? `꼭짓점 클릭… (${p.draftCalibCount}/4)` : '꼭짓점 4개'}
        </button>
        <button className={`btn ${p.mode === 'line-calibrating' ? 'active' : ''}`} onClick={p.onStartLine}>
          {p.mode === 'line-calibrating' ? '라인 그리는 중…' : '코트 라인'}
        </button>
      </div>

      {p.mode === 'calibrating' && (
        <div className="calib-hint">
          코트 네 꼭짓점을 순서대로 클릭 — 다음 <b className="accent">{nextCorner}</b>
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
        {p.hasCalibration ? `보정 완료 ✓ (${p.method === 'line' ? '라인' : '꼭짓점'})` : '아직 보정 안 됨'}
      </div>
    </div>
  );
}
