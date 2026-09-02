import { useEffect, useRef, useState } from 'react';
import { VideoStage } from './components/VideoStage';
import { Rail } from './components/layout/Rail';
import { CourtPanel } from './components/layout/panels/CourtPanel';
import { EffectPanel } from './components/layout/panels/EffectPanel';
import { NarrativePanel } from './components/layout/panels/NarrativePanel';
import { EditingToolbar } from './components/EditingToolbar';
import { Timeline } from './components/Timeline';
import { ExportDropdown } from './components/ExportDropdown';
import { SettingsDropdown } from './components/SettingsDropdown';
import { ProjectList } from './components/ProjectList';
import { listProjects, saveProject, deleteProject as deleteProjectRec, newProject, newVideoKey, saveVideoBlob, loadVideoBlob, saveAnalysis, loadAnalysis } from './lib/projects';
import type { Project } from './lib/projects';
import { getPerspectiveTransform, invert3x3, projectCourtPoint, unprojectToCourt } from './geometry/homography';
import type { Pt } from './geometry/homography';
import { COURT_CORNERS } from './geometry/court';
import { courtLineDef, fitImageLine, homographyFromLines, familiesCovered } from './geometry/lineCalib';
import { PLAYER_COLORS, playerColor, hitTestFragment, assignFragments } from './geometry/tracking';
import type {
  CircleParams, CourtCalibration, DrawnLine, FeatureId, FragmentData, Fragments, Mode, Overlay,
  PathParams, PlayerAnchor, Players, RailTab, TextParams, TrackingData, ZoneParams, ZoomParams,
} from './types';

// Local ML bridge exposed by the Electron preload (absent in the plain web build).
declare global {
  interface Window {
    ml?: {
      analyze: (video: ArrayBuffer, options?: { step?: number }) => Promise<{
        fragments: { tracks: Fragments; fps: number };
        players: { players: Players };
        stats?: { trackCount: number; playerCount: number; provider: string; framesProcessed: number };
      }>;
      onProgress: (cb: (p: number) => void) => () => void;
    };
  }
}

let idCounter = 0;
const uid = (p: string) => `${p}-${++idCounter}`;
// Seed the id counter above any id already present so freshly-created overlays
// never collide with ones restored from a saved project (the counter resets on reload).
const seedIdCounter = (overlays: { id: string }[]) => {
  for (const o of overlays) {
    const m = /-(\d+)$/.exec(o.id);
    if (m) idCounter = Math.max(idCounter, Number(m[1]));
  }
};

const DEFAULT_SRC = '/court.mp4';
const DEFAULT_LEN = 5; // new static effects span this many seconds from the playhead
const FOLLOW_LEN = 8;  // new player-follow effects span this many seconds from the playhead
const clampT = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const FEATURE_COLORS: Record<string, string> = { marker: '#FF3B3B', text: '#FFFFFF', path: '#FF3B3B', connector: '#00E5FF', sector: '#7C5CFF' };
const FEATURE_MODE = {
  circle: 'placing-halo', marker: 'placing-marker', text: 'placing-text',
  zone: 'drawing-zone', path: 'drawing-path', connector: 'drawing-connector',
  sector: 'drawing-sector', 'zoom-in': 'placing-zoom',
} as const;

