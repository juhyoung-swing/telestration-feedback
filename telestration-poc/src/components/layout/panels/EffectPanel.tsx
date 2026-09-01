import { FEATURES, FEATURE_GROUPS } from '../features';
import { playersBySpan, posLabel } from '../../../geometry/tracking';
import type { CircleParams, FeatureId, Mode, Overlay, PathArrow, PathParams, Players, SpeedSegment, TextLabel, TextParams, ZoneParams, ZoomParams } from '../../../types';

const FEATURE_MODE: Record<string, Mode> = {
  circle: 'placing-halo', marker: 'placing-marker', text: 'placing-text',
  zone: 'drawing-zone', path: 'drawing-path', connector: 'drawing-connector',
  'zoom-in': 'placing-zoom',
};
const PLAYER_FEATURES: FeatureId[] = ['follow-circle', 'spotlight'];

type Props = {
  hasCalibration: boolean;
  // ── Player-effect application (chosen in the lower section) ──
  players: Players | null;
  onFollow: (id: string) => void;
  followedIds: Set<string>;
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
  selectedPath: PathArrow | null;             // a selected Path overlay → editable live
  onUpdatePath: (id: string, patch: Partial<{ shape: 'line' | 'arc'; height: number; dashed: boolean; color: string }>) => void;
  onEditPath: () => void;                       // enter endpoint-drag mode
  editingPath: boolean;
  onFinishEditPath: () => void;
  textDraft: string;
  setTextDraft: (s: string) => void;
  textParams: TextParams;
  setTextParams: (p: TextParams) => void;
  selectedText: TextLabel | null;
  onUpdateText: (id: string, patch: Partial<TextLabel>) => void;
  onEditText: () => void;
  editingText: boolean;
  onFinishEditText: () => void;
  slowmoRate: number;
  setSlowmoRate: (r: number) => void;
  selectedSpeed: SpeedSegment | null;
  onUpdateSpeed: (id: string, rate: number) => void;
  selectedOverlay: Overlay | null;
  onPatchOverlay: (id: string, patch: object) => void;
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

  // Path: a selected path is edited live; otherwise the buttons/slider set defaults for new paths.
  const selPath = p.selectedPath;
  const showHeight = selPath ? selPath.shape === 'arc' : p.pathParams.shape === 'arc';
  const heightVal = selPath && selPath.shape === 'arc' ? selPath.height : p.pathParams.height;
  const setHeight = (v: number) => {
    if (selPath && selPath.shape === 'arc') p.onUpdatePath(selPath.id, { height: v });
    else p.setPathParams({ ...p.pathParams, height: v });
  };
  const pathColor = selPath?.color ?? p.pathParams.color;
  const pathDashed = selPath?.dashed ?? p.pathParams.dashed;
  const setPathColor = (c: string) => (selPath ? p.onUpdatePath(selPath.id, { color: c }) : p.setPathParams({ ...p.pathParams, color: c }));
  const setPathDashed = (d: boolean) => (selPath ? p.onUpdatePath(selPath.id, { dashed: d }) : p.setPathParams({ ...p.pathParams, dashed: d }));

  // Text: a selected text box is edited live; otherwise the controls set defaults for new text.
  const selText = p.selectedText;
  const t = selText ?? p.textParams;
  const tSet = (patch: Partial<TextParams>) => (selText ? p.onUpdateText(selText.id, patch) : p.setTextParams({ ...p.textParams, ...patch }));

  // Circle / Zone / Marker / Connector: a selected overlay is edited live, else the defaults.
  const selHalo = p.selectedOverlay?.type === 'ground-halo' ? p.selectedOverlay : null;
  const selMarker = p.selectedOverlay?.type === 'marker' ? p.selectedOverlay : null;
  const selZone = p.selectedOverlay?.type === 'coverage-zone' ? p.selectedOverlay : null;
  const selConn = p.selectedOverlay?.type === 'connector' ? p.selectedOverlay : null;
  const cVal = { radiusMeters: selHalo?.radiusMeters ?? p.circleParams.radiusMeters, color: selHalo?.color ?? p.circleParams.color, opacity: selHalo?.opacity ?? p.circleParams.opacity };
  const cSet = (patch: Partial<CircleParams>) => (selHalo ? p.onPatchOverlay(selHalo.id, patch) : p.setCircleParams({ ...p.circleParams, ...patch }));
  const zVal = { color: selZone?.color ?? p.zoneParams.color, opacity: selZone?.opacity ?? p.zoneParams.opacity };
  const zSet = (patch: Partial<ZoneParams>) => (selZone ? p.onPatchOverlay(selZone.id, patch) : p.setZoneParams({ ...p.zoneParams, ...patch }));

  // Slow-mo: rate of a selected speed segment, or the default for new ones.
  const selSpeed = p.selectedSpeed;
  const speedRate = selSpeed ? selSpeed.rate : p.slowmoRate;
  const setSpeedRate = (r: number) => (selSpeed ? p.onUpdateSpeed(selSpeed.id, r) : p.setSlowmoRate(r));

  const list = p.players ? playersBySpan(p.players) : [];
  const calibrating = p.mode === 'player-calibrating';

  // which apply handler + on-state + enablement the player rows use, per selected player-effect
  const apply = {
    'follow-circle': { fn: p.onFollow, set: p.followedIds, enabled: p.hasCalibration, why: '먼저 캘리브레이션이 필요합니다' },
    spotlight: { fn: p.onToggleSpotlight, set: p.spotlightIds, enabled: p.hasCalibration, why: '먼저 캘리브레이션이 필요합니다' },
  }[p.selected as 'follow-circle' | 'spotlight'];

  return (
    <div className="panel">
      <div className="panel-title">Effect · 효과</div>
      {!p.hasCalibration && <div className="warn-note">코트 보정이 필요합니다 — 상단 <b>재보정</b>을 누르세요. (화면 위 텍스트·직선·배속은 보정 없이도 가능)</div>}

      {/* ── tile catalog: Player / Tactic / Action ── */}
      {FEATURE_GROUPS.map((g) => (
        <div key={g} className="feature-group">
          <div className="field-label">{g}</div>
          <div className="feature-grid">
            {FEATURES.filter((f) => f.group === g).map((f) => (
              <button
                key={f.id}
                className={`feature-tile ${p.selected === f.id ? 'active' : ''} ${f.implemented ? '' : 'soon'}`}
                onClick={() => { p.onSelect(f.id); if (!PLAYER_FEATURES.includes(f.id)) p.onCreate(f.id); }}
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
                <input type="number" step="0.1" min="0.1" value={cVal.radiusMeters}
                  onChange={(e) => cSet({ radiusMeters: Number(e.target.value) || 0.1 })} /></div>
              <div className="field"><label>투명도 {cVal.opacity.toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.05" value={cVal.opacity}
                  onChange={(e) => cSet({ opacity: Number(e.target.value) })} /></div>
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
                <input type="number" step="0.1" min="0.1" value={cVal.radiusMeters}
                  onChange={(e) => cSet({ radiusMeters: Number(e.target.value) || 0.1 })} /></div>
              <div className="field"><label>색상</label>
                <input type="color" value={cVal.color} onChange={(e) => cSet({ color: e.target.value })} /></div>
              <div className="field"><label>투명도 {cVal.opacity.toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.05" value={cVal.opacity}
                  onChange={(e) => cSet({ opacity: Number(e.target.value) })} /></div>
            </>
          )}
          {p.selected === 'zone' && (
            <>
              <div className="field"><label>색상</label>
                <input type="color" value={zVal.color} onChange={(e) => zSet({ color: e.target.value })} /></div>
              <div className="field"><label>투명도 {zVal.opacity.toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.05" value={zVal.opacity}
                  onChange={(e) => zSet({ opacity: Number(e.target.value) })} /></div>
            </>
          )}
          {p.selected === 'marker' && selMarker && (
            <div className="field"><label>색상</label>
              <input type="color" value={selMarker.color ?? '#FF3B3B'} onChange={(e) => p.onPatchOverlay(selMarker.id, { color: e.target.value })} /></div>
          )}
          {p.selected === 'connector' && selConn && (
            <div className="field"><label>색상</label>
              <input type="color" value={selConn.color ?? '#00E5FF'} onChange={(e) => p.onPatchOverlay(selConn.id, { color: e.target.value })} /></div>
          )}
          {p.selected === 'zoom-in' && (
            <div className="field"><label>배율 {p.zoomParams.scale.toFixed(1)}×</label>
              <input type="range" min="1.2" max="4" step="0.1" value={p.zoomParams.scale}
                onChange={(e) => p.setZoomParams({ ...p.zoomParams, scale: Number(e.target.value) })} /></div>
          )}
          {p.selected === 'slowmo' && (
            <div className="field"><label>배속{selSpeed ? ' (선택 편집)' : ''}</label>
              <select value={speedRate} onChange={(e) => setSpeedRate(Number(e.target.value))}>
                <option value={0.25}>0.25× (아주 느리게)</option>
                <option value={0.5}>0.5× (느리게)</option>
                <option value={0.75}>0.75×</option>
                <option value={1.5}>1.5× (빠르게)</option>
                <option value={2}>2×</option>
              </select></div>
          )}
          {p.selected === 'text' && (
            <>
              <div className="field"><label>내용</label>
                <input type="text" value={selText ? selText.text : p.textDraft} placeholder="텍스트" maxLength={120}
                  onChange={(e) => (selText ? p.onUpdateText(selText.id, { text: e.target.value }) : p.setTextDraft(e.target.value))} /></div>
              <div className="field"><label>글자 크기 {t.fontSize}px</label>
                <input type="range" min="10" max="72" step="1" value={t.fontSize} onChange={(e) => tSet({ fontSize: Number(e.target.value) })} /></div>
              <div className="field"><label>폰트</label>
                <select value={t.fontFamily} onChange={(e) => tSet({ fontFamily: e.target.value })}>
                  <option value="sans-serif">기본 (고딕)</option>
                  <option value="serif">명조</option>
                  <option value="monospace">고정폭</option>
                </select></div>
              <div className="field"><label>글자 색</label>
                <input type="color" value={t.color ?? '#FFFFFF'} onChange={(e) => tSet({ color: e.target.value })} /></div>
              <div className="field"><label>스타일 · 정렬</label>
                <div className="btn-row">
                  <button className={`btn sm ${t.bold ? 'active' : ''}`} onClick={() => tSet({ bold: !t.bold })}><b>B</b></button>
                  <button className={`btn sm ${t.align === 'left' ? 'active' : ''}`} onClick={() => tSet({ align: 'left' })}>좌</button>
                  <button className={`btn sm ${t.align === 'center' ? 'active' : ''}`} onClick={() => tSet({ align: 'center' })}>중</button>
                  <button className={`btn sm ${t.align === 'right' ? 'active' : ''}`} onClick={() => tSet({ align: 'right' })}>우</button>
                </div></div>
              <div className="field"><label>배경</label>
                <div className="btn-row">
                  <button className={`btn sm ${t.bg ? 'active' : ''}`} onClick={() => tSet({ bg: true })}>켜기</button>
                  <button className={`btn sm ${!t.bg ? 'active' : ''}`} onClick={() => tSet({ bg: false })}>끄기</button>
                </div></div>
              {t.bg && (
                <>
                  <div className="field"><label>배경 색</label>
                    <input type="color" value={t.bgColor} onChange={(e) => tSet({ bgColor: e.target.value })} /></div>
                  <div className="field"><label>배경 투명도 {t.bgOpacity.toFixed(2)}</label>
                    <input type="range" min="0" max="1" step="0.05" value={t.bgOpacity} onChange={(e) => tSet({ bgOpacity: Number(e.target.value) })} /></div>
                </>
              )}
              {selText && (
                <button className={`btn sm block ${p.editingText ? 'active' : ''}`} onClick={p.editingText ? p.onFinishEditText : p.onEditText}>
                  {p.editingText ? '박스 편집 완료' : '박스 편집 (드래그로 이동·크기)'}
                </button>
              )}
            </>
          )}
          {p.selected === 'path' && !selPath && (
            <div className="field"><label>모양</label>
              <div className="btn-row">
                <button className={`btn sm ${p.pathParams.shape === 'court-line' ? 'active' : ''}`} onClick={() => p.setPathParams({ ...p.pathParams, shape: 'court-line' })}>직선·맵</button>
                <button className={`btn sm ${p.pathParams.shape === 'screen-line' ? 'active' : ''}`} onClick={() => p.setPathParams({ ...p.pathParams, shape: 'screen-line' })}>직선·화면</button>
                <button className={`btn sm ${p.pathParams.shape === 'arc' ? 'active' : ''}`} onClick={() => p.setPathParams({ ...p.pathParams, shape: 'arc' })}>포물선·3D</button>
              </div>
            </div>
          )}
          {p.selected === 'path' && selPath && (
            <>
              <div className="muted-note">선택된 Path 편집 · {selPath.space === 'screen' ? '화면' : '맵'}</div>
              {selPath.space === 'court' && (
                <div className="field"><label>모양</label>
                  <div className="btn-row">
                    <button className={`btn sm ${selPath.shape === 'line' ? 'active' : ''}`} onClick={() => p.onUpdatePath(selPath.id, { shape: 'line', height: 0 })}>직선</button>
                    <button className={`btn sm ${selPath.shape === 'arc' ? 'active' : ''}`} onClick={() => p.onUpdatePath(selPath.id, { shape: 'arc', height: p.pathParams.height || 0.4 })}>포물선·3D</button>
                  </div>
                </div>
              )}
              <button className={`btn sm block ${p.editingPath ? 'active' : ''}`} onClick={p.editingPath ? p.onFinishEditPath : p.onEditPath}>
                {p.editingPath ? '이동 완료' : '위치 편집 (끝점 드래그)'}
              </button>
            </>
          )}
          {p.selected === 'path' && showHeight && (
            <div className="field"><label>높이 {heightVal.toFixed(2)}</label>
              <input type="range" min="0" max="1.2" step="0.05" value={heightVal}
                onChange={(e) => setHeight(Number(e.target.value))} /></div>
          )}
          {p.selected === 'path' && (
            <>
              <div className="field"><label>색상</label>
                <input type="color" value={pathColor} onChange={(e) => setPathColor(e.target.value)} /></div>
              <div className="field"><label>선</label>
                <div className="btn-row">
                  <button className={`btn sm ${!pathDashed ? 'active' : ''}`} onClick={() => setPathDashed(false)}>실선</button>
                  <button className={`btn sm ${pathDashed ? 'active' : ''}`} onClick={() => setPathDashed(true)}>대시</button>
                </div>
              </div>
            </>
          )}

          {/* while a tool is armed: finish/cancel (no Create button — tiles arm placement directly) */}
          {active && isMulti ? (
            <div className="armed">
              <span className="muted-note">코트를 클릭해 영역을 그리세요 ({p.draftCount}점)</span>
              <div className="btn-row">
                <button className="btn primary" onClick={p.onFinishDraft} disabled={p.draftCount < 3}>완료 ({p.draftCount})</button>
                <button className="btn" onClick={p.onCancelDraft}>취소</button>
              </div>
            </div>
          ) : active && isTwoClick ? (
            <div className="armed">
              <span className="muted-note">시작·끝 2점을 클릭하세요 ({p.draftCount}/2)</span>
              <button className="btn block" onClick={p.onCancelDraft}>취소</button>
            </div>
          ) : active && isPoint ? (
            <div className="armed">
              <span className="muted-note">코트를 클릭해 배치하세요 · Esc 취소</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
