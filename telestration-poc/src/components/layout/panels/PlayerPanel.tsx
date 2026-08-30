import { playersBySpan, posLabel } from '../../../geometry/tracking';
import type { Mode, Players } from '../../../types';

// 선수 위치 → Circle 바인딩. 선수 목록은 자동(외형 KMeans) 또는 유저 지정(선수 캘리브레이션).
export function PlayerPanel({
  hasCalibration,
  players,
  onFollow,
  followedIds,
  onToggleCutout,
  cutoutIds,
  hasCutouts,
  onToggleSpotlight,
  spotlightIds,
  colors,
  mode,
  hasFragments,
  anchorCount,
  onStartPlayerCalib,
  onFinishPlayerCalib,
  onCancelPlayerCalib,
}: {
  hasCalibration: boolean;
  players: Players | null;
  onFollow: (id: string) => void;
  followedIds: Set<string>;
  onToggleCutout: (id: string) => void;
  cutoutIds: Set<string>;
  hasCutouts: boolean;
  onToggleSpotlight: (id: string) => void;
  spotlightIds: Set<string>;
  colors: string[];
  mode: Mode;
  hasFragments: boolean;
  anchorCount: number;
  onStartPlayerCalib: () => void;
  onFinishPlayerCalib: () => void;
  onCancelPlayerCalib: () => void;
}) {
  const list = players ? playersBySpan(players) : [];
  const calibrating = mode === 'player-calibrating';

  return (
    <div className="panel">
      <div className="panel-title">Player · 선수 위치</div>
      <p className="panel-desc">
        YOLO+ByteTrack → 외형 re-ID로 <b>선수별 발 궤적</b>. 자동 4명이 기본이고, <b>선수 지정</b>으로 직접 정할 수 있습니다.
      </p>

      {!hasCalibration && <div className="warn-note">먼저 <b>Court</b> 탭에서 캘리브레이션하세요. (발점 → H⁻¹ → 코트 좌표)</div>}

      {/* 선수 캘리브레이션 (유저 지정 re-ID) */}
      <div className="field-label">선수 지정 (유저 캘리브레이션)</div>
      {!calibrating ? (
        <button className="btn" onClick={onStartPlayerCalib} disabled={!hasFragments}>선수 지정 시작</button>
      ) : (
        <div className="calib-hint">
          영상에서 각 선수를 순서대로 클릭 — 다음 <b className="accent">P{anchorCount + 1}</b> ({anchorCount}/4 지정됨).
          <div className="btn-row">
            <button className="btn primary" onClick={onFinishPlayerCalib} disabled={anchorCount < 2}>완료 ({anchorCount})</button>
            <button className="btn" onClick={onCancelPlayerCalib}>취소</button>
          </div>
          <div className="muted-note">클릭한 선수의 옷 색을 기준으로 나머지 조각을 자동 배정합니다.</div>
        </div>
      )}

      <div className="panel-divider" />

      {!players && <div className="soon-note">트래킹 데이터(players.json)를 불러오지 못했습니다.</div>}
      {players && (
        <>
          <div className="status-pill ok">선수 {list.length}명 · 원 / 컷 / 스팟 토글</div>
          <div className="player-list">
            {list.map((p) => {
              const on = followedIds.has(p.id);
              const cutOn = cutoutIds.has(p.id);
              const spotOn = spotlightIds.has(p.id);
              const color = colors[(Number(p.id) - 1) % colors.length];
              return (
                <div key={p.id} className={`player-row ${on || cutOn || spotOn ? 'on' : ''}`}>
                  <span className="player-dot" style={{ background: color }} />
                  <span className="player-tag">P{p.id}</span>
                  <span className="player-span">{posLabel(p.medY)} <span className="muted">· {p.t0.toFixed(0)}–{p.t1.toFixed(0)}s</span></span>
                  <button className={on ? 'btn sm active' : 'btn sm'} onClick={() => onFollow(p.id)} disabled={!hasCalibration} title="바닥 원(Circle)">원</button>
                  <button className={cutOn ? 'btn sm active' : 'btn sm'} onClick={() => onToggleCutout(p.id)} disabled={!hasCutouts} title="사람 컷아웃">컷</button>
                  <button className={spotOn ? 'btn sm active' : 'btn sm'} onClick={() => onToggleSpotlight(p.id)} disabled={!hasCalibration} title="스팟라이트(배경 어둡게)">스팟</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
