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
  CircleParams, CourtCalibration, CutoutData, DrawnLine, FeatureId, FragmentData, Fragments, Mode, Overlay,
  PlayerAnchor, PlayerCutouts, Players, RailTab, TrackingData, ZoneParams, ZoomParams,
} from './types';

let idCounter = 0;
const uid = (p: string) => `${p}-${++idCounter}`;

const DEFAULT_SRC = '/court.mp4';
const DEFAULT_LEN = 5; // new static effects span this many seconds from the playhead
const FOLLOW_LEN = 8;  // new player-follow effects span this many seconds from the playhead
const clampT = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const FEATURE_COLORS: Record<string, string> = { marker: '#FF3B3B', text: '#FFFFFF', path: '#FF3B3B', connector: '#00E5FF' };
const FEATURE_MODE = {
  circle: 'placing-halo', marker: 'placing-marker', text: 'placing-text',
  zone: 'drawing-zone', path: 'drawing-path', connector: 'drawing-connector',
  'zoom-in': 'placing-zoom',
} as const;

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
  const [zoomParams, setZoomParams] = useState<ZoomParams>({ scale: 2.2 });
  const [textDraft, setTextDraft] = useState('텍스트'); // Text feature: content typed in the panel

  // playback
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [tlZoom, setTlZoom] = useState(1); // timeline horizontal zoom (1 = fit whole clip)
  const [snap, setSnap] = useState(true);  // snap dragged bars to playhead / edges

  // tracking (players.json auto-4, and fragments.json for user-anchored re-ID)
  const [players, setPlayers] = useState<Players | null>(null);
  const [fragments, setFragments] = useState<Fragments | null>(null);
  const [cutouts, setCutouts] = useState<PlayerCutouts | null>(null);
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
    fetch('/cutouts.json').then((r) => (r.ok ? r.json() : null))
      .then((d: CutoutData | null) => { if (alive && d?.players) setCutouts(d.players); })
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

  // New effects land at the playhead with a default duration (video-editor convention),
  // instead of spanning the whole clip and piling up on top of each other.
  const spanAtPlayhead = (len = DEFAULT_LEN) => {
    const total = dur > 0 ? dur : cur + len;
    const L = Math.min(len, total);
    const s = clampT(cur, 0, total - L);
    return { startTime: s, endTime: s + L };
  };
  // Player-follow effects land at the playhead too, but clamped to the player's tracked span.
  const followSpan = (t0: number, t1: number, len = FOLLOW_LEN) => {
    const L = Math.min(len, Math.max(0.001, t1 - t0));
    const s = clampT(cur, t0, Math.max(t0, t1 - L));
    return { startTime: s, endTime: s + L };
  };

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
  // Enter/exit a feature's placement or drawing mode.
  const startFeature = (id: FeatureId) => {
    if (!calibration) return;
    const target = FEATURE_MODE[id as keyof typeof FEATURE_MODE];
    if (!target) return;
    setMode((m) => (m === target ? 'idle' : target));
    setDraftZone([]);
  };
  const nextName = (o: Overlay[], t: Overlay['type'], label: string) => `${label} ${o.filter((x) => x.type === t).length + 1}`;
  // Finish a multi-point drawing (Zone ≥3 closed / Path ≥2 arrow).
  const finishDraft = () => {
    const pts = draftZone;
    if (mode === 'drawing-zone' && pts.length >= 3) {
      setOverlays((o) => [...o, { id: uid('zone'), type: 'coverage-zone', name: nextName(o, 'coverage-zone', 'Zone'), visible: true, ...spanAtPlayhead(), points: pts, color: zoneParams.color, opacity: zoneParams.opacity }]);
    } else if (mode === 'drawing-path' && pts.length >= 2) {
      setOverlays((o) => [...o, { id: uid('path'), type: 'path', name: nextName(o, 'path', 'Path'), visible: true, ...spanAtPlayhead(), points: pts, color: FEATURE_COLORS.path }]);
    }
    setDraftZone([]);
    setMode('idle');
  };
  const cancelDraft = () => { setDraftZone([]); setMode('idle'); };

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
    const span = followSpan(t0, t1);
    const color = playerColor(playerId) ?? circleParams.color;
    setOverlays((o) => [...o, {
      id: uid('halo'), type: 'ground-halo', name: `Player ${playerId}`, visible: true,
      ...span, courtX: 0, courtY: 0,
      radiusMeters: circleParams.radiusMeters, color, opacity: circleParams.opacity,
      trackId: playerId,
    }]);
    if (cur < span.startTime || cur > span.endTime) seek(span.startTime); // jump into range so it's immediately visible
  };
  const followedIds = new Set(
    overlays.filter((o) => o.type === 'ground-halo' && o.trackId).map((o) => (o as { trackId?: string }).trackId!),
  );

  // Toggle a person cutout (silhouette outline) bound to a tracked player.
  const toggleCutout = (playerId: string) => {
    if (!players) return;
    const existing = overlays.find((o) => o.type === 'cutout' && o.trackId === playerId);
    if (existing) { removeOverlay(existing.id); return; }
    const pts = players[playerId];
    if (!pts || pts.length === 0) return;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const span = followSpan(t0, t1);
    setOverlays((o) => [...o, {
      id: uid('cut'), type: 'cutout', name: `Cutout ${playerId}`, visible: true,
      ...span, trackId: playerId, color: playerColor(playerId),
    }]);
    if (cur < span.startTime || cur > span.endTime) seek(span.startTime);
  };
  const cutoutIds = new Set(
    overlays.filter((o) => o.type === 'cutout').map((o) => (o as { trackId: string }).trackId),
  );

  // Toggle a spotlight (dim frame + light up player) bound to a tracked player.
  const toggleSpotlight = (playerId: string) => {
    if (!players) return;
    const existing = overlays.find((o) => o.type === 'spotlight' && o.trackId === playerId);
    if (existing) { removeOverlay(existing.id); return; }
    const pts = players[playerId];
    if (!pts || pts.length === 0) return;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const span = followSpan(t0, t1);
    setOverlays((o) => [...o, { id: uid('spot'), type: 'spotlight', name: `Spotlight ${playerId}`, visible: true, ...span, trackId: playerId }]);
    if (cur < span.startTime || cur > span.endTime) seek(span.startTime);
  };
  const spotlightIds = new Set(
    overlays.filter((o) => o.type === 'spotlight').map((o) => (o as { trackId: string }).trackId),
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
    const cxy = { courtX: court.x, courtY: court.y };
    if (mode === 'placing-halo') {
      setOverlays((o) => [...o, { id: uid('halo'), type: 'ground-halo', name: nextName(o, 'ground-halo', 'Circle'), visible: true, ...spanAtPlayhead(), courtX: court.x, courtY: court.y, radiusMeters: circleParams.radiusMeters, color: circleParams.color, opacity: circleParams.opacity }]);
    } else if (mode === 'placing-marker') {
      setOverlays((o) => [...o, { id: uid('marker'), type: 'marker', name: nextName(o, 'marker', 'Marker'), visible: true, ...spanAtPlayhead(), ...cxy, color: FEATURE_COLORS.marker }]);
    } else if (mode === 'placing-text') {
      const text = textDraft.trim() || '텍스트';
      setOverlays((o) => [...o, { id: uid('text'), type: 'text', name: nextName(o, 'text', 'Text'), visible: true, ...spanAtPlayhead(), ...cxy, text, color: FEATURE_COLORS.text }]);
    } else if (mode === 'placing-zoom') {
      setOverlays((o) => [...o, { id: uid('zoom'), type: 'zoom-in', name: nextName(o, 'zoom-in', 'Zoom'), visible: true, ...spanAtPlayhead(), ...cxy, scale: zoomParams.scale }]);
    } else if (mode === 'drawing-zone' || mode === 'drawing-path') {
      setDraftZone((z) => [...z, cxy]);
    } else if (mode === 'drawing-connector') {
      if (draftZone.length >= 1) {
        const p0 = draftZone[0];
        setOverlays((o) => [...o, { id: uid('conn'), type: 'connector', name: nextName(o, 'connector', 'Connector'), visible: true, ...spanAtPlayhead(), points: [p0, cxy], color: FEATURE_COLORS.connector }]);
        setDraftZone([]);
        setMode('idle');
      } else {
        setDraftZone([cxy]);
      }
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
      const name = `${src.name} copy`, newId = uid('dup');
      if (src.type === 'ground-halo' || src.type === 'marker' || src.type === 'text' || src.type === 'zoom-in') {
        return [...o, { ...src, id: newId, name, courtX: src.courtX + 0.6, courtY: src.courtY + 0.6 }];
      }
      if (src.type === 'cutout' || src.type === 'spotlight') return [...o, { ...src, id: newId, name }];
      return [...o, { ...src, id: newId, name, points: src.points.map((p) => ({ courtX: p.courtX + 0.6, courtY: p.courtY + 0.6 })) }];
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
      } else if (e.key === 'Enter' && (mode === 'drawing-zone' || mode === 'drawing-path')) finishDraft();
      else if (e.key === 'Enter' && mode === 'line-calibrating') finishLineCalibration();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dims, drawnLines, lineDraft, activeLineId]);

  // Playback & timeline shortcuts (video-editor conventions): Space = play/pause,
  // ←/→ = step a frame (Shift = 1s), +/− = zoom timeline, S = toggle snapping.
  useEffect(() => {
    const FRAME = 1 / 30;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      const v = videoRef.current;
      if (e.code === 'Space') {
        if (el instanceof HTMLButtonElement) return; // let a focused button handle its own space
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (v) seek(Math.max(0, v.currentTime - (e.shiftKey ? 1 : FRAME)));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (v) seek(Math.min(v.duration || dur || 0, v.currentTime + (e.shiftKey ? 1 : FRAME)));
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setTlZoom((z) => Math.min(16, +(z * 1.5).toFixed(3)));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setTlZoom((z) => Math.max(1, +(z / 1.5).toFixed(3)));
      } else if (e.key === 's' || e.key === 'S') {
        setSnap((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dur]);

  // line-calibration coverage for the panel
  const currentLineIds = Array.from(new Set([
    ...drawnLines.map((l) => l.id),
    ...(activeLineId && lineDraft.length >= 2 ? [activeLineId] : []),
  ]));
  const lineCoverage = familiesCovered(currentLineIds);
  const canFinishLines = currentLineIds.length >= 4 && lineCoverage.ok;

  // On-canvas guidance for whatever placement/drawing mode is active.
  const stageHint: string | null = (() => {
    const n = draftZone.length;
    switch (mode) {
      case 'calibrating': return `코트 네 모서리를 클릭하세요 · ${draftCalib.length}/4 · Esc 취소`;
      case 'line-calibrating': return '코트 선을 클릭해 그리세요 · Enter 완료 · Esc 취소';
      case 'player-calibrating': return `각 선수를 클릭해 지정 · ${playerAnchors.length}/4 · 완료는 왼쪽 패널 · Esc 취소`;
      case 'placing-halo': return '코트를 클릭 → Circle 배치 · Esc 종료';
      case 'placing-marker': return '코트를 클릭 → Marker 배치 · Esc 종료';
      case 'placing-text': return '코트를 클릭 → Text 배치 · Esc 종료';
      case 'placing-zoom': return '코트를 클릭 → 확대 중심 지정 · Esc 종료';
      case 'drawing-zone': return `Zone 영역 · ${n}점 (3점 이상) · Enter 완료 · Esc 취소`;
      case 'drawing-path': return `Path 경로 · ${n}점 (2점 이상) · Enter 완료 · Esc 취소`;
      case 'drawing-connector': return `Connector · ${n}/2점 클릭 · Esc 취소`;
      default: return null;
    }
  })();

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
            onToggleCutout={toggleCutout}
            cutoutIds={cutoutIds}
            hasCutouts={!!cutouts}
            onToggleSpotlight={toggleSpotlight}
            spotlightIds={spotlightIds}
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
            draftCount={draftZone.length}
            circleParams={circleParams}
            setCircleParams={setCircleParams}
            zoneParams={zoneParams}
            setZoneParams={setZoneParams}
            zoomParams={zoomParams}
            setZoomParams={setZoomParams}
            textDraft={textDraft}
            setTextDraft={setTextDraft}
            onCreate={startFeature}
            onFinishDraft={finishDraft}
            onCancelDraft={cancelDraft}
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
          hint={stageHint}
          selectedId={selectedOverlayId}
          players={players}
          cutouts={cutouts}
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
          zoom={tlZoom}
          onZoom={setTlZoom}
          snap={snap}
          onToggleSnap={() => setSnap((s) => !s)}
        />

        <Timeline
          overlays={overlays}
          duration={dur}
          currentTime={cur}
          selectedId={selectedOverlayId}
          videoName={videoName}
          zoom={tlZoom}
          snap={snap}
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
