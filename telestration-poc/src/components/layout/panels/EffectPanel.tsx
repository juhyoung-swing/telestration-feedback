import { useState } from 'react';
import { FEATURES, FEATURE_GROUPS } from '../features';
import { playersBySpan } from '../../../geometry/tracking';
import type { CircleParams, FeatureId, Mode, Overlay, PathArrow, PathParams, Players, PoseAngleId, PoseOverlay, SpeedSegment, TextLabel, TextParams, ZoneParams, ZoomParams } from '../../../types';

const FEATURE_MODE: Record<string, Mode> = {
  circle: 'placing-halo', marker: 'placing-marker', text: 'placing-text',
  zone: 'drawing-zone', path: 'drawing-path', connector: 'drawing-connector',
  sector: 'drawing-sector', 'zoom-in': 'placing-zoom',
};
const PLAYER_FEATURES: FeatureId[] = ['follow-circle', 'spotlight', 'pose'];
const POSE_ANGLES: { id: PoseAngleId; label: string }[] = [
  { id: 'elbow', label: '팔꿈치' }, { id: 'knee', label: '무릎' },
  { id: 'rotation', label: '어깨-엉덩이' }, { id: 'trunk', label: '몸통' },
];

type Props = {
  hasCalibration: boolean;
  // ── Player-effect application (chosen in the lower section) ──
  players: Players | null;
  onFollow: (id: string) => void;
  followedIds: Set<string>;
  playerStyleFor: (id: string) => { color: string; dashed: boolean }; // per-player follow-circle style
  onSetPlayerStyle: (id: string, patch: Partial<{ color: string; dashed: boolean }>) => void;
  onToggleSpotlight: (id: string) => void;
  spotlightIds: Set<string>;
  poseReady: boolean;          // 자세 분석 data present → 폼 추적 unlocked
  poseAnalyzed: boolean;
  posePlayerIds: string[];     // player labels available in the pose cache
  onAddPose: (id: string) => void;
  posedIds: Set<string>;
  colors: string[];
  hasFragments: boolean;
  anchorCount: number;
  onStartPlayerCalib: () => void;
  onFinishPlayerCalib: () => void;
  onCancelPlayerCalib: () => void;
  onGoAnalyze?: () => void; // desktop only: jump to the 선수 분석 step (undefined when local ML unavailable)
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
  onUpdatePath: (id: string, patch: Partial<{ shape: 'line' | 'arc'; height: number; dashed: boolean; color: string; drawOn: boolean; drawSec: number; drawDelay: number; drawEase: 'linear' | 'inout'; drawReverse: boolean; drawLoop: boolean }>) => void;
  textDraft: string;
  setTextDraft: (s: string) => void;
  textParams: TextParams;
  setTextParams: (p: TextParams) => void;
  selectedText: TextLabel | null;
  onUpdateText: (id: string, patch: Partial<TextLabel>) => void;
  slowmoRate: number;
  setSlowmoRate: (r: number) => void;
  selectedSpeed: SpeedSegment | null;
  onUpdateSpeed: (id: string, rate: number) => void;
  selectedOverlay: Overlay | null;
  onPatchOverlay: (id: string, patch: object) => void;
  onCreate: (id: FeatureId) => void;
  onFinishDraft: () => void;
  onCancelDraft: () => void;
  section?: 'tiles' | 'detail'; // render only the tile catalog (left) or the selected-item detail (right)
};

