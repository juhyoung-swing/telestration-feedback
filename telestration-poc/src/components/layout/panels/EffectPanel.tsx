import { FEATURES, FEATURE_GROUPS } from '../features';
import { playersBySpan, posLabel } from '../../../geometry/tracking';
import type { CircleParams, FeatureId, Mode, PathArrow, PathParams, Players, ZoneParams, ZoomParams } from '../../../types';

const FEATURE_MODE: Record<string, Mode> = {
  circle: 'placing-halo', marker: 'placing-marker', text: 'placing-text',
  zone: 'drawing-zone', path: 'drawing-path', connector: 'drawing-connector',
  'zoom-in': 'placing-zoom',
};
const PLAYER_FEATURES: FeatureId[] = ['follow-circle', 'cutout', 'spotlight'];

type Props = {
  hasCalibration: boolean;
  // ── Player-effect application (chosen in the lower section) ──
  players: Players | null;
  onFollow: (id: string) => void;
  followedIds: Set<string>;
  onToggleCutout: (id: string) => void;
  cutoutIds: Set<string>;
  hasCutouts: boolean;
  onToggleSpotlight: (id: string) => void;
  spotlightIds: Set<string>;
  colors: string[];
  hasFragments: boolean;
  anchorCount: number;
  onStartPlayerCalib: () => void;
  onFinishPlayerCalib: () => void;
  onCancelPlayerCalib: () => void;
  // ── Effect catalog / court effects ──
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
  pathParams: PathParams;
  setPathParams: (p: PathParams) => void;
  selectedPath: PathArrow | null;             // a selected Path overlay → its bow is editable live
  onSetPathCurvature: (id: string, c: number) => void;
  textDraft: string;
  setTextDraft: (s: string) => void;
  onCreate: (id: FeatureId) => void;
  onFinishDraft: () => void;
  onCancelDraft: () => void;
};

