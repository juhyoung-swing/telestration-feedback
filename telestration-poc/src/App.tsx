import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoStage } from './components/VideoStage';
import { Rail } from './components/layout/Rail';
import { MediaPanel } from './components/layout/panels/MediaPanel';
import { CourtPanel } from './components/layout/panels/CourtPanel';
import { PlayerPanel } from './components/layout/panels/PlayerPanel';
import { HighlightPanel } from './components/layout/panels/HighlightPanel';
import { NarrativePanel } from './components/layout/panels/NarrativePanel';
import { EditingToolbar } from './components/EditingToolbar';
import { Timeline } from './components/Timeline';
import { ExportDropdown } from './components/ExportDropdown';
import { getPerspectiveTransform, invert3x3, projectCourtPoint, unprojectToCourt } from './geometry/homography';
import type { Pt } from './geometry/homography';
import { COURT_CORNERS } from './geometry/court';
import { courtLineDef, fitImageLine, homographyFromLines, familiesCovered } from './geometry/lineCalib';
import { PLAYER_COLORS, playerColor, hitTestFragment, assignFragments } from './geometry/tracking';
import type {
  CircleParams, CourtCalibration, DrawnLine, FeatureId, FragmentData, Fragments, Mode, Overlay,
  PlayerAnchor, Players, RailTab, TrackingData, ZoneParams,
} from './types';

let idCounter = 0;
const uid = (p: string) => `${p}-${++idCounter}`;