// Shared draw-on animation section (Path, Circle, …). `set` patches the selected overlay or defaults.
type AnimPatch = Partial<{ drawOn: boolean; drawSec: number; drawDelay: number; drawEase: 'linear' | 'inout'; drawReverse: boolean; drawLoop: boolean }>;
function AnimationControls({ on, sec, delay, ease, reverse, loop, set }: {
  on: boolean; sec: number; delay: number; ease: 'linear' | 'inout'; reverse: boolean; loop: boolean; set: (patch: AnimPatch) => void;
}) {
  return (
    <>
      <div className="field-label" style={{ marginTop: 4 }}>애니메이션</div>
      <div className="anim-grid">
        <button className={`anim-card ${!on ? 'active' : ''}`} onClick={() => set({ drawOn: false })}><span className="anim-icon">—</span><span className="anim-name">없음</span></button>
        <button className={`anim-card ${on ? 'active' : ''}`} onClick={() => set({ drawOn: true })}><span className="anim-icon">✏️</span><span className="anim-name">그리기</span></button>
      </div>
      {on && (
        <>
          <div className="field"><label>그리는 시간 {sec.toFixed(1)}s</label>
            <input type="range" min="0.3" max="3" step="0.1" value={sec} onChange={(e) => set({ drawSec: Number(e.target.value) })} /></div>
          <div className="field"><label>지연 {delay.toFixed(1)}s</label>
            <input type="range" min="0" max="5" step="0.1" value={delay} onChange={(e) => set({ drawDelay: Number(e.target.value) })} /></div>
          <div className="field"><label>속도 곡선</label>
            <div className="btn-row">
              <button className={`btn sm ${ease === 'linear' ? 'active' : ''}`} onClick={() => set({ drawEase: 'linear' })}>등속</button>
              <button className={`btn sm ${ease === 'inout' ? 'active' : ''}`} onClick={() => set({ drawEase: 'inout' })}>부드럽게</button>
            </div></div>
          <div className="field"><label>방향</label>
            <div className="btn-row">
              <button className={`btn sm ${!reverse ? 'active' : ''}`} onClick={() => set({ drawReverse: false })}>정방향</button>
              <button className={`btn sm ${reverse ? 'active' : ''}`} onClick={() => set({ drawReverse: true })}>역방향</button>
            </div></div>
          <div className="field"><label>반복</label>
            <div className="btn-row">
              <button className={`btn sm ${!loop ? 'active' : ''}`} onClick={() => set({ drawLoop: false })}>끄기</button>
              <button className={`btn sm ${loop ? 'active' : ''}`} onClick={() => set({ drawLoop: true })}>켜기</button>
            </div></div>
        </>
      )}
    </>
  );
}

