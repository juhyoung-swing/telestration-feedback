import { FEATURES, FEATURE_GROUPS } from '../features';
import type { CircleParams, FeatureId, Mode, ZoneParams } from '../../../types';

type Props = {
  hasCalibration: boolean;
  selected: FeatureId;
  onSelect: (id: FeatureId) => void;
  mode: Mode;
  draftZoneCount: number;
  circleParams: CircleParams;
  setCircleParams: (p: CircleParams) => void;
  zoneParams: ZoneParams;
  setZoneParams: (p: ZoneParams) => void;
  onCreateCircle: () => void;
  onCancelCircle: () => void;
  onCreateZone: () => void;
  onFinishZone: () => void;
  onCancelZone: () => void;
};

export function HighlightPanel(p: Props) {
  const def = FEATURES.find((f) => f.id === p.selected)!;

  return (
    <div className="panel">
      <div className="panel-title">Highlight · 효과</div>

      {/* (a2) feature list, grouped like SportsBuddy */}
      {FEATURE_GROUPS.map((g) => (
        <div key={g} className="feature-group">
          <div className="field-label">{g}</div>
          <div className="feature-grid">
            {FEATURES.filter((f) => f.group === g).map((f) => (
              <button
                key={f.id}
                className={`feature-tile ${p.selected === f.id ? 'active' : ''} ${f.implemented ? '' : 'soon'}`}
                onClick={() => p.onSelect(f.id)}
                title={f.hint}
              >
                <span className="feature-icon">{f.icon}</span>
                <span className="feature-name">{f.label}</span>
                {!f.implemented && <span className="soon-tag">곧</span>}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="panel-divider" />

      {/* (a3) feature settings + Create */}
      <div className="panel-subtitle">{def.label}</div>
      {!p.hasCalibration && <div className="warn-note">먼저 <b>Court</b> 탭에서 캘리브레이션하세요.</div>}

      {p.selected === 'circle' && (
        <>
          <div className="field">
            <label>반지름 (m)</label>
            <input type="number" step="0.1" min="0.1" value={p.circleParams.radiusMeters}
              onChange={(e) => p.setCircleParams({ ...p.circleParams, radiusMeters: Number(e.target.value) || 0.1 })} />
          </div>
          <div className="field">
            <label>색상</label>
            <input type="color" value={p.circleParams.color} onChange={(e) => p.setCircleParams({ ...p.circleParams, color: e.target.value })} />
          </div>
          <div className="field">
            <label>투명도 {p.circleParams.opacity.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.05" value={p.circleParams.opacity}
              onChange={(e) => p.setCircleParams({ ...p.circleParams, opacity: Number(e.target.value) })} />
          </div>
          {p.mode === 'placing-halo' ? (
            <button className="btn primary block" onClick={p.onCancelCircle}>배치 중 · 코트 클릭 (종료)</button>
          ) : (
            <button className="btn primary block" onClick={p.onCreateCircle} disabled={!p.hasCalibration}>Create</button>
          )}
        </>
      )}

      {p.selected === 'zone' && (
        <>
          <div className="field">
            <label>색상</label>
            <input type="color" value={p.zoneParams.color} onChange={(e) => p.setZoneParams({ ...p.zoneParams, color: e.target.value })} />
          </div>
          <div className="field">
            <label>투명도 {p.zoneParams.opacity.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.05" value={p.zoneParams.opacity}
              onChange={(e) => p.setZoneParams({ ...p.zoneParams, opacity: Number(e.target.value) })} />
          </div>
          {p.mode === 'drawing-zone' ? (
            <div className="btn-row">
              <button className="btn primary" onClick={p.onFinishZone} disabled={p.draftZoneCount < 3}>완료 ({p.draftZoneCount})</button>
              <button className="btn" onClick={p.onCancelZone}>취소</button>
            </div>
          ) : (
            <button className="btn primary block" onClick={p.onCreateZone} disabled={!p.hasCalibration}>Create</button>
          )}
        </>
      )}

      {!def.implemented && (
        <>
          <div className="soon-note">{def.hint}</div>
          <button className="btn primary block" disabled>Create</button>
        </>
      )}
    </div>
  );
}
