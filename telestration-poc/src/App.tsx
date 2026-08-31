import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoStage } from './components/VideoStage';
import { Rail } from './components/layout/Rail';
import { MediaPanel } from './components/layout/panels/MediaPanel';
import { CourtPanel } from './components/layout/panels/CourtPanel';
import { EffectPanel } from './components/layout/panels/EffectPanel';
import { NarrativePanel } from './components/layout/panels/NarrativePanel';
import { EditingToolbar } from './components/EditingToolbar';
import { Timeline } from './components/Timeline';
import { ExportDropdown } from './components/ExportDropdown';
import { ProjectList } from './components/ProjectList';
import { listProjects, saveProject, deleteProject as deleteProjectRec, newProject, newVideoKey, saveVideoBlob, loadVideoBlob } from './lib/projects';
import type { Project } from './lib/projects';
import { getPerspectiveTransform, invert3x3, projectCourtPoint, unprojectToCourt } from './geometry/homography';
import type { Pt } from './geometry/homography';
import { COURT_CORNERS } from './geometry/court';
import { courtLineDef, fitImageLine, homographyFromLines, familiesCovered } from './geometry/lineCalib';
import { PLAYER_COLORS, playerColor, hitTestFragment, assignFragments } from './geometry/tracking';
import type {
  CircleParams, CourtCalibration, CutoutData, DrawnLine, FeatureId, FragmentData, Fragments, Mode, Overlay,
  PathParams, PlayerAnchor, PlayerCutouts, Players, RailTab, TextParams, TrackingData, ZoneParams, ZoomParams,
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

// Which Effect-tab feature owns an overlay (so selecting it opens the right editor).
function featureForOverlay(o: Overlay): FeatureId {
  switch (o.type) {
    case 'ground-halo': return o.trackId ? 'follow-circle' : 'circle';
    case 'cutout': return 'cutout';
    case 'spotlight': return 'spotlight';
    case 'marker': return 'marker';
    case 'text': return 'text';
    case 'coverage-zone': return 'zone';
    case 'path': return 'path';
    case 'connector': return 'connector';
    case 'zoom-in': return 'zoom-in';
    case 'speed': return 'slowmo';
  }
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  // project shell: 'projects' landing vs the 'editor'
  const [view, setView] = useState<'projects' | 'editor'>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [videoKey, setVideoKey] = useState<string | null>(null); // IndexedDB key; null = bundled court.mp4

  const [src, setSrc] = useState(DEFAULT_SRC);
  const [videoName, setVideoName] = useState('court.mp4');
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const [calibration, setCalibration] = useState<CourtCalibration | null>(null);
  const [calibMethod, setCalibMethod] = useState<'corner' | 'line' | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [past, setPast] = useState<Overlay[][]>([]);   // undo stack (snapshots before each edit)
  const [future, setFuture] = useState<Overlay[][]>([]); // redo stack
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
  const [selectedFeature, setSelectedFeature] = useState<FeatureId>('follow-circle');
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [circleParams, setCircleParams] = useState<CircleParams>({ radiusMeters: 0.8, color: '#E4EF3D', opacity: 0.2 });
  const [zoneParams, setZoneParams] = useState<ZoneParams>({ color: '#17335F', opacity: 0.18 });
  const [zoomParams, setZoomParams] = useState<ZoomParams>({ scale: 2.2 });
  const [pathParams, setPathParams] = useState<PathParams>({ shape: 'court-line', height: 0.4, color: FEATURE_COLORS.path, dashed: false });
  const [pathDraft, setPathDraft] = useState<Pt | null>(null); // first click (video px) while drawing a path
  const [textDraft, setTextDraft] = useState('텍스트'); // Text feature: content typed in the panel
  const [textParams, setTextParams] = useState<TextParams>({ fontSize: 22, fontFamily: 'sans-serif', bold: true, align: 'center', color: '#FFFFFF', bg: true, bgColor: '#000000', bgOpacity: 0.55 });
  const [slowmoRate, setSlowmoRate] = useState(0.5); // default rate for new speed segments

  // playback
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [tlZoom, setTlZoom] = useState(1); // timeline horizontal zoom (1 = fit whole clip)
  const [snap, setSnap] = useState(true);  // snap dragged bars to playhead / edges
  const [speed, setSpeed] = useState(1);   // preview playback rate (0.25×–2×)

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

  // ── projects ─────────────────────────────────────────────────────────────
  useEffect(() => { if (view === 'projects') setProjects(listProjects()); }, [view]);

  const openProject = async (p: Project) => {
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    if (p.videoKey) {
      const blob = await loadVideoBlob(p.videoKey);
      if (blob) { const url = URL.createObjectURL(blob); blobUrlRef.current = url; setSrc(url); }
      else setSrc(DEFAULT_SRC);
    } else setSrc(DEFAULT_SRC);
    setVideoKey(p.videoKey);
    setVideoName(p.videoName);
    if (p.corners && p.corners.length === 4) {
      const H = getPerspectiveTransform(COURT_CORNERS, p.corners);
      setCalibration({ imagePoints: p.corners, homography: H, inverseHomography: invert3x3(H) });
      setCalibMethod(p.calibMethod);
    } else { setCalibration(null); setCalibMethod(null); }
    setOverlays(p.overlays ?? []);
    setPast([]); setFuture([]);
    setPlayerAnchors(p.playerAnchors ?? []);
    setSelectedOverlayId(null);
    setDraftCalib([]); setDraftZone([]); setPathDraft(null); setDrawnLines([]); setLineDraft([]); setActiveLineId(null);
    setMode('idle');
    setActiveTab('court');
    setProjectId(p.id); setProjectName(p.name);
    setView('editor');
  };
  const createProject = async (name: string, file: File | null) => {
    let p = newProject(name);
    if (file) {
      const key = newVideoKey();
      try { await saveVideoBlob(key, file); } catch { /* quota — video won't persist */ }
      p = { ...p, videoName: file.name, videoKey: key };
    }
    saveProject(p);
    await openProject(p);
  };
  const removeProject = (id: string) => { deleteProjectRec(id); setProjects(listProjects()); };
  const backToProjects = () => { setView('projects'); };

  // re-apply user player-calibration once fragments load for an opened project
  useEffect(() => {
    if (view === 'editor' && fragments && playerAnchors.length >= 2) setPlayers(assignFragments(fragments, playerAnchors));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fragments]);

  // auto-save the open project (debounced) whenever its content changes
  useEffect(() => {
    if (view !== 'editor' || !projectId) return;
    const t = setTimeout(() => {
      saveProject({
        id: projectId, name: projectName, updatedAt: Date.now(), videoName, videoKey,
        corners: calibration?.imagePoints ?? null, calibMethod, overlays, playerAnchors,
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, projectId, projectName, videoName, videoKey, calibration, calibMethod, overlays, playerAnchors]);

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
    if (v.readyState >= 1) { onMeta(); onTime(); } // cached video: metadata already loaded before listener
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
    // `view` re-binds after the video element remounts on entering the editor.
  }, [src, view]);

  // apply preview playback rate (playbackRate resets when the video reloads / remounts)
  useEffect(() => { const v = videoRef.current; if (v) v.playbackRate = speed; }, [speed, src, view]);

  // Selecting an overlay (canvas or timeline) opens its editor: switch to its feature tile + Effect tab.
  useEffect(() => {
    if (!selectedOverlayId) return;
    const o = overlays.find((x) => x.id === selectedOverlayId);
    if (!o) return;
    setSelectedFeature(featureForOverlay(o));
    setActiveTab('effect');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOverlayId]);

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

  // Per-segment slow-mo: whenever the playhead moves, inside a speed segment → its rate, else the
  // global speed. Keyed on `cur` (updates via rAF when visible, timeupdate when hidden) so it's robust.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seg = overlays.find((o): o is Extract<Overlay, { type: 'speed' }> => o.type === 'speed' && o.visible && cur >= o.startTime && cur <= o.endTime);
    const rate = seg ? seg.rate : speed;
    if (v.playbackRate !== rate) v.playbackRate = rate;
  }, [cur, overlays, speed]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setCur(t);
  };
  const changeRange = (id: string, startTime: number, endTime: number) =>
    setOverlays((o) => o.map((x) => (x.id === id ? { ...x, startTime, endTime } : x)));

  // ── undo / redo history ─────────────────────────────────────────────────
  // Snapshot the current overlays before an edit. Discrete edits go through mutate();
  // a continuous drag calls beginHistory() once at drag-start, then changeRange() freely.
  const beginHistory = () => { setPast((p) => [...p.slice(-49), overlays]); setFuture([]); };
  const mutate = (fn: (o: Overlay[]) => Overlay[]) => { beginHistory(); setOverlays(fn); };
  const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [overlays, ...f]);
    setOverlays(prev);
    setSelectedOverlayId((s) => (prev.some((x) => x.id === s) ? s : null));
  };
  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, overlays]);
    setOverlays(next);
    setSelectedOverlayId((s) => (next.some((x) => x.id === s) ? s : null));
  };

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
  // A speed segment is a timeline-only clip (no canvas placement) added at the playhead.
  const addSpeedSegment = () =>
    mutate((o) => [...o, { id: uid('speed'), type: 'speed', name: nextName(o, 'speed', 'Slow'), visible: true, ...spanAtPlayhead(), rate: slowmoRate }]);
  const updateSpeed = (id: string, rate: number) =>
    setOverlays((o) => o.map((x) => (x.id === id && x.type === 'speed' ? { ...x, rate } : x)));

  // Enter/exit a feature's placement or drawing mode.
  const startFeature = (id: FeatureId) => {
    if (id === 'slowmo') { addSpeedSegment(); return; } // timeline clip — no calibration/placement needed
    if (!calibration) return;
    const target = FEATURE_MODE[id as keyof typeof FEATURE_MODE];
    if (!target) return;
    setMode((m) => (m === target ? 'idle' : target));
    setDraftZone([]);
    setPathDraft(null);
  };
  const nextName = (o: Overlay[], t: Overlay['type'], label: string) => `${label} ${o.filter((x) => x.type === t).length + 1}`;
  // Finish a multi-point drawing (Zone ≥3 closed / Path ≥2 arrow).
  const finishDraft = () => {
    const pts = draftZone;
    if (mode === 'drawing-zone' && pts.length >= 3) {
      mutate((o) => [...o, { id: uid('zone'), type: 'coverage-zone', name: nextName(o, 'coverage-zone', 'Zone'), visible: true, ...spanAtPlayhead(), points: pts, color: zoneParams.color, opacity: zoneParams.opacity }]);
    }
    setDraftZone([]);
    setMode('idle');
  };
  // Live-edit a placed path (shape/height/points) — no history churn per slider tick.
  const updatePath = (id: string, patch: Partial<{ shape: 'line' | 'arc'; height: number; dashed: boolean; color: string; points: { x: number; y: number }[] }>) =>
    setOverlays((o) => o.map((x) => (x.id === id && x.type === 'path' ? { ...x, ...patch } : x)));
  // Live-edit a placed text box (content/style/size/position).
  const updateText = (id: string, patch: Partial<Extract<Overlay, { type: 'text' }>>) =>
    setOverlays((o) => o.map((x) => (x.id === id && x.type === 'text' ? { ...x, ...patch } : x)));
  const cancelDraft = () => { setDraftZone([]); setPathDraft(null); setMode('idle'); };

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
    mutate((o) => [...o, {
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
    mutate((o) => [...o, {
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
    mutate((o) => [...o, { id: uid('spot'), type: 'spotlight', name: `Spotlight ${playerId}`, visible: true, ...span, trackId: playerId }]);
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
    mutate((o) => o.filter((x) => !(x.type === 'ground-halo' && x.trackId))); // drop stale tracked halos
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
    if (mode === 'drawing-path') {
      // 2-click path. Screen-space lines don't need the court; court-space ones do.
      const isScreen = pathParams.shape === 'screen-line';
      if (!isScreen && !calibration) return;
      if (pathDraft) {
        const conv = (v: Pt) =>
          isScreen ? { x: v.x, y: v.y } : (() => { const c = unprojectToCourt(calibration!.inverseHomography, v.x, v.y); return { x: c.x, y: c.y }; })();
        const shape: 'line' | 'arc' = pathParams.shape === 'arc' ? 'arc' : 'line';
        mutate((o) => [...o, {
          id: uid('path'), type: 'path', name: nextName(o, 'path', 'Path'), visible: true, ...spanAtPlayhead(),
          space: isScreen ? 'screen' : 'court', shape, points: [conv(pathDraft), conv(videoPt)],
          height: shape === 'arc' ? pathParams.height : 0, dashed: pathParams.dashed, color: pathParams.color,
        }]);
        setPathDraft(null);
        setMode('idle');
      } else {
        setPathDraft(videoPt);
      }
      return;
    }
    if (!calibration) return;
    const court = unprojectToCourt(calibration.inverseHomography, videoPt.x, videoPt.y);
    const cxy = { courtX: court.x, courtY: court.y };
    if (mode === 'placing-halo') {
      mutate((o) => [...o, { id: uid('halo'), type: 'ground-halo', name: nextName(o, 'ground-halo', 'Circle'), visible: true, ...spanAtPlayhead(), courtX: court.x, courtY: court.y, radiusMeters: circleParams.radiusMeters, color: circleParams.color, opacity: circleParams.opacity }]);
    } else if (mode === 'placing-marker') {
      mutate((o) => [...o, { id: uid('marker'), type: 'marker', name: nextName(o, 'marker', 'Marker'), visible: true, ...spanAtPlayhead(), ...cxy, color: FEATURE_COLORS.marker }]);
    } else if (mode === 'placing-text') {
      const text = textDraft.trim() || '텍스트';
      mutate((o) => [...o, {
        id: uid('text'), type: 'text', name: nextName(o, 'text', 'Text'), visible: true, ...spanAtPlayhead(),
        ...cxy, text, boxW: 180, boxH: 52,
        fontSize: textParams.fontSize, fontFamily: textParams.fontFamily, bold: textParams.bold, align: textParams.align,
        color: textParams.color, bg: textParams.bg, bgColor: textParams.bgColor, bgOpacity: textParams.bgOpacity,
      }]);
    } else if (mode === 'placing-zoom') {
      mutate((o) => [...o, { id: uid('zoom'), type: 'zoom-in', name: nextName(o, 'zoom-in', 'Zoom'), visible: true, ...spanAtPlayhead(), ...cxy, scale: zoomParams.scale }]);
    } else if (mode === 'drawing-zone') {
      setDraftZone((z) => [...z, cxy]);
    } else if (mode === 'drawing-connector') {
      if (draftZone.length >= 1) {
        const p0 = draftZone[0];
        mutate((o) => [...o, { id: uid('conn'), type: 'connector', name: nextName(o, 'connector', 'Connector'), visible: true, ...spanAtPlayhead(), points: [p0, cxy], color: FEATURE_COLORS.connector }]);
        setDraftZone([]);
        setMode('idle');
      } else {
        setDraftZone([cxy]);
      }
    }
  };

  // ── layer stack ────────────────────────────────────────────────────────
  const removeOverlay = (id: string) => {
    mutate((o) => o.filter((x) => x.id !== id));
    setSelectedOverlayId((s) => (s === id ? null : s));
  };
  const toggleVisible = (id: string) => mutate((o) => o.map((x) => (x.id === id ? { ...x, visible: !x.visible } : x)));
  const duplicateOverlay = (id: string) => {
    mutate((o) => {
      const src = o.find((x) => x.id === id);
      if (!src) return o;
      const name = `${src.name} copy`, newId = uid('dup');
      if (src.type === 'ground-halo' || src.type === 'marker' || src.type === 'text' || src.type === 'zoom-in') {
        return [...o, { ...src, id: newId, name, courtX: src.courtX + 0.6, courtY: src.courtY + 0.6 }];
      }
      if (src.type === 'cutout' || src.type === 'spotlight' || src.type === 'speed') return [...o, { ...src, id: newId, name }];
      if (src.type === 'path') {
        const off = src.space === 'screen' ? 24 : 0.4;
        return [...o, { ...src, id: newId, name, points: src.points.map((p) => ({ x: p.x + off, y: p.y + off })) }];
      }
      return [...o, { ...src, id: newId, name, points: src.points.map((p) => ({ courtX: p.courtX + 0.6, courtY: p.courtY + 0.6 })) }];
    });
  };
  const deleteSelected = () => selectedOverlayId && removeOverlay(selectedOverlayId);
  // Split the selected overlay at the playhead into two clips [start,cur] + [cur,end].
  const selectedOverlay = overlays.find((x) => x.id === selectedOverlayId) ?? null;
  const canSplit = !!selectedOverlay && cur > selectedOverlay.startTime + 0.05 && cur < selectedOverlay.endTime - 0.05;
  const splitSelected = () => {
    if (!selectedOverlay || !canSplit) return;
    mutate((prev) => prev.flatMap((x) => (x.id === selectedOverlay.id
      ? [{ ...x, endTime: cur }, { ...x, id: uid('split'), name: `${x.name}₂`, startTime: cur }]
      : [x])));
  };

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
    // persist the uploaded video to IndexedDB so this project auto-restores it later
    const key = newVideoKey();
    void saveVideoBlob(key, file).catch(() => {});
    setVideoKey(key);
    setSrc(url);
    setVideoName(file.name);
    setCalibration(null);
    setCalibMethod(null);
    setOverlays([]);
    setPast([]);
    setFuture([]);
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
        setPathDraft(null);
        setDraftCalib([]);
        setLineDraft([]);
        setDrawnLines([]);
        setActiveLineId(null);
        setPlayerAnchors([]);
      } else if (e.key === 'Enter' && mode === 'drawing-zone') finishDraft();
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
      case 'drawing-path': return `Path · 시작·끝 2점 클릭 (${pathDraft ? 1 : 0}/2) · Esc 취소`;
      case 'editing-path': return 'Path 끝점을 드래그해 이동 · Esc 완료';
      case 'editing-text': return '박스를 드래그해 이동 · 모서리 핸들로 크기 조절 · Esc 완료';
      case 'drawing-connector': return `Connector · ${n}/2점 클릭 · Esc 취소`;
      default: return null;
    }
  })();

  if (view === 'projects') {
    return <ProjectList projects={projects} onOpen={(p) => void openProject(p)} onCreate={(name, file) => void createProject(name, file)} onDelete={removeProject} />;
  }

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
        {activeTab === 'effect' && (
          <EffectPanel
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
            hasFragments={!!fragments}
            anchorCount={playerAnchors.length}
            onStartPlayerCalib={startPlayerCalibration}
            onFinishPlayerCalib={finishPlayerCalibration}
            onCancelPlayerCalib={cancelPlayerCalibration}
            selected={selectedFeature}
            onSelect={setSelectedFeature}
            mode={mode}
            draftCount={mode === 'drawing-path' ? (pathDraft ? 1 : 0) : draftZone.length}
            circleParams={circleParams}
            setCircleParams={setCircleParams}
            zoneParams={zoneParams}
            setZoneParams={setZoneParams}
            zoomParams={zoomParams}
            setZoomParams={setZoomParams}
            pathParams={pathParams}
            setPathParams={setPathParams}
            selectedPath={selectedOverlay?.type === 'path' ? selectedOverlay : null}
            onUpdatePath={updatePath}
            onEditPath={() => setMode('editing-path')}
            editingPath={mode === 'editing-path'}
            onFinishEditPath={() => setMode('idle')}
            textDraft={textDraft}
            setTextDraft={setTextDraft}
            textParams={textParams}
            setTextParams={setTextParams}
            selectedText={selectedOverlay?.type === 'text' ? selectedOverlay : null}
            onUpdateText={updateText}
            onEditText={() => setMode('editing-text')}
            editingText={mode === 'editing-text'}
            onFinishEditText={() => setMode('idle')}
            slowmoRate={slowmoRate}
            setSlowmoRate={setSlowmoRate}
            selectedSpeed={selectedOverlay?.type === 'speed' ? selectedOverlay : null}
            onUpdateSpeed={updateSpeed}
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
            <button className="btn ghost sm back-projects" onClick={backToProjects} title="프로젝트 목록으로 (자동 저장됨)">← 프로젝트</button>
            <span className="center-title">{projectName || videoName}</span>
            <span className="center-sub">{calibration ? `캘리브레이션 ✓ (${calibMethod === 'line' ? '선' : '모서리'})` : '미보정'} · 오버레이 {overlays.length} · 자동 저장</span>
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
          onSelectOverlay={setSelectedOverlayId}
          players={players}
          cutouts={cutouts}
          fragments={fragments}
          playerAnchors={playerAnchors}
          fps={trackFps}
          draftCalib={draftCalib}
          draftZone={draftZone}
          pathDraft={pathDraft}
          onUpdatePathPoints={(id, points) => updatePath(id, { points })}
          onUpdateText={updateText}
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
          canUndo={past.length > 0}
          onRedo={redo}
          canRedo={future.length > 0}
          onSplit={splitSelected}
          canSplit={canSplit}
          onDelete={deleteSelected}
          canDelete={!!selectedOverlayId}
          cur={cur}
          dur={dur}
          speed={speed}
          onSpeed={setSpeed}
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
          speed={speed}
          zoom={tlZoom}
          snap={snap}
          onBeginHistory={beginHistory}
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