export function EffectPanel(p: Props) {
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null); // per-player accordion (follow-circle)
  const def = FEATURES.find((f) => f.id === p.selected)!;
  const myMode = FEATURE_MODE[p.selected];
  const active = p.mode === myMode;
  const isMulti = p.selected === 'zone';
  const isTwoClick = p.selected === 'connector' || p.selected === 'path' || p.selected === 'sector'; // start + end
  const isPoint = p.selected === 'circle' || p.selected === 'marker' || p.selected === 'text' || p.selected === 'zoom-in';
  const isPlayer = PLAYER_FEATURES.includes(p.selected);
  const isPose = p.selected === 'pose';
  const playersReady = !!p.players; // false when 위치 분석 was skipped / not run → follow/spotlight locked
  // per-feature gate: 폼 추적 needs 자세 분석; the others need 위치 분석
  const featLocked = (id: FeatureId) => (id === 'pose' ? !p.poseReady : (PLAYER_FEATURES.includes(id) && !playersReady));
  const readyForSelected = isPose ? p.poseReady : playersReady;
  const selPose = p.selectedOverlay?.type === 'pose' ? (p.selectedOverlay as PoseOverlay) : null;

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
  const pathDrawOn = selPath?.drawOn ?? p.pathParams.drawOn;
  const pathDrawSec = selPath?.drawSec ?? p.pathParams.drawSec;
  const pathDelay = selPath?.drawDelay ?? p.pathParams.drawDelay;
  const pathEase = selPath?.drawEase ?? p.pathParams.drawEase;
  const pathReverse = selPath?.drawReverse ?? p.pathParams.drawReverse;
  const pathLoop = selPath?.drawLoop ?? p.pathParams.drawLoop;
  // set a path-animation field on the selected path, else the defaults for new paths
  const setPathAnim = (patch: Partial<{ drawOn: boolean; drawSec: number; drawDelay: number; drawEase: 'linear' | 'inout'; drawReverse: boolean; drawLoop: boolean }>) =>
    (selPath ? p.onUpdatePath(selPath.id, patch) : p.setPathParams({ ...p.pathParams, ...patch }));

  // Text: a selected text box is edited live; otherwise the controls set defaults for new text.
  const selText = p.selectedText;
  const t = selText ?? p.textParams;
  const tSet = (patch: Partial<TextParams>) => (selText ? p.onUpdateText(selText.id, patch) : p.setTextParams({ ...p.textParams, ...patch }));

  // Circle / Zone / Marker / Connector: a selected overlay is edited live, else the defaults.
  const selHalo = p.selectedOverlay?.type === 'ground-halo' ? p.selectedOverlay : null;
  const selMarker = p.selectedOverlay?.type === 'marker' ? p.selectedOverlay : null;
  const selZone = p.selectedOverlay?.type === 'coverage-zone' ? p.selectedOverlay : null;
  const selConn = p.selectedOverlay?.type === 'connector' ? p.selectedOverlay : null;
  const selSector = p.selectedOverlay?.type === 'sector' ? p.selectedOverlay : null;
  const cVal = { radiusMeters: selHalo?.radiusMeters ?? p.circleParams.radiusMeters, color: selHalo?.color ?? p.circleParams.color, opacity: selHalo?.opacity ?? p.circleParams.opacity, dashed: selHalo?.dashed ?? p.circleParams.dashed };
  const cSet = (patch: Partial<CircleParams>) => (selHalo ? p.onPatchOverlay(selHalo.id, patch) : p.setCircleParams({ ...p.circleParams, ...patch }));
  const zVal = {
    color: selZone?.color ?? p.zoneParams.color,
    opacity: selZone?.opacity ?? p.zoneParams.opacity,
    fillStyle: selZone?.fillStyle ?? p.zoneParams.fillStyle,
    dashed: selZone?.dashed ?? p.zoneParams.dashed,
    strokeWidth: selZone?.strokeWidth ?? p.zoneParams.strokeWidth,
  };
  const zSet = (patch: Partial<ZoneParams>) => (selZone ? p.onPatchOverlay(selZone.id, patch) : p.setZoneParams({ ...p.zoneParams, ...patch }));

  // Slow-mo: rate of a selected speed segment, or the default for new ones.
  const selSpeed = p.selectedSpeed;
  const speedRate = selSpeed ? selSpeed.rate : p.slowmoRate;
  const setSpeedRate = (r: number) => (selSpeed ? p.onUpdateSpeed(selSpeed.id, r) : p.setSlowmoRate(r));

  const list = p.players ? playersBySpan(p.players) : [];
  const calibrating = p.mode === 'player-calibrating';

  // which apply handler + on-state + enablement the player rows use, per selected player-effect
  const apply = {
    'follow-circle': { fn: p.onFollow, set: p.followedIds, enabled: p.hasCalibration, why: '먼저 캘리브레이션이 필요합니다', add: true },
    spotlight: { fn: p.onToggleSpotlight, set: p.spotlightIds, enabled: p.hasCalibration, why: '먼저 캘리브레이션이 필요합니다', add: false },
  }[p.selected as 'follow-circle' | 'spotlight'];

  return (
    <div className={`panel ${p.section === 'detail' ? 'panel-inspector' : ''}`}>
      {p.section !== 'detail' && (
      <>
      <div className="panel-title">Effect</div>
      {!p.hasCalibration && <div className="warn-note">바닥면 보정이 필요합니다 — 상단 <b>⚙ 설정 → 바닥면 재보정</b>.</div>}

      {/* ── tile catalog: Player / Tactic / Action ── */}
      {FEATURE_GROUPS.map((g) => (
        <div key={g} className="feature-group">
          <div className="field-label">{g}</div>
          <div className="feature-grid">
            {FEATURES.filter((f) => f.group === g).map((f) => {
              const locked = featLocked(f.id);
              return (
                <button
                  key={f.id}
                  className={`feature-tile ${p.selected === f.id ? 'active' : ''} ${f.implemented ? '' : 'soon'} ${locked ? 'locked' : ''}`}
                  onClick={() => { p.onSelect(f.id); if (!PLAYER_FEATURES.includes(f.id)) p.onCreate(f.id); }}
                  title={locked ? (f.id === 'pose' ? '자세 분석을 실행해야 사용할 수 있어요' : '선수 위치 분석을 실행해야 사용할 수 있어요') : f.hint}
                >
                  <span className="feature-icon">{f.icon}</span>
                  <span className="feature-name">{f.label}</span>
                  {!f.implemented && <span className="soon-tag">곧</span>}
                  {locked && <span className="lock-tag">🔒</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      </>
      )}

      {p.section !== 'tiles' && (
      <>
      {!p.section && <div className="panel-divider" />}
      <div className="panel-subtitle">{def.label}</div>
      <div className="panel-desc" style={{ marginTop: 0 }}>{def.hint}</div>

      {/* ── lower section ── player-effect → pick a player (+선수 지정); court effect → settings/Create */}
      {isPlayer ? (
        !readyForSelected ? (
          <div className="warn-note">
            <b>{def.label}</b>는 {isPose ? '자세 분석' : '선수 위치 분석'} 데이터가 필요합니다.{' '}
            타임라인에서 <b>원본 클립</b>을 선택해 <b>{isPose ? '자세' : '위치'} 분석</b>을 실행하세요.
          </div>
        ) : isPose ? (
          <>
            <div className="field-label">선수</div>
            <div className="muted-note">선수를 눌러 폼 추적을 추가합니다 — P1·P2를 각각 추가할 수 있어요.</div>
            <div className="player-list">
              {p.posePlayerIds.map((id) => {
                const paletteColor = p.colors[(Number(id) - 1) % p.colors.length];
                const has = p.posedIds.has(id);
                return (
                  <div key={id} className="player-row">
                    <span className="player-dot" style={{ background: paletteColor }} />
                    <span className="player-tag">P{id}</span>
                    {has && <span className="player-badge">추가됨</span>}
                    <span className="player-spacer" />
                    <button className="btn sm primary" onClick={() => p.onAddPose(id)} title="이 선수의 폼 추적 추가">폼 추가</button>
                  </div>
                );
              })}
              {p.posePlayerIds.length === 0 && <div className="muted-note">자세 분석에서 감지된 선수가 없습니다.</div>}
            </div>
            {selPose && (
              <>
                <div className="field-label" style={{ marginTop: 8 }}>폼 P{selPose.trackId} 편집</div>
                <div className="field"><label>골격</label>
                  <div className="btn-row">
                    <button className={`btn sm ${selPose.skeleton ? 'active' : ''}`} onClick={() => p.onPatchOverlay(selPose.id, { skeleton: true })}>표시</button>
                    <button className={`btn sm ${!selPose.skeleton ? 'active' : ''}`} onClick={() => p.onPatchOverlay(selPose.id, { skeleton: false })}>숨김</button>
                  </div></div>
                <div className="field"><label>팔·다리 기준</label>
                  <div className="btn-row">
                    <button className={`btn sm ${selPose.side === 'left' ? 'active' : ''}`} onClick={() => p.onPatchOverlay(selPose.id, { side: 'left' })}>왼쪽</button>
                    <button className={`btn sm ${selPose.side === 'right' ? 'active' : ''}`} onClick={() => p.onPatchOverlay(selPose.id, { side: 'right' })}>오른쪽</button>
                  </div></div>
                <div className="field-label" style={{ marginTop: 4 }}>표시할 각도</div>
                <div className="chip-row">
                  {POSE_ANGLES.map((a) => {
                    const on = selPose.angles.includes(a.id);
                    return (
                      <button key={a.id} className={`chip ${on ? 'on' : ''}`}
                        onClick={() => p.onPatchOverlay(selPose.id, { angles: on ? selPose.angles.filter((x) => x !== a.id) : [...selPose.angles, a.id] })}>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
                <div className="field"><label>색상</label>
                  <input type="color" value={selPose.color ?? '#E4EF3D'} onChange={(e) => p.onPatchOverlay(selPose.id, { color: e.target.value })} /></div>
                <div className="muted-note">선택하면 화면에서 골격이 강조됩니다. 타임라인에서 구간을 조절하세요.</div>
              </>
            )}
          </>
        ) : (
        <>
          {p.selected === 'follow-circle' && (
            <>
              <div className="field-label">공통 설정</div>
              <div className="field"><label>반지름 (m)</label>
                <input type="number" step="0.1" min="0.1" value={cVal.radiusMeters}
                  onChange={(e) => cSet({ radiusMeters: Number(e.target.value) || 0.1 })} /></div>
              <div className="field"><label>투명도 {cVal.opacity.toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.05" value={cVal.opacity}
                  onChange={(e) => cSet({ opacity: Number(e.target.value) })} /></div>
            </>
          )}

          <div className="field-label" style={{ marginTop: 4 }}>{p.selected === 'follow-circle' ? '선수별 설정' : '선수'}</div>
          <div className="muted-note">
            {apply.add ? '선수를 펼쳐 색·선을 정하고 추가하세요.' : '선수를 눌러 적용/해제합니다.'}
          </div>
          <div className="player-list">
            {list.map((pl) => {
              const on = !apply.add && apply.set.has(pl.id); // toggle effects (spotlight) show an on-state
              const paletteColor = p.colors[(Number(pl.id) - 1) % p.colors.length];

              // ── spotlight (and any non-circle player effect): simple apply/remove row ──
              if (p.selected !== 'follow-circle') {
                return (
                  <div key={pl.id} className={`player-row ${on ? 'on' : ''}`}>
                    <span className="player-dot" style={{ background: paletteColor }} />
                    <span className="player-tag">P{pl.id}</span>
                    <span className="player-spacer" />
                    <button className={on ? 'btn sm active' : 'btn sm'} onClick={() => apply.fn(pl.id)} disabled={!apply.enabled}
                      title={apply.enabled ? `${def.label} 적용/해제` : apply.why}>{on ? '해제' : '적용'}</button>
                  </div>
                );
              }

              // ── follow-circle: expandable per-player settings (색 / 원 스타일 / 추가하기) ──
              const style = p.playerStyleFor(pl.id);
              const open = expandedPlayer === pl.id;
              return (
                <div key={pl.id} className={`player-item ${open ? 'open' : ''}`}>
                  <button type="button" className="player-head" onClick={() => setExpandedPlayer(open ? null : pl.id)}>
                    <span className="player-swatch" style={{ background: style.color }} />
                    <span className="player-tag">P{pl.id}</span>
                    {style.dashed && <span className="player-badge">대시</span>}
                    <span className="player-spacer" />
                    <span className="player-caret">{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div className="player-body">
                      <div className="field"><label>색 설정</label>
                        <input type="color" value={style.color}
                          onChange={(e) => p.onSetPlayerStyle(pl.id, { color: e.target.value })} /></div>
                      <div className="field"><label>원 스타일</label>
                        <div className="btn-row">
                          <button className={`btn sm ${!style.dashed ? 'active' : ''}`} onClick={() => p.onSetPlayerStyle(pl.id, { dashed: false })}>실선</button>
                          <button className={`btn sm ${style.dashed ? 'active' : ''}`} onClick={() => p.onSetPlayerStyle(pl.id, { dashed: true })}>대시</button>
                        </div></div>
                      <button className="btn primary block" onClick={() => apply.fn(pl.id)} disabled={!apply.enabled}
                        title={apply.enabled ? `${def.label} 추가` : apply.why}>추가하기</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 선수 재지정 (user-anchored re-ID) — advanced, kept at the bottom */}
          {!calibrating ? (
            <button className="btn subtle sm" onClick={p.onStartPlayerCalib} disabled={!p.hasFragments} title="옷 색 기준으로 P1~P4를 다시 지정">선수 재지정</button>
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
        </>
        )
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
              <div className="field"><label>선</label>
                <div className="btn-row">
                  <button className={`btn sm ${!cVal.dashed ? 'active' : ''}`} onClick={() => cSet({ dashed: false })}>실선</button>
                  <button className={`btn sm ${cVal.dashed ? 'active' : ''}`} onClick={() => cSet({ dashed: true })}>대시</button>
                </div></div>
              <div className="field"><label>투명도 {cVal.opacity.toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.05" value={cVal.opacity}
                  onChange={(e) => cSet({ opacity: Number(e.target.value) })} /></div>
              <AnimationControls
                on={selHalo?.drawOn ?? p.circleParams.drawOn}
                sec={selHalo?.drawSec ?? p.circleParams.drawSec}
                delay={selHalo?.drawDelay ?? p.circleParams.drawDelay}
                ease={selHalo?.drawEase ?? p.circleParams.drawEase}
                reverse={selHalo?.drawReverse ?? p.circleParams.drawReverse}
                loop={selHalo?.drawLoop ?? p.circleParams.drawLoop}
                set={cSet}
              />
            </>
          )}
          {p.selected === 'zone' && (
            <>
              <div className="field"><label>색상</label>
                <input type="color" value={zVal.color} onChange={(e) => zSet({ color: e.target.value })} /></div>
              <div className="field"><label>채움</label>
                <div className="btn-row">
                  <button className={`btn sm ${zVal.fillStyle === 'solid' ? 'active' : ''}`} onClick={() => zSet({ fillStyle: 'solid' })}>단색</button>
                  <button className={`btn sm ${zVal.fillStyle === 'hatch' ? 'active' : ''}`} onClick={() => zSet({ fillStyle: 'hatch' })}>빗금</button>
                  <button className={`btn sm ${zVal.fillStyle === 'none' ? 'active' : ''}`} onClick={() => zSet({ fillStyle: 'none' })}>없음</button>
                </div></div>
              {zVal.fillStyle !== 'none' && (
                <div className="field"><label>투명도 {zVal.opacity.toFixed(2)}</label>
                  <input type="range" min="0" max="1" step="0.05" value={zVal.opacity}
                    onChange={(e) => zSet({ opacity: Number(e.target.value) })} /></div>
              )}
              <div className="field"><label>테두리</label>
                <div className="btn-row">
                  <button className={`btn sm ${!zVal.dashed ? 'active' : ''}`} onClick={() => zSet({ dashed: false })}>실선</button>
                  <button className={`btn sm ${zVal.dashed ? 'active' : ''}`} onClick={() => zSet({ dashed: true })}>대시</button>
                </div></div>
              <div className="field"><label>두께 {zVal.strokeWidth}px</label>
                <input type="range" min="1" max="10" step="1" value={zVal.strokeWidth}
                  onChange={(e) => zSet({ strokeWidth: Number(e.target.value) })} /></div>
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
          {p.selected === 'sector' && selSector && (
            <>
              <div className="field"><label>반지름 {selSector.radiusM.toFixed(1)}m</label>
                <input type="range" min="1" max="15" step="0.5" value={selSector.radiusM}
                  onChange={(e) => p.onPatchOverlay(selSector.id, { radiusM: Number(e.target.value) })} /></div>
              <div className="field"><label>방향 {Math.round(selSector.dir)}°</label>
                <input type="range" min="-180" max="180" step="1" value={selSector.dir}
                  onChange={(e) => p.onPatchOverlay(selSector.id, { dir: Number(e.target.value) })} /></div>
              <div className="field"><label>각도 {Math.round(selSector.spread)}°</label>
                <input type="range" min="10" max="180" step="1" value={selSector.spread}
                  onChange={(e) => p.onPatchOverlay(selSector.id, { spread: Number(e.target.value) })} /></div>
              <div className="field"><label>색상</label>
                <input type="color" value={selSector.color ?? '#7C5CFF'} onChange={(e) => p.onPatchOverlay(selSector.id, { color: e.target.value })} /></div>
              <div className="field"><label>투명도 {(selSector.opacity ?? 0.22).toFixed(2)}</label>
                <input type="range" min="0" max="1" step="0.05" value={selSector.opacity ?? 0.22}
                  onChange={(e) => p.onPatchOverlay(selSector.id, { opacity: Number(e.target.value) })} /></div>
              <div className="muted-note">화면에서 중심을 드래그해 이동, 끝점을 드래그해 반지름·방향 조절.</div>
              <AnimationControls
                on={!!selSector.drawOn}
                sec={selSector.drawSec ?? 1.2}
                delay={selSector.drawDelay ?? 0}
                ease={selSector.drawEase ?? 'linear'}
                reverse={!!selSector.drawReverse}
                loop={!!selSector.drawLoop}
                set={(patch) => p.onPatchOverlay(selSector.id, patch)}
              />
            </>
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
              {selText && <div className="muted-note">화면에서 박스를 드래그해 이동, 모서리 핸들로 크기 조절.</div>}
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
              <div className="muted-note">화면에서 양 끝점을 드래그해 이동.</div>
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
              <AnimationControls on={pathDrawOn} sec={pathDrawSec} delay={pathDelay} ease={pathEase} reverse={pathReverse} loop={pathLoop} set={setPathAnim} />
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
      </>
      )}
    </div>
  );
}