// Which Effect-tab feature owns an overlay (so selecting it opens the right editor).
function featureForOverlay(o: Overlay): FeatureId {
  switch (o.type) {
    case 'ground-halo': return o.trackId ? 'follow-circle' : 'circle';
    case 'spotlight': return 'spotlight';
    case 'marker': return 'marker';
    case 'text': return 'text';
    case 'coverage-zone': return 'zone';
    case 'sector': return 'sector';
    case 'path': return 'path';
    case 'connector': return 'connector';
    case 'zoom-in': return 'zoom-in';
    case 'speed': return 'slowmo';
  }
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  // project shell: 'projects' landing → 'calibrate' (import-time court setup) → 'editor'
  const [view, setView] = useState<'projects' | 'calibrate' | 'analyze' | 'editor'>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [videoKey, setVideoKey] = useState<string | null>(null); // IndexedDB key; null = bundled court.mp4
  const [thumbnail, setThumbnail] = useState<string | null>(null); // project card thumbnail (JPEG data URL)

  const [src, setSrc] = useState(DEFAULT_SRC);
  const [videoName, setVideoName] = useState('court.mp4');
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const [calibration, setCalibration] = useState<CourtCalibration | null>(null);
  const [calibMethod, setCalibMethod] = useState<'corner' | 'line' | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [past, setPast] = useState<Overlay[][]>([]);   // undo stack (snapshots before each edit)
  const [future, setFuture] = useState<Overlay[][]>([]); // redo stack
  const [mode, setMode] = useState<Mode>('idle');

  // calibration drafts
  const [draftCalib, setDraftCalib] = useState<Pt[]>([]);
  const [draftZone, setDraftZone] = useState<{ courtX: number; courtY: number }[]>([]);
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const [lineDraft, setLineDraft] = useState<Pt[]>([]);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  // UI shell state
  const [activeTab, setActiveTab] = useState<RailTab>('effect');
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
  const [trackFps, setTrackFps] = useState(30);
  const [analyzed, setAnalyzed] = useState(false); // this project's player tracking has been run
  const [analyzing, setAnalyzing] = useState<{ pct: number; error?: string } | null>(null);
  const hasML = typeof window !== 'undefined' && !!window.ml; // Electron desktop build only
  const [playerAnchors, setPlayerAnchors] = useState<PlayerAnchor[]>([]);
  // Load a project's player-tracking into state: prefer its own analysis (in
  // IndexedDB); for the bundled sample (no uploaded video) fall back to the
  // shipped court.mp4 JSON; otherwise leave empty (needs analysis).
  const loadTracking = async (p: Project) => {
    if (p.analyzed) {
      const a = await loadAnalysis(p.id);
      if (a) { setFragments(a.fragments); setPlayers(a.players); setTrackFps(a.fps || 30); return; }
    }
    if (!p.videoKey) {
      try {
        const [pj, fj] = await Promise.all([
          fetch('/players.json').then((r) => (r.ok ? r.json() as Promise<TrackingData> : null)),
          fetch('/fragments.json').then((r) => (r.ok ? r.json() as Promise<FragmentData> : null)),
        ]);
        setPlayers(pj?.players ?? null); setFragments(fj?.tracks ?? null); setTrackFps(pj?.fps || 30);
        return;
      } catch { /* ignore */ }
    }
    setFragments(null); setPlayers(null); setTrackFps(30);
  };

  // ── projects ─────────────────────────────────────────────────────────────
  useEffect(() => { if (view === 'projects') setProjects(listProjects()); }, [view]);

  // entering the import-time calibration step arms corner calibration
  useEffect(() => {
    if (view === 'calibrate' && !calibration && mode === 'idle') startCalibration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // capture a card thumbnail on first entering the editor if the project has none.
  // wait for an actually-presented frame (a fresh <video> paints black for a moment).
  useEffect(() => {
    if (view !== 'editor' || thumbnail) return;
    const v = videoRef.current;
    if (!v) return;
    let done = false;
    const grab = () => { if (!done) { done = true; captureThumb(); } };
    const whenReady = () => {
      const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
      if (rvfc) rvfc.call(v, () => grab());
      setTimeout(grab, 500); // fallback if no frame is presented (paused static frame)
    };
    if (v.readyState >= 2) whenReady();
    else v.addEventListener('loadeddata', whenReady, { once: true });
    return () => { done = true; v.removeEventListener('loadeddata', whenReady); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, thumbnail]);

  // capture the current video frame as a small JPEG for the project card
  const captureThumb = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const w = 200, h = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); if (!ctx) return;
    try { ctx.drawImage(v, 0, 0, w, h); setThumbnail(c.toDataURL('image/jpeg', 0.6)); } catch { /* no frame / tainted */ }
  };

  const openProject = async (p: Project, toView: 'editor' | 'calibrate' = 'editor') => {
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    if (p.videoKey) {
      const blob = await loadVideoBlob(p.videoKey);
      if (blob) { const url = URL.createObjectURL(blob); blobUrlRef.current = url; setSrc(url); }
      else setSrc(DEFAULT_SRC);
    } else setSrc(DEFAULT_SRC);
    setVideoKey(p.videoKey);
    setVideoName(p.videoName);
    setThumbnail(p.thumbnail ?? null);
    if (p.corners && p.corners.length === 4) {
      const H = getPerspectiveTransform(COURT_CORNERS, p.corners);
      setCalibration({ imagePoints: p.corners, homography: H, inverseHomography: invert3x3(H) });
      setCalibMethod(p.calibMethod);
    } else { setCalibration(null); setCalibMethod(null); }
    setOverlays(p.overlays ?? []);
    seedIdCounter(p.overlays ?? []);
    setPast([]); setFuture([]);
    setPlayerAnchors(p.playerAnchors ?? []);
    setSelectedOverlayId(null);
    setDraftCalib([]); setDraftZone([]); setPathDraft(null); setDrawnLines([]); setLineDraft([]); setActiveLineId(null);
    setMode('idle');
    setActiveTab('effect');
    setProjectId(p.id); setProjectName(p.name);
    setAnalyzed(!!p.analyzed); setAnalyzing(null);
    await loadTracking(p);
    // Calibration is required — an un-calibrated project always opens into the wizard's
    // calibration step, never straight into the editor.
    const calibrated = !!(p.corners && p.corners.length === 4);
    setView(toView === 'editor' && !calibrated ? 'calibrate' : toView);
  };
  const createProject = async (name: string, file: File | null) => {
    let p = newProject(name);
    if (file) {
      const key = newVideoKey();
      try { await saveVideoBlob(key, file); } catch { /* quota — video won't persist */ }
      p = { ...p, videoName: file.name, videoKey: key };
    }
    saveProject(p);
    await openProject(p, 'calibrate'); // new project → court-calibration step first
  };
  const removeProject = (id: string) => { deleteProjectRec(id); setProjects(listProjects()); };
  const renameProject = (id: string, name: string) => {
    const p = listProjects().find((x) => x.id === id);
    if (p && name.trim()) saveProject({ ...p, name: name.trim(), updatedAt: Date.now() });
    setProjects(listProjects());
  };
  const backToProjects = () => { setView('projects'); };

  // ── player analysis (Electron-only local ML) ───────────────────────────────
  const currentVideoBytes = async (): Promise<ArrayBuffer | null> => {
    if (videoKey) { const blob = await loadVideoBlob(videoKey); return blob ? await blob.arrayBuffer() : null; }
    const r = await fetch(DEFAULT_SRC); return r.ok ? await r.arrayBuffer() : null;
  };
  const runAnalysis = async () => {
    if (!window.ml || !projectId) { setView('editor'); return; }
    setAnalyzing({ pct: 0 });
    const off = window.ml.onProgress((p) => setAnalyzing({ pct: p }));
    try {
      const bytes = await currentVideoBytes();
      if (!bytes) throw new Error('영상을 불러올 수 없습니다');
      const res = await window.ml.analyze(bytes, { step: 3 });
      const data = { fragments: res.fragments.tracks, players: res.players.players, fps: res.fragments.fps };
      await saveAnalysis(projectId, data);
      setFragments(data.fragments); setPlayers(data.players); setTrackFps(data.fps);
      setAnalyzed(true); setAnalyzing(null); setView('editor');
    } catch (e) {
      setAnalyzing({ pct: 0, error: e instanceof Error ? e.message : String(e) });
    } finally { off(); }
  };
  // after court calibration → analysis step (desktop, first time), else the editor
  const goAfterCalibrate = () => {
    captureThumb();
    setView(hasML && !analyzed ? 'analyze' : 'editor');
  };

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
        thumbnail: thumbnail ?? undefined, analyzed, trackFps,
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, projectId, projectName, videoName, videoKey, calibration, calibMethod, overlays, playerAnchors, thumbnail, analyzed, trackFps]);

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
  const addSpeedSegment = () => {
    const id = uid('speed');
    mutate((o) => [...o, { id, type: 'speed', name: nextName(o, 'speed', 'Slow'), visible: true, ...spanAtPlayhead(), rate: slowmoRate }]);
  };
  const updateSpeed = (id: string, rate: number) =>
    setOverlays((o) => o.map((x) => (x.id === id && x.type === 'speed' ? { ...x, rate } : x)));

  // Enter/exit a feature's placement or drawing mode.
  const startFeature = (id: FeatureId) => {
    if (id === 'slowmo') { addSpeedSegment(); return; } // timeline clip — no calibration/placement needed
    if (!calibration) return;
    const target = FEATURE_MODE[id as keyof typeof FEATURE_MODE];
    if (!target) return;
    setSelectedOverlayId(null); // arming a placement tool clears the previous selection (add ≠ select)
    setMode((m) => (m === target ? 'idle' : target));
    setDraftZone([]);
    setPathDraft(null);
  };
  const nextName = (o: Overlay[], t: Overlay['type'], label: string) => `${label} ${o.filter((x) => x.type === t).length + 1}`;
  // Finish a multi-point drawing (Zone ≥3 closed / Path ≥2 arrow).
  const finishDraft = () => {
    const pts = draftZone;
    if (mode === 'drawing-zone' && pts.length >= 3) {
      const id = uid('zone');
      mutate((o) => [...o, { id, type: 'coverage-zone', name: nextName(o, 'coverage-zone', 'Zone'), visible: true, ...spanAtPlayhead(), points: pts, color: zoneParams.color, opacity: zoneParams.opacity }]);
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
  // Live-edit a placed sector (centre/radius/direction) — drag handles + inspector.
  const updateSector = (id: string, patch: Partial<Extract<Overlay, { type: 'sector' }>>) =>
    setOverlays((o) => o.map((x) => (x.id === id && x.type === 'sector' ? { ...x, ...patch } : x)));
  // Generic property patch (color/size/opacity) for the selected overlay — halo/marker/zone/connector.
  const patchOverlay = (id: string, patch: object) =>
    setOverlays((o) => o.map((x) => (x.id === id ? ({ ...x, ...patch } as Overlay) : x)));
  const cancelDraft = () => { setDraftZone([]); setPathDraft(null); setMode('idle'); };

  // Toggle a Circle bound to a tracked player. Its court position is derived
  // per-frame (foot → H⁻¹ → court); span = the player's tracked span; each player
  // gets a distinct color.
  // Add a follow-circle for a player (not a toggle) — each click adds a circle to
  // the timeline, like any other effect; remove it via the timeline / delete.
  const followPlayer = (playerId: string) => {
    if (!calibration || !players) return;
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
        const id = uid('path');
        mutate((o) => [...o, {
          id, type: 'path', name: nextName(o, 'path', 'Path'), visible: true, ...spanAtPlayhead(),
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
      const id = uid('halo');
      mutate((o) => [...o, { id, type: 'ground-halo', name: nextName(o, 'ground-halo', 'Circle'), visible: true, ...spanAtPlayhead(), courtX: court.x, courtY: court.y, radiusMeters: circleParams.radiusMeters, color: circleParams.color, opacity: circleParams.opacity }]);
      setMode('idle');
    } else if (mode === 'placing-marker') {
      const id = uid('marker');
      mutate((o) => [...o, { id, type: 'marker', name: nextName(o, 'marker', 'Marker'), visible: true, ...spanAtPlayhead(), ...cxy, color: FEATURE_COLORS.marker }]);
      setMode('idle');
    } else if (mode === 'placing-text') {
      const id = uid('text');
      const text = textDraft.trim() || '텍스트';
      mutate((o) => [...o, {
        id, type: 'text', name: nextName(o, 'text', 'Text'), visible: true, ...spanAtPlayhead(),
        ...cxy, text, boxW: 180, boxH: 52,
        fontSize: textParams.fontSize, fontFamily: textParams.fontFamily, bold: textParams.bold, align: textParams.align,
        color: textParams.color, bg: textParams.bg, bgColor: textParams.bgColor, bgOpacity: textParams.bgOpacity,
      }]);
      setMode('idle');
    } else if (mode === 'placing-zoom') {
      const id = uid('zoom');
      mutate((o) => [...o, { id, type: 'zoom-in', name: nextName(o, 'zoom-in', 'Zoom'), visible: true, ...spanAtPlayhead(), ...cxy, scale: zoomParams.scale }]);
      setMode('idle');
    } else if (mode === 'drawing-zone') {
      setDraftZone((z) => [...z, cxy]);
    } else if (mode === 'drawing-connector') {
      if (draftZone.length >= 1) {
        const p0 = draftZone[0];
        const id = uid('conn');
        mutate((o) => [...o, { id, type: 'connector', name: nextName(o, 'connector', 'Connector'), visible: true, ...spanAtPlayhead(), points: [p0, cxy], color: FEATURE_COLORS.connector }]);
        setDraftZone([]); setMode('idle');
      } else {
        setDraftZone([cxy]);
      }
    } else if (mode === 'drawing-sector') {
      if (draftZone.length >= 1) {
        const c = draftZone[0];
        const dx = cxy.courtX - c.courtX, dy = cxy.courtY - c.courtY;
        const radiusM = Math.max(0.5, Math.hypot(dx, dy));
        const dir = (Math.atan2(dy, dx) * 180) / Math.PI;
        const id = uid('sector');
        mutate((o) => [...o, { id, type: 'sector', name: nextName(o, 'sector', 'Sector'), visible: true, ...spanAtPlayhead(), courtX: c.courtX, courtY: c.courtY, radiusM, dir, spread: 60, color: FEATURE_COLORS.sector, opacity: 0.22 }]);
        setDraftZone([]); setMode('idle');
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
      if (src.type === 'ground-halo' || src.type === 'marker' || src.type === 'text' || src.type === 'zoom-in' || src.type === 'sector') {
        return [...o, { ...src, id: newId, name, courtX: src.courtX + 0.6, courtY: src.courtY + 0.6 }];
      }
      if (src.type === 'spotlight' || src.type === 'speed') return [...o, { ...src, id: newId, name }];
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
      case 'calibrating': return `바닥면 네 점을 순서대로 클릭 · ${draftCalib.length}/4 · Esc 취소`;
      case 'line-calibrating': return '선을 클릭해 그리세요 · Enter 완료 · Esc 취소';
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
      case 'drawing-sector': return `부채꼴 · ${draftZone.length < 1 ? '중심 클릭' : '방향·거리 점 클릭'} (${draftZone.length}/2) · Esc 취소`;
      case 'editing-sector': return '중심 드래그로 이동 · 끝점 드래그로 반지름·방향 · Esc 완료';
      default: return null;
    }
  })();

  const courtPanel = (
    <CourtPanel
      mode={mode} hasCalibration={!!calibration} method={calibMethod}
      draftCalibCount={draftCalib.length} activeLineId={activeLineId} lineDraftCount={lineDraft.length}
      currentLineIds={currentLineIds} lineCoverage={lineCoverage} canFinishLines={canFinishLines}
      onStartCorner={startCalibration} onStartLine={startLineCalibration} onReset={resetCalibration}
      onSelectLine={selectLine} onFinishLine={finishLineCalibration} onCancelLine={cancelLineCalibration}
    />
  );
  const videoStage = (
    <VideoStage
      src={src} videoRef={videoRef} calibration={calibration} overlays={overlays} mode={mode}
      currentTime={cur} hint={stageHint} selectedId={selectedOverlayId} onSelectOverlay={setSelectedOverlayId}
      players={players} fragments={fragments} playerAnchors={playerAnchors} fps={trackFps}
      draftCalib={draftCalib} draftZone={draftZone} pathDraft={pathDraft}
      onUpdatePathPoints={(id, points) => updatePath(id, { points })} onUpdateText={updateText} onUpdateSector={updateSector}
      showCalibration={view === 'calibrate'}
      drawnLines={drawnLines} lineDraft={lineDraft} activeLineId={activeLineId} onStageClick={onStageClick} onDimensions={(w, h) => setDims({ w, h })}
    />
  );

  // new-project wizard step indicator (영상 → 코트 보정 → 선수 분석)
  const wizardSteps = (current: 'calibrate' | 'analyze') => {
    const steps = hasML ? ['영상', '바닥면 보정', '선수 분석'] : ['영상', '바닥면 보정'];
    const cur = current === 'calibrate' ? 1 : 2;
    return (
      <div className="wizard-steps">
        {steps.map((s, i) => (
          <span key={i} className={`wizard-step ${i < cur ? 'done' : i === cur ? 'now' : ''}`}>
            <span className="wizard-num">{i + 1}</span>{s}
          </span>
        ))}
      </div>
    );
  };

  if (view === 'projects') {
    return <ProjectList projects={projects} onOpen={(p) => void openProject(p)} onCreate={(name, file) => void createProject(name, file)} onDelete={removeProject} onRename={renameProject} />;
  }

  if (view === 'calibrate') {
    return (
      <div className="calibrate-view">
        <header className="calibrate-head">
          <button className="btn ghost sm" onClick={backToProjects} title="프로젝트 목록으로">← 프로젝트</button>
          {wizardSteps('calibrate')}
          <button className="btn primary sm" onClick={goAfterCalibrate} disabled={!calibration}
            title={calibration ? '' : '바닥면 보정을 먼저 완료하세요'}>
            {hasML && !analyzed ? '다음 · 선수 분석 →' : '완료 · 에디터로 →'}
          </button>
        </header>
        <div className="calibrate-body">
          <aside className="calibrate-side">{courtPanel}</aside>
          <main className="calibrate-main">{videoStage}</main>
        </div>
      </div>
    );
  }

  if (view === 'analyze') {
    const pct = Math.round((analyzing?.pct ?? 0) * 100);
    const running = !!analyzing && !analyzing.error;
    return (
      <div className="calibrate-view">
        <header className="calibrate-head">
          <button className="btn ghost sm" onClick={backToProjects} disabled={running} title="프로젝트 목록으로">← 프로젝트</button>
          {wizardSteps('analyze')}
          <span className="calib-head-spacer" />
        </header>
        <div className="analyze-body">
          <div className="analyze-card">
            <div className="analyze-icon">🏃‍➡️</div>
            <h2>AI 선수 추적</h2>
            <p className="analyze-desc">
              영상에서 선수를 추적하는 <b>따라가기</b> 기능들을 사용할 수 있습니다.<br />
              영상 길이에 따라 처리에 수십 초~몇 분 걸립니다.
            </p>
            {!analyzing && (
              <div className="btn-row analyze-actions">
                <button className="btn primary" onClick={() => void runAnalysis()}>선수 분석 시작</button>
                <button className="btn" onClick={() => setView('editor')}>건너뛰기</button>
              </div>
            )}
            {running && (
              <div className="analyze-progress">
                <div className="analyze-bar"><div className="analyze-bar-fill" style={{ width: `${pct}%` }} /></div>
                <div className="analyze-pct">{pct}% · 분석 중…</div>
              </div>
            )}
            {analyzing?.error && (
              <div className="analyze-error">
                <div>분석 실패: {analyzing.error}</div>
                <div className="analyze-actions">
                  <button className="btn sm" onClick={() => setAnalyzing(null)}>다시 시도</button>
                  <button className="btn sm" onClick={() => setView('editor')}>건너뛰기</button>
                </div>
              </div>
            )}
            <div className="analyze-note">나중에 에디터 상단 <b>선수 분석</b>에서 다시 실행할 수 있습니다.</div>
          </div>
        </div>
      </div>
    );
  }

  const effectPanel = (section: 'tiles' | 'detail') => (
    <EffectPanel
      section={section}
      hasCalibration={!!calibration}
      players={players}
      onFollow={followPlayer}
      followedIds={followedIds}
      onToggleSpotlight={toggleSpotlight}
      spotlightIds={spotlightIds}
      colors={PLAYER_COLORS}
      hasFragments={!!fragments}
      anchorCount={playerAnchors.length}
      onStartPlayerCalib={startPlayerCalibration}
      onFinishPlayerCalib={finishPlayerCalibration}
      onCancelPlayerCalib={cancelPlayerCalibration}
      onGoAnalyze={hasML ? () => setView('analyze') : undefined}
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
      selectedOverlay={selectedOverlay}
      onPatchOverlay={patchOverlay}
      onCreate={startFeature}
      onFinishDraft={finishDraft}
      onCancelDraft={cancelDraft}
    />
  );

  return (
    <div className={`editor ${activeTab === 'effect' ? 'has-inspector' : ''}`}>
      <Rail active={activeTab} onSelect={setActiveTab} />

      <section className="left-panel">
        {activeTab === 'effect' && effectPanel('tiles')}
        {activeTab === 'narrative' && <NarrativePanel />}
      </section>

      <main className="center">
        <div className="center-head">
          <div className="center-head-l">
            <button className="btn ghost sm back-projects" onClick={backToProjects} title="프로젝트 목록으로 (자동 저장됨)">← 프로젝트</button>
            <span className="center-title">{projectName || videoName}</span>
          </div>
          <div className="center-head-r">
            <SettingsDropdown
              onRecalibrate={() => setView('calibrate')}
              onReanalyze={hasML ? () => setView('analyze') : undefined}
              analyzed={analyzed}
            />
            <ExportDropdown videoName={videoName} />
          </div>
        </div>

        {videoStage}

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

      {activeTab === 'effect' && (
        <aside className="right-panel">{effectPanel('detail')}</aside>
      )}
    </div>
  );
}
