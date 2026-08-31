import { FEATURES, FEATURE_GROUPS } from '../features';
import { playersBySpan, posLabel } from '../../../geometry/tracking';
import type { CircleParams, FeatureId, Mode, Players, ZoneParams, ZoomParams } from '../../../types';

const FEATURE_MODE: Record<string, Mode> = {
  circle: 'placing-halo', marker: 'placing-marker', text: 'placing-text',
  zone: 'drawing-zone', path: 'drawing-path', connector: 'drawing-connector',
  'zoom-in': 'placing-zoom',
};

type Props = {
  hasCalibration: boolean;
  // ── Player section (tracking-based per-player effects) ──
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
  // ── Effect catalog (Tactic / Action tiles) ──
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
  const isMulti = p.selected === 'zone' || p.selected === 'path';
  const isConnector = p.selected === 'connector';
  const isPoint = p.selected === 'circle' || p.selected === 'marker' || p.selected === 'text' || p.selected === 'zoom-in';

  const list = p.players ? playersBySpan(p.players) : [];
  const calibrating = p.mode === 'player-calibrating';

  return (
    <div className="panel">
      <div className="panel-title">Effect · 효과</div>
      {!p.hasCalibration && <div className="warn-note">먼저 <b>Court</b> 탭에서 캘리브레이션하세요.</div>}

      {/* ── Player · 선수 ── (per-player Circle / Cutout / Spotlight) */}
      <div className="field-label">Player · 선수</div>
      <p className="panel-desc" style={{ marginTop: 0 }}>
        선수별 <b>원(Circle)</b> · <b>컷(Cutout)</b> · <b>스팟(Spotlight)</b>. 외형 re-ID로 자동 4명, <b>선수 지정</b>으로 직접 정할 수 있습니다.
      </p>

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

      {!p.players && <div className="soon-note" style={{ marginTop: 8 }}>트래킹 데이터(players.json)를 불러오지 못했습니다.</div>}
      {p.players && (
        <div className="player-list">
          {list.map((pl) => {
            const on = p.followedIds.has(pl.id);
            const cutOn = p.cutoutIds.has(pl.id);
            const spotOn = p.spotlightIds.has(pl.id);
            const color = p.colors[(Number(pl.id) - 1) % p.colors.length];
            return (
              <div key={pl.id} className={`player-row ${on || cutOn || spotOn ? 'on' : ''}`}>
                <span className="player-dot" style={{ background: color }} />
                <span className="player-tag">P{pl.id}</span>
                <span className="player-span">{posLabel(pl.medY)} <span className="muted">· {pl.t0.toFixed(0)}–{pl.t1.toFixed(0)}s</span></span>
                <button className={on ? 'btn sm active' : 'btn sm'} onClick={() => p.onFollow(pl.id)} disabled={!p.hasCalibration} title="바닥 원(Circle) — 선수를 따라감">원</button>
                <button className={cutOn ? 'btn sm active' : 'btn sm'} onClick={() => p.onToggleCutout(pl.id)} disabled={!p.hasCutouts} title="사람 컷아웃(실루엣)">컷</button>
                <button className={spotOn ? 'btn sm active' : 'btn sm'} onClick={() => p.onToggleSpotlight(pl.id)} disabled={!p.hasCalibration} title="스팟라이트(배경 어둡게 + 선수 강조)">스팟</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="panel-divider" />

      {/* ── Effect catalog (Tactic / Action) ── */}
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
      {p.selected === 'text' && (
        <div className="field"><label>라벨 내용</label>
          <input type="text" value={p.textDraft} placeholder="텍스트" maxLength={40}
            onChange={(e) => p.setTextDraft(e.target.value)} /></div>
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
