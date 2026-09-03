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
import { screenshotCanvas, canvasToBlob, downloadBlob, recordCompositeWebM } from './lib/exportMedia';
import type { Project } from './lib/projects';
import { getPerspectiveTransform, invert3x3, projectCourtPoint, unprojectToCourt } from './geometry/homography';
import type { Pt } from './geometry/homography';
import { COURT_CORNERS } from './geometry/court';
import { courtLineDef, fitImageLine, homographyFromLines, familiesCovered } from './geometry/lineCalib';
import { PLAYER_COLORS, playerColor, hitTestFragment, assignFragments } from './geometry/tracking';
import { defaultSide } from './lib/pose';
import { singleClip, totalDuration, clipAt, srcAt } from './lib/clips';
import type { Clip } from './lib/clips';
import type {
  CircleParams, CourtCalibration, DrawnLine, FeatureId, FragmentData, Fragments, GroundHalo, Mode, Overlay,
  PathParams, PlayerAnchor, Players, PoseData, RailTab, TextParams, TrackingData, ZoneParams, ZoomParams,
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
      analyzePose: (video: ArrayBuffer, options?: { step?: number }) => Promise<{
        pose: PoseData;
        stats?: { playerCount: number; provider: string; framesProcessed: number };
      }>;
      onPoseProgress: (cb: (p: number) => void) => () => void;
    };
    // Export bridge exposed by the Electron preload (absent on the web → download fallback).
    exportApi?: {
      savePng: (buf: ArrayBuffer, suggestedName: string) => Promise<string | null>;
      saveVideo: (webm: ArrayBuffer, suggestedName: string, format: 'mp4' | 'webm') => Promise<string | null>;
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
    case 'pose': return 'pose';
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
  const stageRef = useRef<{ toCanvas: (c?: { pixelRatio?: number }) => HTMLCanvasElement } | null>(null);
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
  const [clips, setClips] = useState<Clip[]>([]); // base-video EDL; empty until video duration is known (→ single identity clip)
  const clipsRef = useRef<Clip[]>([]); clipsRef.current = clips; // read by the rAF loop without re-binding
  const activeClipRef = useRef<string | null>(null); // clip currently playing (disambiguates duplicated source ranges)
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
  const [circleParams, setCircleParams] = useState<CircleParams>({ radiusMeters: 0.8, color: '#E4EF3D', opacity: 0.2, dashed: false, drawOn: false, drawSec: 1.2, drawDelay: 0, drawEase: 'linear', drawReverse: false, drawLoop: false });
  // Per-player follow-circle style (color + solid/dashed). Transient: on reload it
  // re-derives from each player's existing circle overlay (which persists its own color/dash).
  const [playerStyles, setPlayerStyles] = useState<Record<string, { color: string; dashed: boolean }>>({});
  const [zoneParams, setZoneParams] = useState<ZoneParams>({ color: '#17335F', opacity: 0.18, fillStyle: 'solid', dashed: false, strokeWidth: 4 });
  const [zoomParams, setZoomParams] = useState<ZoomParams>({ scale: 2.2 });
  const [pathParams, setPathParams] = useState<PathParams>({ shape: 'court-line', height: 0.4, color: FEATURE_COLORS.path, dashed: false, drawOn: false, drawSec: 1.2, drawDelay: 0, drawEase: 'linear', drawReverse: false, drawLoop: false });
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
  const [loopRegion, setLoopRegion] = useState<{ start: number; end: number } | null>(null); // A-B repeat band
  const loopRef = useRef<{ start: number; end: number } | null>(null);
  loopRef.current = loopRegion; // read by the rAF loop without re-binding it

  // tracking (players.json auto-4, and fragments.json for user-anchored re-ID)
  const [players, setPlayers] = useState<Players | null>(null);
  const [fragments, setFragments] = useState<Fragments | null>(null);
  const [trackFps, setTrackFps] = useState(30);
  const [analyzed, setAnalyzed] = useState(false); // 선수 위치 분석 has been run
  const [analyzing, setAnalyzing] = useState<{ pct: number; error?: string } | null>(null);
  const [poseData, setPoseData] = useState<PoseData | null>(null); // 자세 분석 keypoint cache
  const [poseAnalyzed, setPoseAnalyzed] = useState(false);
  const [poseAnalyzing, setPoseAnalyzing] = useState<{ pct: number; error?: string } | null>(null);
  const [analyzeSkip, setAnalyzeSkip] = useState<{ pos: boolean; pose: boolean }>({ pos: false, pose: false });
  const hasML = typeof window !== 'undefined' && !!window.ml; // Electron desktop build only
  const [playerAnchors, setPlayerAnchors] = useState<PlayerAnchor[]>([]);
  // Video's source currentTime → TIMELINE time, via the clip currently playing.
  // Identity EDL (one clip at 0) → returns v.currentTime unchanged.
  const timelineNow = (v: HTMLVideoElement): number => {
    const cs = clipsRef.current;
    if (!cs.length) return v.currentTime;
    const active = cs.find((c) => c.id === activeClipRef.current) ?? cs[0];
    activeClipRef.current = active.id;
    return active.timelineStart + (v.currentTime - active.srcStart);
  };
  const timelineTotal = () => { const cs = clipsRef.current; return cs.length ? totalDuration(cs) : (videoRef.current?.duration || dur || 0); };

  // Load a project's player-tracking into state: prefer its own analysis (in
  // IndexedDB); for the bundled sample (no uploaded video) fall back to the
  // shipped court.mp4 JSON; otherwise leave empty (needs analysis).
  const loadTracking = async (p: Project) => {
    // Position and pose share one IndexedDB 'analysis' record; load whichever exists.
    if (p.analyzed || p.poseAnalyzed) {
      const a = await loadAnalysis(p.id);
      if (a) {
        setFragments(a.fragments ?? null); setPlayers(a.players ?? null);
        setPoseData(a.pose ?? null); setTrackFps(a.fps || 30);
        if (a.fragments || a.players) return; // position present → done
      }
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
    if (!p.poseAnalyzed) { setFragments(null); setPlayers(null); setTrackFps(30); }
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
    setClips(p.clips ?? []); // filled from video duration on metadata load if empty
    activeClipRef.current = null;
    seedIdCounter(p.overlays ?? []);
    setPast([]); setFuture([]);
    setPlayerAnchors(p.playerAnchors ?? []);
    setPlayerStyles({});
    setSelectedOverlayId(null);
    setDraftCalib([]); setDraftZone([]); setPathDraft(null); setDrawnLines([]); setLineDraft([]); setActiveLineId(null);
    setMode('idle');
    setActiveTab('effect');
    setProjectId(p.id); setProjectName(p.name);
    setAnalyzed(!!p.analyzed); setAnalyzing(null);
    setPoseAnalyzed(!!p.poseAnalyzed); setPoseAnalyzing(null); setPoseData(null);
    setAnalyzeSkip({ pos: false, pose: false });
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
  // Position and pose share one analysis record; merge so running one keeps the other.
  const persistAnalysis = async (patch: { fps?: number; fragments?: Fragments | null; players?: Players | null; pose?: PoseData | null }) => {
    if (!projectId) return;
    const prev = (await loadAnalysis(projectId)) ?? { fps: trackFps };
    await saveAnalysis(projectId, {
      fps: patch.fps ?? prev.fps ?? trackFps,
      fragments: (patch.fragments ?? prev.fragments) ?? undefined,
      players: (patch.players ?? prev.players) ?? undefined,
      pose: (patch.pose ?? prev.pose) ?? undefined,
    });
  };
  const runAnalysis = async () => {
    if (!window.ml || !projectId) return;
    setAnalyzing({ pct: 0 });
    const off = window.ml.onProgress((p) => setAnalyzing({ pct: p }));
    try {
      const bytes = await currentVideoBytes();
      if (!bytes) throw new Error('영상을 불러올 수 없습니다');
      const res = await window.ml.analyze(bytes, { step: 3 });
      const fps = res.fragments.fps;
      await persistAnalysis({ fps, fragments: res.fragments.tracks, players: res.players.players });
      setFragments(res.fragments.tracks); setPlayers(res.players.players); setTrackFps(fps);
      setAnalyzed(true); setAnalyzing(null);
    } catch (e) {
      setAnalyzing({ pct: 0, error: e instanceof Error ? e.message : String(e) });
    } finally { off(); }
  };
  const runPoseAnalysis = async () => {
    if (!window.ml?.analyzePose || !projectId) return;
    setPoseAnalyzing({ pct: 0 });
    const off = window.ml.onPoseProgress((p) => setPoseAnalyzing({ pct: p }));
    try {
      const bytes = await currentVideoBytes();
      if (!bytes) throw new Error('영상을 불러올 수 없습니다');
      const res = await window.ml.analyzePose(bytes, { step: 3 });
      await persistAnalysis({ fps: res.pose.fps, pose: res.pose });
      setPoseData(res.pose); setPoseAnalyzed(true); setPoseAnalyzing(null);
    } catch (e) {
      setPoseAnalyzing({ pct: 0, error: e instanceof Error ? e.message : String(e) });
    } finally { off(); }
  };
  // after court calibration → analysis step (desktop, first time), else the editor
  const goAfterCalibrate = () => {
    captureThumb();
    setView(hasML && !analyzed && !poseAnalyzed ? 'analyze' : 'editor');
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
        corners: calibration?.imagePoints ?? null, calibMethod, overlays, clips, playerAnchors,
        thumbnail: thumbnail ?? undefined, analyzed, poseAnalyzed, trackFps,
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, projectId, projectName, videoName, videoKey, calibration, calibMethod, overlays, clips, playerAnchors, thumbnail, analyzed, poseAnalyzed, trackFps]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCur(timelineNow(v));
    const onMeta = () => setDur(v.duration || 0);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    if (v.readyState >= 1) { onMeta(); onTime(); } // cached video: metadata already loaded before listener
    setPlaying(!v.paused); // re-sync toolbar/rAF state to this (possibly remounted) element — a view switch remounts the video paused
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
    // `view` re-binds after the video element remounts on entering the editor.
  }, [src, view]);

  // Seed the base-video EDL with a single identity clip once the duration is known
  // (a project with no saved clips). timeline time == source time until edited.
  useEffect(() => {
    if (dur > 0 && clips.length === 0) setClips(singleClip(dur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dur]);

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
      if (v) {
        const cs = clipsRef.current;
        let active = cs.find((c) => c.id === activeClipRef.current) ?? cs[0] ?? null;
        // reached the end of the active clip's source range → jump to the next clip (only when edited)
        if (active && cs.length > 1 && v.currentTime >= active.srcEnd - 0.03) {
          const idx = cs.findIndex((c) => c.id === active!.id);
          const next = cs[idx + 1];
          if (next) { active = next; activeClipRef.current = next.id; v.currentTime = next.srcStart; }
        }
        const T = active ? active.timelineStart + (v.currentTime - active.srcStart) : v.currentTime;
        const lr = loopRef.current; // A-B repeat (timeline time): jump back to the region start
        if (lr && T >= lr.end - 0.02 && lr.end > lr.start) seek(lr.start);
        else setCur(T);
      }
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

  // seek to a TIMELINE time: pick the clip under it, set the video to the mapped
  // source time, and remember it as the active clip. Identity EDL → v.currentTime = t.
  const seek = (t: number) => {
    const v = videoRef.current;
    const cs = clipsRef.current;
    if (cs.length) {
      const c = clipAt(cs, t);
      if (c) activeClipRef.current = c.id;
      if (v) v.currentTime = srcAt(cs, t);
    } else if (v) {
      v.currentTime = t;
    }
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

  // Total length of the timeline (sum of clip durations). Identity EDL → == video duration.
  const timelineDur = clips.length ? totalDuration(clips) : dur;

  // New effects land at the playhead with a default duration (video-editor convention),
  // instead of spanning the whole clip and piling up on top of each other.
  const spanAtPlayhead = (len = DEFAULT_LEN) => {
    const total = timelineDur > 0 ? timelineDur : cur + len;
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
    setDraftCalib([]); // committed → the corners now live in calibration.imagePoints; clear the draft so it never leaks into the editor
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
      mutate((o) => [...o, { id, type: 'coverage-zone', name: nextName(o, 'coverage-zone', 'Zone'), visible: true, ...spanAtPlayhead(), points: pts, color: zoneParams.color, opacity: zoneParams.opacity, fillStyle: zoneParams.fillStyle, dashed: zoneParams.dashed, strokeWidth: zoneParams.strokeWidth }]);
      setSelectedOverlayId(id);
    }
    setDraftZone([]);
    setMode('idle');
  };
  // Live-edit a placed path (shape/height/points) — no history churn per slider tick.
  const updatePath = (id: string, patch: Partial<{ shape: 'line' | 'arc'; height: number; dashed: boolean; color: string; points: { x: number; y: number }[]; drawOn: boolean; drawSec: number; drawDelay: number; drawEase: 'linear' | 'inout'; drawReverse: boolean; drawLoop: boolean }>) =>
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
  // Resolve a player's follow-circle style: an explicit per-player override wins,
  // else the style of an existing circle for that player, else the palette color.
  const playerStyleFor = (playerId: string): { color: string; dashed: boolean } => {
    if (playerStyles[playerId]) return playerStyles[playerId];
    const existing = overlays.find(
      (o): o is GroundHalo => o.type === 'ground-halo' && o.trackId === playerId,
    );
    if (existing) return { color: existing.color ?? playerColor(playerId) ?? circleParams.color, dashed: !!existing.dashed };
    return { color: playerColor(playerId) ?? circleParams.color, dashed: false };
  };
  // Set a player's style: remember it for future circles AND update this player's existing ones.
  const setPlayerStyleFor = (playerId: string, patch: Partial<{ color: string; dashed: boolean }>) => {
    setPlayerStyles((s) => ({ ...s, [playerId]: { ...playerStyleFor(playerId), ...patch } }));
    mutate((o) => o.map((x) => (x.type === 'ground-halo' && x.trackId === playerId ? { ...x, ...patch } : x)));
  };

  const followPlayer = (playerId: string) => {
    if (!calibration || !players) return;
    const pts = players[playerId];
    if (!pts || pts.length === 0) return;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const span = followSpan(t0, t1);
    const st = playerStyleFor(playerId);
    mutate((o) => [...o, {
      id: uid('halo'), type: 'ground-halo', name: `Player ${playerId}`, visible: true,
      ...span, courtX: 0, courtY: 0,
      radiusMeters: circleParams.radiusMeters, color: st.color, opacity: circleParams.opacity, dashed: st.dashed,
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

  // Add a pose/form overlay for a player (like follow-circle: each click adds one).
  // Sourced from the pose cache; span = the player's tracked span; angles default to all.
  const addPose = (playerId: string) => {
    if (!poseData) return;
    const pts = poseData.players[playerId];
    if (!pts || pts.length === 0) return;
    const span = followSpan(pts[0].t, pts[pts.length - 1].t);
    const id = uid('pose');
    mutate((o) => [...o, {
      id, type: 'pose', name: `폼 P${playerId}`, visible: true, ...span,
      trackId: playerId, color: playerColor(playerId) ?? '#E4EF3D',
      skeleton: true, angles: ['elbow', 'knee', 'rotation', 'trunk'], side: defaultSide(pts),
    }]);
    setSelectedOverlayId(id);
    if (cur < span.startTime || cur > span.endTime) seek(span.startTime);
  };
  const posedIds = new Set(
    overlays.filter((o) => o.type === 'pose').map((o) => (o as { trackId: string }).trackId),
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
          drawOn: pathParams.drawOn, drawSec: pathParams.drawSec, drawDelay: pathParams.drawDelay,
          drawEase: pathParams.drawEase, drawReverse: pathParams.drawReverse, drawLoop: pathParams.drawLoop,
        }]);
        setSelectedOverlayId(id);
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
      mutate((o) => [...o, { id, type: 'ground-halo', name: nextName(o, 'ground-halo', 'Circle'), visible: true, ...spanAtPlayhead(), courtX: court.x, courtY: court.y, radiusMeters: circleParams.radiusMeters, color: circleParams.color, opacity: circleParams.opacity, dashed: circleParams.dashed, drawOn: circleParams.drawOn, drawSec: circleParams.drawSec, drawDelay: circleParams.drawDelay, drawEase: circleParams.drawEase, drawReverse: circleParams.drawReverse, drawLoop: circleParams.drawLoop }]);
      setSelectedOverlayId(id); setMode('idle'); // select the new effect so it's immediately editable
    } else if (mode === 'placing-marker') {
      const id = uid('marker');
      mutate((o) => [...o, { id, type: 'marker', name: nextName(o, 'marker', 'Marker'), visible: true, ...spanAtPlayhead(), ...cxy, color: FEATURE_COLORS.marker }]);
      setSelectedOverlayId(id); setMode('idle');
    } else if (mode === 'placing-text') {
      const id = uid('text');
      const text = textDraft.trim() || '텍스트';
      mutate((o) => [...o, {
        id, type: 'text', name: nextName(o, 'text', 'Text'), visible: true, ...spanAtPlayhead(),
        ...cxy, text, boxW: 180, boxH: 52,
        fontSize: textParams.fontSize, fontFamily: textParams.fontFamily, bold: textParams.bold, align: textParams.align,
        color: textParams.color, bg: textParams.bg, bgColor: textParams.bgColor, bgOpacity: textParams.bgOpacity,
      }]);
      setSelectedOverlayId(id); setMode('idle');
    } else if (mode === 'placing-zoom') {
      const id = uid('zoom');
      mutate((o) => [...o, { id, type: 'zoom-in', name: nextName(o, 'zoom-in', 'Zoom'), visible: true, ...spanAtPlayhead(), ...cxy, scale: zoomParams.scale }]);
      setSelectedOverlayId(id); setMode('idle');
    } else if (mode === 'drawing-zone') {
      setDraftZone((z) => [...z, cxy]);
    } else if (mode === 'drawing-connector') {
      if (draftZone.length >= 1) {
        const p0 = draftZone[0];
        const id = uid('conn');
        mutate((o) => [...o, { id, type: 'connector', name: nextName(o, 'connector', 'Connector'), visible: true, ...spanAtPlayhead(), points: [p0, cxy], color: FEATURE_COLORS.connector }]);
        setSelectedOverlayId(id); setDraftZone([]); setMode('idle');
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
        setSelectedOverlayId(id); setDraftZone([]); setMode('idle');
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
      if (src.type === 'spotlight' || src.type === 'speed' || src.type === 'pose') return [...o, { ...src, id: newId, name }];
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

  // A-B repeat: click adds a loop band at the playhead (drag its edges on the timeline); click again clears it.
  const toggleLoop = () => {
    if (loopRegion) { setLoopRegion(null); return; }
    const total = timelineDur > 0 ? timelineDur : cur + 3;
    const start = clampT(cur, 0, Math.max(0, total - 0.5));
    const end = clampT(start + 3, start + 0.5, total);
    setLoopRegion({ start, end });
  };

  // ── export (screenshot / video) ─────────────────────────────────────────
  const exportBaseName = () => (projectName || videoName || 'telestration').replace(/\.[^.]+$/, '');
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  const exportScreenshot = async () => {
    const v = videoRef.current;
    if (!v) return;
    setSelectedOverlayId(null); // drop selection so edit-handles aren't baked in
    await nextFrame();
    const canvas = screenshotCanvas(v, stageRef.current);
    const blob = await canvasToBlob(canvas, 'image/png');
    const name = `${exportBaseName()}_${Math.round(v.currentTime)}s.png`;
    if (window.exportApi?.savePng) await window.exportApi.savePng(await blob.arrayBuffer(), name);
    else downloadBlob(blob, name);
  };

  const exportVideo = async (onProgress: (t: number, dur: number) => void, height = 720, format: 'mp4' | 'webm' = 'mp4') => {
    const v = videoRef.current;
    if (!v) return;
    const wasPlaying = !v.paused;
    setSelectedOverlayId(null);
    await nextFrame();
    const webm = await recordCompositeWebM(v, onProgress, height); // MediaRecorder always yields WebM
    const buf = await webm.arrayBuffer();
    const name = `${exportBaseName()}.${format}`;
    if (window.exportApi?.saveVideo) await window.exportApi.saveVideo(buf, name, format); // Electron: WebM (write) or MP4 (ffmpeg)
    else downloadBlob(webm, `${exportBaseName()}.webm`); // web: no ffmpeg → WebM only
    if (wasPlaying) void v.play().catch(() => {});
  };

  // Esc leaves interactive mode; Enter finishes a zone/line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        setMode('idle');
        setSelectedOverlayId(null); // deselect → hides the selection drag-handles
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
        if (v) seek(Math.max(0, timelineNow(v) - (e.shiftKey ? 1 : FRAME)));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (v) seek(Math.min(timelineTotal(), timelineNow(v) + (e.shiftKey ? 1 : FRAME)));
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
    // idle + a selected editable overlay → drag-handles are showing
    if (mode === 'idle' && selectedOverlayId) {
      const o = overlays.find((x) => x.id === selectedOverlayId);
      const editable = o && (o.type === 'path' || o.type === 'text' || o.type === 'marker'
        || o.type === 'coverage-zone' || o.type === 'connector' || o.type === 'sector'
        || (o.type === 'ground-halo' && !o.trackId));
      if (editable) return '핸들을 드래그해 편집 · Esc로 선택 해제';
    }
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
      case 'drawing-connector': return `Connector · ${n}/2점 클릭 · Esc 취소`;
      case 'drawing-sector': return `부채꼴 · ${draftZone.length < 1 ? '중심 클릭' : '방향·거리 점 클릭'} (${draftZone.length}/2) · Esc 취소`;
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
      poseData={poseData}
      draftCalib={draftCalib} draftZone={draftZone} pathDraft={pathDraft}
      onUpdatePathPoints={(id, points) => updatePath(id, { points })} onUpdateText={updateText} onUpdateSector={updateSector}
      onPatchOverlay={patchOverlay}
      showCalibration={view === 'calibrate'}
      drawnLines={drawnLines} lineDraft={lineDraft} activeLineId={activeLineId} onStageClick={onStageClick} onDimensions={(w, h) => setDims({ w, h })}
      stageRef={stageRef}
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
    const anyRunning = (!!analyzing && !analyzing.error) || (!!poseAnalyzing && !poseAnalyzing.error);
    type CardArgs = {
      icon: string; title: string; desc: string; unlocks: string;
      done: boolean; skipped: boolean; state: { pct: number; error?: string } | null;
      onStart: () => void; onSkip: () => void; onUnskip: () => void; onRerun: () => void;
    };
    const analyzeCard = (a: CardArgs) => {
      const running = !!a.state && !a.state.error;
      const pct = Math.round((a.state?.pct ?? 0) * 100);
      return (
        <div className={`analyze-card ${a.done ? 'is-done' : ''}`}>
          <div className="analyze-icon">{a.icon}</div>
          <h2>{a.title}</h2>
          <p className="analyze-desc">{a.desc}<br /><span className="analyze-unlocks">{a.unlocks}</span></p>
          {a.done ? (
            <div className="analyze-donerow"><span className="analyze-badge">✓ 완료</span>
              <button className="btn subtle sm" disabled={anyRunning} onClick={a.onRerun}>다시 분석</button></div>
          ) : running ? (
            <div className="analyze-progress">
              <div className="analyze-bar"><div className="analyze-bar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="analyze-pct">{pct}% · 분석 중…</div>
            </div>
          ) : a.state?.error ? (
            <div className="analyze-error">
              <div>분석 실패: {a.state.error}</div>
              <div className="analyze-actions"><button className="btn sm" disabled={anyRunning} onClick={a.onStart}>다시 시도</button></div>
            </div>
          ) : a.skipped ? (
            <div className="analyze-donerow"><span className="analyze-skip">건너뜀</span>
              <button className="btn subtle sm" disabled={anyRunning} onClick={a.onUnskip}>실행</button></div>
          ) : (
            <div className="btn-row analyze-actions">
              <button className="btn primary" disabled={anyRunning} onClick={a.onStart}>시작</button>
              <button className="btn" disabled={anyRunning} onClick={a.onSkip}>건너뛰기</button>
            </div>
          )}
        </div>
      );
    };
    return (
      <div className="calibrate-view">
        <header className="calibrate-head">
          <button className="btn ghost sm" onClick={backToProjects} disabled={anyRunning} title="프로젝트 목록으로">← 프로젝트</button>
          {wizardSteps('analyze')}
          <button className="btn primary sm" onClick={() => setView('editor')} disabled={anyRunning}
            title="선택한 분석을 마치고 편집기로 이동">에디터로 →</button>
        </header>
        <div className="analyze-body analyze-two">
          {analyzeCard({
            icon: '🏃‍➡️', title: '선수 위치 분석',
            desc: '영상에서 선수의 위치·이동 경로를 추적합니다.',
            unlocks: '→ 따라가기 원 · 스포트라이트',
            done: analyzed, skipped: analyzeSkip.pos, state: analyzing,
            onStart: () => void runAnalysis(),
            onSkip: () => setAnalyzeSkip((s) => ({ ...s, pos: true })),
            onUnskip: () => setAnalyzeSkip((s) => ({ ...s, pos: false })),
            onRerun: () => { setAnalyzed(false); setAnalyzing(null); },
          })}
          {analyzeCard({
            icon: '🤸', title: '자세 분석',
            desc: '선수의 골격·관절 각도를 프레임별로 추출합니다.',
            unlocks: '→ 폼 추적 (골격 + 각도)',
            done: poseAnalyzed, skipped: analyzeSkip.pose, state: poseAnalyzing,
            onStart: () => void runPoseAnalysis(),
            onSkip: () => setAnalyzeSkip((s) => ({ ...s, pose: true })),
            onUnskip: () => setAnalyzeSkip((s) => ({ ...s, pose: false })),
            onRerun: () => { setPoseAnalyzed(false); setPoseAnalyzing(null); setPoseData(null); },
          })}
        </div>
        <div className="analyze-foot">각 분석은 독립적이에요 — 둘 다, 하나만, 또는 건너뛸 수 있고 나중에 에디터에서 다시 실행할 수 있습니다.</div>
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
      playerStyleFor={playerStyleFor}
      onSetPlayerStyle={setPlayerStyleFor}
      onToggleSpotlight={toggleSpotlight}
      spotlightIds={spotlightIds}
      poseReady={!!poseData}
      poseAnalyzed={poseAnalyzed}
      posePlayerIds={poseData ? Object.keys(poseData.players) : []}
      onAddPose={addPose}
      posedIds={posedIds}
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
      textDraft={textDraft}
      setTextDraft={setTextDraft}
      textParams={textParams}
      setTextParams={setTextParams}
      selectedText={selectedOverlay?.type === 'text' ? selectedOverlay : null}
      onUpdateText={updateText}
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
            <ExportDropdown onScreenshot={exportScreenshot} onExportVideo={exportVideo} />
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
          dur={timelineDur}
          speed={speed}
          onSpeed={setSpeed}
          zoom={tlZoom}
          onZoom={setTlZoom}
          snap={snap}
          onToggleSnap={() => setSnap((s) => !s)}
          loopOn={!!loopRegion}
          onToggleLoop={toggleLoop}
        />

        <Timeline
          overlays={overlays}
          duration={timelineDur}
          currentTime={cur}
          selectedId={selectedOverlayId}
          videoName={videoName}
          speed={speed}
          zoom={tlZoom}
          snap={snap}
          loop={loopRegion}
          onSetLoop={setLoopRegion}
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
