import { FEATURES, FEATURE_GROUPS } from '../features';
import type { CircleParams, FeatureId, Mode, ZoneParams, ZoomParams } from '../../../types';

const FEATURE_MODE: Record<string, Mode> = {
  circle: 'placing-halo', marker: 'placing-marker', text: 'placing-text',
  zone: 'drawing-zone', path: 'drawing-path', connector: 'drawing-connector',
  'zoom-in': 'placing-zoom',
};

type Props = {
  hasCalibration: boolean;
  selected: FeatureId;
  onSelect: (id: FeatureId) => void;
  mode: Mode;
  draftCount: number;
  circleParams: CircleParams;
  setCircleParams: (p: CircleParams) => void;
  zoneParams: ZoneParams;
  setZoneParams: (p: ZoneParams) => void;
  zoomParams: ZoomParams;
  setZoomParams: (p: ZoomParams) => void;
  onCreate: (id: FeatureId) => void;
  onFinishDraft: () => void;
  onCancelDraft: () => void;
};

export function HighlightPanel(p: Props) {
  const def = FEATURES.find((f) => f.id === p.selected)!;
  const myMode = FEATURE_MODE[p.selected];
  const active = p.mode === myMode;
  const isMulti = p.selected === 'zone' || p.selected === 'path'; // finish/cancel
  const isConnector = p.selected === 'connector';
  const isPoint = p.selected === 'circle' || p.selected === 'marker' || p.selected === 'text' || p.selected === 'zoom-in';

  return (
    <div className="panel">
      <div className="panel-title">Highlight · 효과</div>

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
      <div className="panel-subtitle">{def.label}</div>
      {!p.hasCalibration && <div className="warn-note">먼저 <b>Court</b> 탭에서 캘리브레이션하세요.</div>}
      <div className="panel-desc" style={{ marginTop: 0 }}>{def.hint}</div>

      {/* per-feature settings */}
      {p.selected === 'circle' && (
        <>
          <div className="field"><label>반지름 (m)</label>
            <input type="number" step="0.1" min="0.1" value={p.circleParams.radiusMeters}
              onChange={(e) => p.setCircleParams({ ...p.circleParams, radiusMeters: Number(e.target.value) || 0.1 })} /></div>
          <div className="field"><label>색상</label>
            <input type="color" value={p.circleParams.color} onChange={(e) => p.setCircleParams({ ...p.circleParams, color: e.target.value })} /></div>
          <div className="field"><label>투명도 {p.circleParams.opacity.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.05" value={p.circleParams.opacity}
              onChange={(e) => p.setCircleParams({ ...p.circleParams, opacity: Number(e.target.value) })} /></div>
        </>
      )}
      {p.selected === 'zone' && (
        <>
          <div className="field"><label>색상</label>
            <input type="color" value={p.zoneParams.color} onChange={(e) => p.setZoneParams({ ...p.zoneParams, color: e.target.value })} /></div>
          <div className="field"><label>투명도 {p.zoneParams.opacity.toFixed(2)}</label>
            <input type="range" min="0" max="1" step="0.05" value={p.zoneParams.opacity}
              onChange={(e) => p.setZoneParams({ ...p.zoneParams, opacity: Number(e.target.value) })} /></div>
        </>
      )}
      {p.selected === 'zoom-in' && (
        <div className="field"><label>배율 {p.zoomParams.scale.toFixed(1)}×</label>
          <input type="range" min="1.2" max="4" step="0.1" value={p.zoomParams.scale}
            onChange={(e) => p.setZoomParams({ ...p.zoomParams, scale: Number(e.target.value) })} /></div>
      )}

      {/* create / finish */}
      {!def.implemented ? (
        <button className="btn primary block" disabled>Create (곧)</button>
      ) : active && isMulti ? (
        <div className="btn-row">
          <button className="btn primary" onClick={p.onFinishDraft} disabled={p.draftCount < (p.selected === 'zone' ? 3 : 2)}>완료 ({p.draftCount})</button>
          <button className="btn" onClick={p.onCancelDraft}>취소</button>
        </div>
      ) : active && isConnector ? (
        <div className="btn-row">
          <span className="muted-note">두 지점을 클릭하세요 ({p.draftCount}/2)</span>
          <button className="btn" onClick={p.onCancelDraft}>취소</button>
        </div>
      ) : active && isPoint ? (
        <button className="btn primary block" onClick={() => p.onCreate(p.selected)}>배치 중 · 코트 클릭 (종료)</button>
      ) : (
        <button className="btn primary block" onClick={() => p.onCreate(p.selected)} disabled={!p.hasCalibration}>Create</button>
      )}
    </div>
  );
}