export function EffectPanel(p: Props) {
  const def = FEATURES.find((f) => f.id === p.selected)!;
  const myMode = FEATURE_MODE[p.selected];
  const active = p.mode === myMode;
  const isMulti = p.selected === 'zone';
  const isTwoClick = p.selected === 'connector' || p.selected === 'path'; // start + end
  const isPoint = p.selected === 'circle' || p.selected === 'marker' || p.selected === 'text' || p.selected === 'zoom-in';
  const isPlayer = PLAYER_FEATURES.includes(p.selected);

  // Path: edit the selected path's bow if one is selected, else the defaults for new paths.
  const selPath = p.selectedPath;
  const pathIsParabola = selPath ? Math.abs(selPath.curvature) > 0.01 : p.pathParams.kind === 'parabola';
  const pathCurv = selPath ? selPath.curvature : p.pathParams.curvature;
  const setPathKind = (kind: 'straight' | 'parabola') => {
    if (selPath) p.onSetPathCurvature(selPath.id, kind === 'parabola' ? (p.pathParams.curvature || 2) : 0);
    else p.setPathParams({ ...p.pathParams, kind });
  };
  const setPathCurv = (v: number) => {
    if (selPath) p.onSetPathCurvature(selPath.id, v);
    else p.setPathParams({ ...p.pathParams, curvature: v });
  };

  const list = p.players ? playersBySpan(p.players) : [];
  const calibrating = p.mode === 'player-calibrating';

  // which apply handler + on-state + enablement the player rows use, per selected player-effect
  const apply = {
    'follow-circle': { fn: p.onFollow, set: p.followedIds, enabled: p.hasCalibration, why: '먼저 캘리브레이션이 필요합니다' },
    cutout: { fn: p.onToggleCutout, set: p.cutoutIds, enabled: p.hasCutouts, why: 'cutouts.json(실루엣)이 없습니다' },
    spotlight: { fn: p.onToggleSpotlight, set: p.spotlightIds, enabled: p.hasCalibration, why: '먼저 캘리브레이션이 필요합니다' },
  }[p.selected as 'follow-circle' | 'cutout' | 'spotlight'];

  return (
    <div className="panel">
      <div className="panel-title">Effect · 효과</div>
      {!p.hasCalibration && <div className="warn-note">먼저 <b>Court</b> 탭에서 캘리브레이션하세요.</div>}

      {/* ── tile catalog: Player / Tactic / Action ── */}
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
      <div className="panel-desc" style={{ marginTop: 0 }}>{def.hint}</div>

      {/* ── lower section ── player-effect → pick a player (+선수 지정); court effect → settings/Create */}
      {isPlayer ? (
        <>
          {p.selected === 'follow-circle' && (
            <>
              <div className="field"><label>반지름 (m)</label>
                <input type="number" step="0.1" min="0.1" value={p.circleParams.radiusMeters}
                  onChange={(e) => p.setCircleParams({ ...p.circleParams, radiusMeters: Number(e.target.value) || 0.1 })} /></div>
              <div className="field"><label>투명도 {p.circleParams.opacity.toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.05" value={p.circleParams.opacity}
                  onChange={(e) => p.setCircleParams({ ...p.circleParams, opacity: Number(e.target.value) })} /></div>
            </>
          )}

          <div className="field-label">선수 지정 (유저 캘리브레이션)</div>
          {!calibrating ? (
            <button className="btn" onClick={p.onStartPlayerCalib} disabled={!p.hasFragments}>선수 지정 시작</button>
          ) : (
            <div className="calib-hint">
              영상에서 각 선수를 순서대로 클릭 — 다음 <b className="accent">P{p.anchorCount + 1}</b> ({p.anchorCount}/4 지정됨).
              <div className="btn-row">
                <button className="btn primary" onClick={p.onFinishPlayerCalib} disabled={p.anchorCount < 2}>완료 ({p.anchorCount})</button>
                <button className="btn" onClick={p.onCancelPlayerCalib}>취소</button>
              </div>
              <div className="muted-note">클릭한 선수의 옷 색을 기준으로 나머지 조각을 자동 배정합니다.</div>
            </div>
          )}

          {!p.players ? (
            <div className="soon-note" style={{ marginTop: 8 }}>트래킹 데이터(players.json)를 불러오지 못했습니다.</div>
          ) : (
            <>
              <div className="muted-note" style={{ marginTop: 8 }}>선수를 눌러 <b>{def.label}</b>을 적용/해제합니다.</div>
              <div className="player-list">
                {list.map((pl) => {
                  const on = apply.set.has(pl.id);
                  const color = p.colors[(Number(pl.id) - 1) % p.colors.length];
                  return (
                    <div key={pl.id} className={`player-row ${on ? 'on' : ''}`}>
                      <span className="player-dot" style={{ background: color }} />
                      <span className="player-tag">P{pl.id}</span>
                      <span className="player-span">{posLabel(pl.medY)} <span className="muted">· {pl.t0.toFixed(0)}–{pl.t1.toFixed(0)}s</span></span>
                      <button
                        className={on ? 'btn sm active' : 'btn sm'}
                        onClick={() => apply.fn(pl.id)}
                        disabled={!apply.enabled}
                        title={apply.enabled ? `${def.label} 적용/해제` : apply.why}
                      >{on ? '해제' : '적용'}</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {/* per-feature settings (court effects) */}
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
          {p.selected === 'text' && (
            <div className="field"><label>라벨 내용</label>
              <input type="text" value={p.textDraft} placeholder="텍스트" maxLength={40}
                onChange={(e) => p.setTextDraft(e.target.value)} /></div>
          )}
          {p.selected === 'path' && (
            <>
              <div className="field"><label>모양{selPath ? ' (선택 편집)' : ''}</label>
                <div className="btn-row">
                  <button className={`btn sm ${!pathIsParabola ? 'active' : ''}`} onClick={() => setPathKind('straight')}>직선</button>
                  <button className={`btn sm ${pathIsParabola ? 'active' : ''}`} onClick={() => setPathKind('parabola')}>포물선</button>
                </div>
              </div>
              {pathIsParabola && (
                <div className="field"><label>굴곡 {pathCurv.toFixed(1)}m</label>
                  <input type="range" min="-5" max="5" step="0.1" value={pathCurv}
                    onChange={(e) => setPathCurv(Number(e.target.value))} /></div>
              )}
            </>
          )}

          {/* create / finish */}
          {active && isMulti ? (
            <div className="btn-row">
              <button className="btn primary" onClick={p.onFinishDraft} disabled={p.draftCount < 3}>완료 ({p.draftCount})</button>
              <button className="btn" onClick={p.onCancelDraft}>취소</button>
            </div>
          ) : active && isTwoClick ? (
            <div className="btn-row">
              <span className="muted-note">시작·끝 2점을 클릭하세요 ({p.draftCount}/2)</span>
              <button className="btn" onClick={p.onCancelDraft}>취소</button>
            </div>
          ) : active && isPoint ? (
            <button className="btn primary block" onClick={() => p.onCreate(p.selected)}>배치 중 · 코트 클릭 (종료)</button>
          ) : (
            <button className="btn primary block" onClick={() => p.onCreate(p.selected)} disabled={!p.hasCalibration}>Create</button>
          )}
        </>
      )}
    </div>
  );
}