const DEFAULT_SRC = '/court.mp4';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  const [src, setSrc] = useState(DEFAULT_SRC);
  const [videoName, setVideoName] = useState('court.mp4');
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const [calibration, setCalibration] = useState<CourtCalibration | null>(null);
  const [calibMethod, setCalibMethod] = useState<'corner' | 'line' | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [mode, setMode] = useState<Mode>('idle');
  const [showGrid, setShowGrid] = useState(false);

  // calibration drafts
  const [draftCalib, setDraftCalib] = useState<Pt[]>([]);
  const [draftZone, setDraftZone] = useState<{ courtX: number; courtY: number }[]>([]);
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const [lineDraft, setLineDraft] = useState<Pt[]>([]);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  // UI shell state
  const [activeTab, setActiveTab] = useState<RailTab>('court');
  const [selectedFeature, setSelectedFeature] = useState<FeatureId>('circle');
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [circleParams, setCircleParams] = useState<CircleParams>({ radiusMeters: 0.8, color: '#E4EF3D', opacity: 0.2 });
  const [zoneParams, setZoneParams] = useState<ZoneParams>({ color: '#17335F', opacity: 0.18 });

  // playback
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  // tracking (players.json auto-4, and fragments.json for user-anchored re-ID)
  const [players, setPlayers] = useState<Players | null>(null);
  const [fragments, setFragments] = useState<Fragments | null>(null);
  const [trackFps, setTrackFps] = useState(30);
  const [playerAnchors, setPlayerAnchors] = useState<PlayerAnchor[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/players.json').then((r) => (r.ok ? r.json() : null))
      .then((d: TrackingData | null) => { if (alive && d?.players) { setPlayers(d.players); setTrackFps(d.fps || 30); } })
      .catch(() => {});
    fetch('/fragments.json').then((r) => (r.ok ? r.json() : null))
      .then((d: FragmentData | null) => { if (alive && d?.tracks) setFragments(d.tracks); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCur(v.currentTime);
    const onMeta = () => setDur(v.duration || 0);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, [src]);

  // Smooth playhead + overlay time-gating while playing (timeupdate is only ~4 Hz).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      if (v) setCur(v.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setCur(t);
  };
  const changeRange = (id: string, startTime: number, endTime: number) =>
    setOverlays((o) => o.map((x) => (x.id === id ? { ...x, startTime, endTime } : x)));

  // ── calibration (corners) ──────────────────────────────────────────────
  const startCalibration = () => {
    videoRef.current?.pause();
    setDraftCalib([]);
    setDraftZone([]);
    setMode('calibrating');
  };
  const resetCalibration = () => {
    setCalibration(null);
    setCalibMethod(null);
    setDraftCalib([]);
    setDrawnLines([]);
    setLineDraft([]);
    setActiveLineId(null);
    setMode('idle');
  };

  // ── calibration (lines) ────────────────────────────────────────────────
  const startLineCalibration = () => {
    videoRef.current?.pause();
    setDrawnLines([]);
    setLineDraft([]);
    setActiveLineId(null);
    setMode('line-calibrating');
  };
  const selectLine = (id: string) => {
    setDrawnLines((prev) => {
      let next = prev;
      if (activeLineId && lineDraft.length >= 2) {
        next = [...prev.filter((l) => l.id !== activeLineId), { id: activeLineId, points: lineDraft }];
      }
      return next.filter((l) => l.id !== id);
    });
    setActiveLineId(id);
    setLineDraft([]);
  };
  const finishLineCalibration = () => {
    if (!dims) return;
    const all: DrawnLine[] = [...drawnLines.filter((l) => l.id !== activeLineId)];
    if (activeLineId && lineDraft.length >= 2) all.push({ id: activeLineId, points: lineDraft });
    if (all.length < 4 || !familiesCovered(all.map((l) => l.id)).ok) return;
    const corr = all.map((l) => ({ court: courtLineDef(l.id).vec, image: fitImageLine(l.points) }));
    const H = homographyFromLines(corr, dims.w, dims.h);
    setCalibration({ imagePoints: COURT_CORNERS.map((c) => projectCourtPoint(H, c.x, c.y)), homography: H, inverseHomography: invert3x3(H) });
    setCalibMethod('line');
    setDrawnLines([]);
    setLineDraft([]);
    setActiveLineId(null);
    setMode('idle');
  };
  const cancelLineCalibration = () => {
    setDrawnLines([]);
    setLineDraft([]);
    setActiveLineId(null);
    setMode('idle');
  };

  // compute H once the 4th corner lands (pure updaters elsewhere)
  useEffect(() => {
    if (mode !== 'calibrating' || draftCalib.length !== 4) return;
    const H = getPerspectiveTransform(COURT_CORNERS, draftCalib);
    setCalibration({ imagePoints: draftCalib, homography: H, inverseHomography: invert3x3(H) });
    setCalibMethod('corner');
    setMode('idle');
  }, [mode, draftCalib]);

  // ── overlay tools ──────────────────────────────────────────────────────
  const createCircle = () => {
    if (!calibration) return;
    setMode((m) => (m === 'placing-halo' ? 'idle' : 'placing-halo'));
    setDraftZone([]);
  };
  const createZone = () => {
    if (!calibration) return;
    setMode((m) => (m === 'drawing-zone' ? 'idle' : 'drawing-zone'));
    setDraftZone([]);
  };
  const finishZone = () => {
    if (draftZone.length >= 3) {
      const pts = draftZone;
      const end = dur > 0 ? dur : 9999;
      setOverlays((o) => {
        const name = `Zone ${o.filter((x) => x.type === 'coverage-zone').length + 1}`;
        return [...o, { id: uid('zone'), type: 'coverage-zone', name, visible: true, startTime: 0, endTime: end, points: pts, color: zoneParams.color, opacity: zoneParams.opacity }];
      });
    }
    setDraftZone([]);
    setMode('idle');
  };
  const cancelZone = () => {
    setDraftZone([]);
    setMode('idle');
  };

  // Toggle a Circle bound to a tracked player. Its court position is derived
  // per-frame (foot → H⁻¹ → court); span = the player's tracked span; each player
  // gets a distinct color.
  const followPlayer = (playerId: string) => {
    if (!calibration || !players) return;
    const existing = overlays.find((o) => o.type === 'ground-halo' && o.trackId === playerId);
    if (existing) { removeOverlay(existing.id); return; }
    const pts = players[playerId];
    if (!pts || pts.length === 0) return;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const color = playerColor(playerId) ?? circleParams.color;
    setOverlays((o) => [...o, {
      id: uid('halo'), type: 'ground-halo', name: `Player ${playerId}`, visible: true,
      startTime: t0, endTime: t1, courtX: 0, courtY: 0,
      radiusMeters: circleParams.radiusMeters, color, opacity: circleParams.opacity,
      trackId: playerId,
    }]);
    if (cur < t0 || cur > t1) seek(t0); // jump into range so it's immediately visible
  };
  const followedIds = new Set(
    overlays.filter((o) => o.type === 'ground-halo' && o.trackId).map((o) => (o as { trackId?: string }).trackId!),
  );

  // ── player calibration (user-anchored re-ID) ────────────────────────────
  const startPlayerCalibration = () => {
    videoRef.current?.pause();
    setPlayerAnchors([]);
    setMode('player-calibrating');
  };
  const finishPlayerCalibration = () => {
    if (!fragments || playerAnchors.length < 2) return;
    setPlayers(assignFragments(fragments, playerAnchors)); // user-defined players override auto
    setOverlays((o) => o.filter((x) => !(x.type === 'ground-halo' && x.trackId))); // drop stale tracked halos
    setPlayerAnchors([]);
    setMode('idle');
  };
  const cancelPlayerCalibration = () => { setPlayerAnchors([]); setMode('idle'); };

  // ── the single click handler, dispatched by mode ───────────────────────
  const onStageClick = (videoPt: Pt) => {
    if (mode === 'calibrating') {
      setDraftCalib((prev) => (prev.length >= 4 ? prev : [...prev, videoPt]));
      return;
    }
    if (mode === 'line-calibrating') {
      if (!activeLineId) return;
      setLineDraft((prev) => [...prev, videoPt]);
      return;
    }
    if (mode === 'player-calibrating') {
      if (!fragments) return;
      const fid = hitTestFragment(fragments, videoPt.x, videoPt.y, Math.round(cur * trackFps));
      if (!fid) return;
      setPlayerAnchors((prev) => {
        if (prev.some((a) => a.fragId === fid) || prev.length >= 4) return prev;
        return [...prev, { label: String(prev.length + 1), desc: fragments[fid].desc, fragId: fid }];
      });
      return;
    }
    if (!calibration) return;
    const court = unprojectToCourt(calibration.inverseHomography, videoPt.x, videoPt.y);
    if (mode === 'placing-halo') {
      const end = dur > 0 ? dur : 9999;
      setOverlays((o) => {
        const name = `Circle ${o.filter((x) => x.type === 'ground-halo').length + 1}`;
        return [...o, { id: uid('halo'), type: 'ground-halo', name, visible: true, startTime: 0, endTime: end, courtX: court.x, courtY: court.y, radiusMeters: circleParams.radiusMeters, color: circleParams.color, opacity: circleParams.opacity }];
      });
    } else if (mode === 'drawing-zone') {
      setDraftZone((z) => [...z, { courtX: court.x, courtY: court.y }]);
    }
  };

  // ── layer stack ────────────────────────────────────────────────────────
  const removeOverlay = (id: string) => {
    setOverlays((o) => o.filter((x) => x.id !== id));
    setSelectedOverlayId((s) => (s === id ? null : s));
  };
  const toggleVisible = (id: string) => setOverlays((o) => o.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)));
  const duplicateOverlay = (id: string) => {
    setOverlays((o) => {
      const src = o.find((x) => x.id === id);
      if (!src) return o;
      if (src.type === 'ground-halo') {
        return [...o, { ...src, id: uid('halo'), name: `${src.name} copy`, courtX: src.courtX + 0.6, courtY: src.courtY + 0.6 }];
      }
      return [...o, { ...src, id: uid('zone'), name: `${src.name} copy`, points: src.points.map((p) => ({ courtX: p.courtX + 0.6, courtY: p.courtY + 0.6 })) }];
    });
  };
  const undo = () => setOverlays((o) => o.slice(0, -1));
  const deleteSelected = () => selectedOverlayId && removeOverlay(selectedOverlayId);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  // ── media ──────────────────────────────────────────────────────────────
  const loadFile = useCallback((file: File) => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    setSrc(url);
    setVideoName(file.name);
    setCalibration(null);
    setCalibMethod(null);
    setOverlays([]);
    setDraftCalib([]);
    setDraftZone([]);
    setDrawnLines([]);
    setLineDraft([]);
    setActiveLineId(null);
    setSelectedOverlayId(null);
    setMode('idle');
    setDims(null);
    setPlayers(null); // players.json only matches the default court.mp4
    setFragments(null);
    setPlayerAnchors([]);
  }, []);

  // Esc leaves interactive mode; Enter finishes a zone/line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        setMode('idle');
        setDraftZone([]);
        setDraftCalib([]);
        setLineDraft([]);
        setDrawnLines([]);
        setActiveLineId(null);
        setPlayerAnchors([]);
      } else if (e.key === 'Enter' && mode === 'drawing-zone') finishZone();
      else if (e.key === 'Enter' && mode === 'line-calibrating') finishLineCalibration();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dims, drawnLines, lineDraft, activeLineId]);

  // line-calibration coverage for the panel
  const currentLineIds = Array.from(new Set([
    ...drawnLines.map((l) => l.id),
    ...(activeLineId && lineDraft.length >= 2 ? [activeLineId] : []),
  ]));
  const lineCoverage = familiesCovered(currentLineIds);
  const canFinishLines = currentLineIds.length >= 4 && lineCoverage.ok;

  return (
    <div className="editor">
      <Rail active={activeTab} onSelect={setActiveTab} />

      <section className="left-panel">
        {activeTab === 'media' && <MediaPanel videoName={videoName} dims={dims} onLoadFile={loadFile} />}
        {activeTab === 'court' && (
          <CourtPanel
            mode={mode}
            hasCalibration={!!calibration}
            method={calibMethod}
            showGrid={showGrid}
            draftCalibCount={draftCalib.length}
            activeLineId={activeLineId}
            lineDraftCount={lineDraft.length}
            currentLineIds={currentLineIds}
            lineCoverage={lineCoverage}
            canFinishLines={canFinishLines}
            onStartCorner={startCalibration}
            onStartLine={startLineCalibration}
            onReset={resetCalibration}
            onToggleGrid={() => setShowGrid((s) => !s)}
            onSelectLine={selectLine}
            onFinishLine={finishLineCalibration}
            onCancelLine={cancelLineCalibration}
          />
        )}
        {activeTab === 'player' && (
          <PlayerPanel
            hasCalibration={!!calibration}
            players={players}
            onFollow={followPlayer}
            followedIds={followedIds}
            colors={PLAYER_COLORS}
            mode={mode}
            hasFragments={!!fragments}
            anchorCount={playerAnchors.length}
            onStartPlayerCalib={startPlayerCalibration}
            onFinishPlayerCalib={finishPlayerCalibration}
            onCancelPlayerCalib={cancelPlayerCalibration}
          />
        )}
        {activeTab === 'highlight' && (
          <HighlightPanel
            hasCalibration={!!calibration}
            selected={selectedFeature}
            onSelect={setSelectedFeature}
            mode={mode}
            draftZoneCount={draftZone.length}
            circleParams={circleParams}
            setCircleParams={setCircleParams}
            zoneParams={zoneParams}
            setZoneParams={setZoneParams}
            onCreateCircle={createCircle}
            onCancelCircle={() => setMode('idle')}
            onCreateZone={createZone}
            onFinishZone={finishZone}
            onCancelZone={cancelZone}
          />
        )}
        {activeTab === 'narrative' && <NarrativePanel />}
      </section>

      <main className="center">
        <div className="center-head">
          <div className="center-head-l">
            <span className="center-title">🎾 {videoName}</span>
            <span className="center-sub">{calibration ? `캘리브레이션 ✓ (${calibMethod === 'line' ? '선' : '모서리'})` : '미보정'} · 오버레이 {overlays.length}</span>
          </div>
          <ExportDropdown videoName={videoName} />
        </div>

        <VideoStage
          src={src}
          videoRef={videoRef}
          calibration={calibration}
          overlays={overlays}
          mode={mode}
          showGrid={showGrid}
          currentTime={cur}
          players={players}
          fragments={fragments}
          playerAnchors={playerAnchors}
          fps={trackFps}
          draftCalib={draftCalib}
          draftZone={draftZone}
          drawnLines={drawnLines}
          lineDraft={lineDraft}
          activeLineId={activeLineId}
          onStageClick={onStageClick}
          onDimensions={(w, h) => setDims({ w, h })}
        />

        <EditingToolbar
          playing={playing}
          onPlayPause={togglePlay}
          onUndo={undo}
          canUndo={overlays.length > 0}
          onDelete={deleteSelected}
          canDelete={!!selectedOverlayId}
          cur={cur}
          dur={dur}
        />

        <Timeline
          overlays={overlays}
          duration={dur}
          currentTime={cur}
          selectedId={selectedOverlayId}
          videoName={videoName}
          onSelect={setSelectedOverlayId}
          onSeek={seek}
          onToggleVisible={toggleVisible}
          onRemove={removeOverlay}
          onDuplicate={duplicateOverlay}
          onChangeRange={changeRange}
        />
      </main>
    </div>
  );
}
