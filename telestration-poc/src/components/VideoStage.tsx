import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { Stage, Layer, Circle, Rect } from 'react-konva';
import { useElementSize } from '../hooks/useElementSize';
import { projectCourtPoint, unprojectToCourt, circleInCourt } from '../geometry/homography';
import type { Pt } from '../geometry/homography';
import { videoToDisplay, displayToVideo } from '../geometry/coords';
import type { ViewTransform } from '../geometry/coords';
import { footAt } from '../geometry/tracking';
import { drawOnProgress } from '../lib/anim';
import { GroundHalo } from './overlays/GroundHalo';
import { CoverageZone } from './overlays/CoverageZone';
import { Marker } from './overlays/Marker';
import { TextLabel } from './overlays/TextLabel';
import { PathArrow } from './overlays/PathArrow';
import { Connector } from './overlays/Connector';
import { Sector } from './overlays/Sector';
import { FreehandLine } from './overlays/FreehandLine';
import { SpotlightDim } from './overlays/SpotlightDim';
import { PoseFigure } from './overlays/PoseFigure';
import { poseAt } from '../lib/pose';
import { CalibrationPoints } from './overlays/CalibrationPoints';
import { CalibLines } from './overlays/CalibLines';
import { CalibBoxes } from './overlays/CalibBoxes';
import type { CourtCalibration, Overlay, Mode, DrawnLine, Players, Fragments, PlayerAnchor, PoseData, Spotlight, ZoomIn, FreehandStroke, PipOverlay } from '../types';

// hit-test helpers (display px)
const pointInPoly = (px: number, py: number, poly: number[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

type Props = {
  src: string;
  videoRef: RefObject<HTMLVideoElement>;
  insertVideoRef?: RefObject<HTMLVideoElement>; // separate layer for inserted footage
  insertActive?: boolean;                        // an inserted clip is showing
  pipVideoRef?: RefObject<HTMLVideoElement>;     // floating Picture-in-Picture layer
  onMovePip?: (id: string, x: number, y: number) => void; // drag the PiP window (fractions of frame)
  calibration: CourtCalibration | null;
  overlays: Overlay[];
  mode: Mode;
  currentTime: number; // TIMELINE seconds — overlays render only within their [start,end]
  sourceTime: number;  // SOURCE (video) seconds for the clip under the playhead — used for tracking/pose lookups (identity EDL → == currentTime)
  gap?: boolean;       // playhead is inside a black gap clip → cover the video with black
  selectedId: string | null; // timeline-selected overlay → highlighted on the canvas
  onSelectOverlay: (id: string | null) => void; // click an overlay on the canvas → select it
  players: Players | null; // tracked player trajectories (foot points in video px)
  poseData: PoseData | null; // per-player keypoint sequences (video px) for pose overlays
  fragments: Fragments | null; // raw fragments (for player-calibration hit-testing)
  playerAnchors: PlayerAnchor[]; // clicked player anchors during player-calibration
  fps: number;
  draftCalib: Pt[]; // video px
  draftZone: { courtX: number; courtY: number }[]; // court meters
  pathDraft: Pt | null; // path drawing: first click (video px)
  onUpdatePathPoints: (id: string, points: { x: number; y: number }[]) => void; // endpoint drag
  onUpdateText: (id: string, patch: Partial<Extract<Overlay, { type: 'text' }>>) => void; // text box move/resize
  onUpdateSector: (id: string, patch: Partial<Extract<Overlay, { type: 'sector' }>>) => void; // sector handle drag
  onPatchOverlay: (id: string, patch: object) => void; // generic move/resize for marker/halo/zone/connector handles
  showCalibration?: boolean; // draw the committed court corners (calibrate view only)
  drawnLines: DrawnLine[]; // line-calibration: committed lines (video px)
  lineDraft: Pt[]; // line-calibration: active line points (video px)
  activeLineId: string | null;
  onStageClick: (videoPt: Pt) => void;
  onFreehandDone: (points: { x: number; y: number }[]) => void; // a finished pen stroke (video px)
  onDimensions: (w: number, h: number) => void;
  stageRef?: RefObject<any>; // Konva Stage → crisp overlay capture for export (stage.toCanvas)
};

export function VideoStage({
  src,
  videoRef,
  insertVideoRef,
  insertActive,
  pipVideoRef,
  onMovePip,
  calibration,
  overlays,
  mode,
  currentTime,
  selectedId,
  onSelectOverlay,
  sourceTime,
  gap,
  players,
  poseData,
  fragments,
  playerAnchors,
  fps,
  draftCalib,
  draftZone,
  pathDraft,
  onUpdatePathPoints,
  onUpdateText,
  onUpdateSector,
  onPatchOverlay,
  showCalibration,
  drawnLines,
  lineDraft,
  activeLineId,
  onStageClick,
  onFreehandDone,
  onDimensions,
  stageRef,
}: Props) {
  const { ref: boxRef, size } = useElementSize<HTMLDivElement>();
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null); // konva-overlay div (stage container)
  const clickRef = useRef<{ fn: (pos: Pt) => string | null; mode: Mode; onSelect: (id: string | null) => void; w: number; h: number } | null>(null);
  // Mode at mouse-press time. A placement click flips mode→idle inside the same
  // click (placement runs before the capture-phase select handler), so the live
  // mode would read 'idle' and wrongly select the just-placed overlay. Gate the
  // click-select on the press-time mode instead.
  const downModeRef = useRef<Mode>('idle');
  // Timestamp of the last handle drag. A drag's trailing 'click' must not
  // deselect the overlay, so the capture click handler ignores clicks right after one.
  const dragGuardRef = useRef(0);

  // Any selected overlay is editable in place while idle — its drag handles show on
  // selection (no separate edit mode / button), so it's draggable the moment you
  // click it (Figma-like). Player effects (tracked halo / spotlight) follow the
  // player, and zoom/speed have no shape, so they get no handles.
  const isDragEditable = (o: Overlay): boolean => {
    switch (o.type) {
      case 'path': case 'text': case 'marker': case 'coverage-zone': case 'connector': case 'sector': return true;
      case 'ground-halo': return !o.trackId; // static circle only; a tracked one follows the player
      default: return false; // spotlight / zoom-in / speed
    }
  };
  const editTarget = mode === 'idle' && selectedId
    ? overlays.find((o) => o.id === selectedId && isDragEditable(o))
    : undefined;
  const interactive = mode !== 'idle' || !!editTarget;

  // ①⇄② scale. Container aspect == video aspect, so this is a uniform scale and
  // the overlay stays pixel-aligned with the video content at any size.
  const view: ViewTransform | null =
    dims && size.width > 0 ? { scaleX: size.width / dims.w, scaleY: size.height / dims.h } : null;

  // court(③) -> video(②) -> display(①). Only defined when we have both H and a view.
  const project = (courtX: number, courtY: number): Pt =>
    videoToDisplay(projectCourtPoint(calibration!.homography, courtX, courtY), view!);
  const vToD = (p: Pt): Pt => videoToDisplay(p, view!);
  // path endpoints: court metres project onto the floor; screen px map flat.
  const toDisplaySpace = (space: 'court' | 'screen', x: number, y: number): Pt =>
    space === 'court' ? project(x, y) : vToD({ x, y });

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || !view) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const displayPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    onStageClick(displayToVideo(displayPt, view)); // hand App a VIDEO-space point
  };

  // ── freehand pen: collect a stroke on pointer down→move→up (video px) ────────
  const fhDrawing = useRef(false);
  const fhPtsRef = useRef<Pt[]>([]);
  const [fhDraft, setFhDraft] = useState<Pt[]>([]);
  const fhPointAt = (e: React.MouseEvent<HTMLDivElement>): Pt | null => {
    if (!view) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    return displayToVideo({ x: e.clientX - rect.left, y: e.clientY - rect.top }, view);
  };
  const onOverlayDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode === 'drawing-freehand') {
      const p = fhPointAt(e); if (!p) return;
      e.preventDefault(); fhDrawing.current = true; fhPtsRef.current = [p]; setFhDraft([p]);
      return;
    }
    handleClick(e); // placement/click behavior for every other mode
  };
  const onOverlayMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'drawing-freehand' || !fhDrawing.current) return;
    const p = fhPointAt(e); if (!p) return;
    const last = fhPtsRef.current[fhPtsRef.current.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return; // decimate tiny moves
    fhPtsRef.current = [...fhPtsRef.current, p];
    setFhDraft(fhPtsRef.current);
  };
  const onOverlayUp = () => {
    if (!fhDrawing.current) return;
    fhDrawing.current = false;
    const pts = fhPtsRef.current;
    fhPtsRef.current = []; setFhDraft([]);
    if (pts.length >= 2) onFreehandDone(pts);
  };

  // The stage keeps the video's real aspect ratio and is contained inside the .media
  // query-container: width = min(container width, container height × aspect), so it fits
  // BOTH dimensions (no letterbox, no overflow) and shrinks with the window.
  const aspect = dims ? `${dims.w} / ${dims.h}` : '16 / 9';
  const arNum = dims ? dims.w / dims.h : 16 / 9;

  // ── Zoom In ──────────────────────────────────────────────────────────────
  // While an active zoom's window contains currentTime (and we're not mid-edit),
  // punch-in the whole composited view (video + overlays together) about the zoom's
  // court point — or a tracked player's foot. Suppressed during interactive modes so
  // authoring stays full-frame and click→court mapping stays 1:1.
  const activeZoom: ZoomIn | null =
    mode === 'idle' && calibration && view
      ? [...overlays].reverse().find(
          (o): o is ZoomIn => o.type === 'zoom-in' && o.visible && currentTime >= o.startTime && currentTime <= o.endTime,
        ) ?? null
      : null;

  let zoomStyle: CSSProperties = { position: 'absolute', inset: 0, transformOrigin: '0 0', transition: 'transform 0.35s ease' };
  if (activeZoom && view && calibration) {
    let zx = activeZoom.courtX, zy = activeZoom.courtY;
    if (activeZoom.trackId && players) {
      const foot = footAt(players[activeZoom.trackId] ?? [], sourceTime);
      if (foot) { const c = unprojectToCourt(calibration.inverseHomography, foot[0], foot[1]); zx = c.x; zy = c.y; }
    }
    const sc = project(zx, zy);
    const cy = activeZoom.trackId ? sc.y - size.height * 0.12 : sc.y; // frame the torso, not the feet
    const s = activeZoom.scale;
    const W = size.width, H = size.height;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const tx = clamp(W / 2 - s * sc.x, W - s * W, 0); // keep scaled content covering the viewport (no gaps)
    const ty = clamp(H / 2 - s * cy, H - s * H, 0);
    zoomStyle = { ...zoomStyle, transform: `translate(${tx}px, ${ty}px) scale(${s})` };
  }

  // Selection feedback: a ring at the selected overlay's anchor (synced from the timeline).
  const selAnchor: Pt | null = (() => {
    if (!selectedId || !calibration || !view) return null;
    const o = overlays.find((x) => x.id === selectedId);
    if (!o || !o.visible || currentTime < o.startTime || currentTime > o.endTime) return null;
    const atFoot = (id: string): Pt | null => {
      const f = footAt(players?.[id] ?? [], sourceTime);
      if (!f) return null;
      const c = unprojectToCourt(calibration.inverseHomography, f[0], f[1]);
      return project(c.x, c.y);
    };
    switch (o.type) {
      case 'ground-halo': return o.trackId ? atFoot(o.trackId) : project(o.courtX, o.courtY);
      case 'marker': case 'zoom-in': return project(o.courtX, o.courtY);
      case 'text': { const tl = project(o.courtX, o.courtY); return { x: tl.x + o.boxW / 2, y: tl.y + o.boxH / 2 }; }
      case 'path': return o.points[0] ? toDisplaySpace(o.space, o.points[0].x, o.points[0].y) : null;
      case 'coverage-zone': case 'connector': return o.points[0] ? project(o.points[0].courtX, o.points[0].courtY) : null;
      case 'sector': { const r = (o.dir * Math.PI) / 180; return project(o.courtX + 0.5 * o.radiusM * Math.cos(r), o.courtY + 0.5 * o.radiusM * Math.sin(r)); } // ring at the fan's middle, not the apex
      case 'spotlight': return atFoot(o.trackId);
      case 'pose': {
        const s = poseData?.players[o.trackId];
        const fr = s ? poseAt(s, sourceTime) : null;
        if (!fr) return null;
        const lh = fr.pts[11], rh = fr.pts[12]; // mid-hip
        return vToD({ x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 });
      }
      default: return null;
    }
  })();

  // ── click an overlay on the canvas → select it (idle only) ────────────────
  // Geometric hit-test in display px (topmost overlay wins). Spotlight/Zoom have no
  // discrete shape → not selectable.
  const hitTest = (pos: Pt): string | null => {
    if (!calibration || !view) return null;
    const near = (a: Pt, r: number) => Math.hypot(pos.x - a.x, pos.y - a.y) < r;
    const visible = overlays.filter((o) => o.visible && currentTime >= o.startTime && currentTime <= o.endTime);
    for (let k = visible.length - 1; k >= 0; k--) {
      const o = visible[k];
      switch (o.type) {
        case 'marker': if (near(project(o.courtX, o.courtY), 22)) return o.id; break;
        case 'text': { const tl = project(o.courtX, o.courtY); if (pos.x >= tl.x && pos.x <= tl.x + o.boxW && pos.y >= tl.y && pos.y <= tl.y + o.boxH) return o.id; break; }
        case 'ground-halo': {
          let cx = o.courtX, cy = o.courtY;
          if (o.trackId && players) {
            const foot = footAt(players[o.trackId] ?? [], sourceTime);
            if (!foot) break;
            const c = unprojectToCourt(calibration.inverseHomography, foot[0], foot[1]);
            cx = c.x; cy = c.y;
          }
          const poly = circleInCourt(cx, cy, o.radiusMeters, 24).flatMap((p) => { const d = project(p.x, p.y); return [d.x, d.y]; });
          if (pointInPoly(pos.x, pos.y, poly) || near(project(cx, cy), 22)) return o.id;
          break;
        }
        case 'coverage-zone': {
          const poly = o.points.flatMap((p) => { const d = project(p.courtX, p.courtY); return [d.x, d.y]; });
          if (pointInPoly(pos.x, pos.y, poly)) return o.id;
          break;
        }
        case 'sector': {
          const a0 = ((o.dir - o.spread / 2) * Math.PI) / 180, a1 = ((o.dir + o.spread / 2) * Math.PI) / 180;
          const c = project(o.courtX, o.courtY);
          const poly = [c.x, c.y];
          for (let i = 0; i <= 24; i++) { const a = a0 + ((a1 - a0) * i) / 24; const d = project(o.courtX + o.radiusM * Math.cos(a), o.courtY + o.radiusM * Math.sin(a)); poly.push(d.x, d.y); }
          if (pointInPoly(pos.x, pos.y, poly)) return o.id;
          break;
        }
        case 'connector': {
          const a = project(o.points[0].courtX, o.points[0].courtY), b = project(o.points[1].courtX, o.points[1].courtY);
          if (distToSeg(pos.x, pos.y, a.x, a.y, b.x, b.y) < 12) return o.id;
          break;
        }
        case 'path': {
          const a = toDisplaySpace(o.space, o.points[0].x, o.points[0].y);
          const b = toDisplaySpace(o.space, o.points[1].x, o.points[1].y);
          let pts: Pt[] = [a, b];
          if (o.shape === 'arc' && Math.abs(o.height) > 0.001) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, chord = Math.hypot(b.x - a.x, b.y - a.y), cy = my - chord * o.height;
            pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16, u = 1 - t; pts.push({ x: u * u * a.x + 2 * u * t * mx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y }); }
          }
          for (let i = 0; i < pts.length - 1; i++) if (distToSeg(pos.x, pos.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < 12) return o.id;
          break;
        }
        case 'freehand': {
          const dpts = o.points.map((p) => vToD(p));
          const tol = Math.max(10, o.width + 6);
          for (let i = 0; i < dpts.length - 1; i++) if (distToSeg(pos.x, pos.y, dpts[i].x, dpts[i].y, dpts[i + 1].x, dpts[i + 1].y) < tol) return o.id;
          break;
        }
      }
    }
    return null;
  };
  clickRef.current = { fn: hitTest, mode, onSelect: onSelectOverlay, w: size.width, h: size.height };

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onDown = () => { downModeRef.current = clickRef.current?.mode ?? 'idle'; };
    const onClick = (e: MouseEvent) => {
      const s = clickRef.current;
      const ov = overlayRef.current;
      // Skip when this click began in a placement/drawing mode — that click just
      // placed an overlay (which set mode→idle); it must not also select it.
      if (!s || s.mode !== 'idle' || downModeRef.current !== 'idle' || !ov) return;
      if (Date.now() - dragGuardRef.current < 250) return; // swallow a drag's trailing click (keep selection)
      const rect = ov.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pos = { x: (e.clientX - rect.left) * (s.w / rect.width), y: (e.clientY - rect.top) * (s.h / rect.height) };
      if (pos.x < 0 || pos.y < 0 || pos.x > s.w || pos.y > s.h) return;
      const id = s.fn(pos);
      if (id) { e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault(); s.onSelect(id); }
      else s.onSelect(null); // empty → deselect (let the click reach the video)
    };
    box.addEventListener('mousedown', onDown, true);
    box.addEventListener('click', onClick, true); // capture: intercept before the video toggles play
    return () => { box.removeEventListener('mousedown', onDown, true); box.removeEventListener('click', onClick, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── PiP window: a floating video overlapping the main frame during its span ──
  const activePip = overlays.find((o): o is PipOverlay => o.type === 'pip' && o.visible && currentTime >= o.startTime && currentTime <= o.endTime) ?? null;
  const pipSelected = !!activePip && selectedId === activePip.id;
  const pipDrag = (e: React.MouseEvent) => {
    if (!activePip) return;
    e.preventDefault(); e.stopPropagation();
    const box = boxRef.current; if (!box) return;
    const rect = box.getBoundingClientRect();
    const offX = (e.clientX - rect.left) / rect.width - activePip.x;
    const offY = (e.clientY - rect.top) / rect.height - activePip.y;
    const id = activePip.id;
    const move = (ev: MouseEvent) => onMovePip?.(id, (ev.clientX - rect.left) / rect.width - offX, (ev.clientY - rect.top) / rect.height - offY);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div className="video-stage" ref={boxRef} style={{ aspectRatio: aspect, width: `min(100cqw, ${arNum} * 100cqh)` }}>
      <div className="zoom-content" style={zoomStyle}>
      <video
        ref={videoRef}
        className="video-el"
        src={src}
        playsInline
        // No native controls — playback is driven only by our own toolbar/timeline,
        // and a bare <video> ignores clicks, so clicking the frame never toggles play.
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDims({ w: v.videoWidth, h: v.videoHeight });
          onDimensions(v.videoWidth, v.videoHeight);
        }}
      />
      {/* inserted-footage layer: covers the main video (letterboxed) while an inserted clip plays */}
      <video ref={insertVideoRef} className="insert-video" playsInline hidden={!insertActive} />
      {gap && <div className="gap-black" />}

      {view && (
        <div
          className="konva-overlay"
          ref={overlayRef}
          onMouseDown={onOverlayDown}
          onMouseMove={onOverlayMove}
          onMouseUp={onOverlayUp}
          onMouseLeave={onOverlayUp}
          style={{
            pointerEvents: interactive ? 'auto' : 'none', // idle → native video controls stay usable
            cursor: mode !== 'idle' ? 'crosshair' : 'default', // placement uses crosshair; selection-edit uses default (handles show move)
          }}
        >
          <Stage ref={stageRef} width={size.width} height={size.height}
            onDragMove={() => { dragGuardRef.current = Date.now(); }}
            onDragEnd={() => { dragGuardRef.current = Date.now(); }}>
            <Layer listening={false}>
              {/* spotlight: dim the frame + reveal players (must be first so it only dims the video) */}
              {calibration && (() => {
                const spots = overlays.filter((s): s is Spotlight => s.type === 'spotlight' && s.visible && currentTime >= s.startTime && currentTime <= s.endTime);
                return spots.length > 0 ? (
                  <SpotlightDim spotlights={spots} players={players} inverseH={calibration.inverseHomography} currentTime={sourceTime} project={project} width={size.width} height={size.height} />
                ) : null;
              })()}


              {calibration &&
                overlays
                  .filter((o) => o.visible && currentTime >= o.startTime && currentTime <= o.endTime)
                  .map((o) => {
                    switch (o.type) {
                      case 'coverage-zone':
                        return <CoverageZone key={o.id} points={o.points} project={project} color={o.color} opacity={o.opacity}
                          fillStyle={o.fillStyle} dashed={o.dashed} strokeWidth={o.strokeWidth} />;
                      case 'sector':
                        return <Sector key={o.id} courtX={o.courtX} courtY={o.courtY} radiusM={o.radiusM} dir={o.dir} spread={o.spread} project={project} color={o.color} opacity={o.opacity}
                          drawProgress={drawOnProgress(o, currentTime)} drawReverse={o.drawReverse} />;
                      case 'marker':
                        return <Marker key={o.id} courtX={o.courtX} courtY={o.courtY} project={project} color={o.color} />;
                      case 'text':
                        return <TextLabel key={o.id} courtX={o.courtX} courtY={o.courtY} text={o.text} project={project} color={o.color}
                          fontSize={o.fontSize} fontFamily={o.fontFamily} bold={o.bold} align={o.align} boxW={o.boxW} boxH={o.boxH}
                          bg={o.bg} bgColor={o.bgColor} bgOpacity={o.bgOpacity} />;
                      case 'path':
                        return <PathArrow key={o.id} space={o.space} shape={o.shape} points={o.points} height={o.height} dashed={o.dashed} toDisplay={toDisplaySpace} color={o.color}
                          drawProgress={drawOnProgress(o, currentTime)} drawReverse={o.drawReverse} />;
                      case 'connector':
                        return <Connector key={o.id} points={o.points} project={project} color={o.color} />;
                      case 'spotlight':
                        return null; // rendered by SpotlightDim above
                      case 'pose': {
                        const samples = poseData?.players[o.trackId];
                        const frameTime = o.freeze != null ? o.freeze : sourceTime; // freeze pins a source time
                        const frame = samples ? poseAt(samples, frameTime) : null;
                        if (!frame) return null;
                        return <PoseFigure key={o.id} frame={frame} samples={samples} trailEndT={frameTime} toDisplay={vToD} color={o.color}
                          skeleton={o.skeleton} angles={o.angles} side={o.side} selected={selectedId === o.id}
                          strokeWidth={o.strokeWidth} opacity={o.opacity} showJoints={o.showJoints} jointSize={o.jointSize}
                          angleDisplay={o.angleDisplay} angleFontSize={o.angleFontSize} targets={o.targets}
                          trailJoint={o.trailJoint} trailSec={o.trailSec} />;
                      }
                      case 'zoom-in':
                        return null; // applied as a CSS transform on the whole stage
                      case 'speed':
                        return null; // playback-rate modifier, no canvas shape
                      case 'ground-halo': {
                        // a tracked halo derives its court position from the player's
                        // foot at the current time (foot → H⁻¹ → court meters).
                        let cx = o.courtX, cy = o.courtY;
                        if (o.trackId && players) {
                          const foot = footAt(players[o.trackId] ?? [], sourceTime);
                          if (!foot) return null;
                          const c = unprojectToCourt(calibration.inverseHomography, foot[0], foot[1]);
                          cx = c.x; cy = c.y;
                        }
                        return <GroundHalo key={o.id} courtX={cx} courtY={cy} radiusMeters={o.radiusMeters} project={project} color={o.color} opacity={o.opacity} dashed={o.dashed}
                          drawProgress={drawOnProgress(o, currentTime)} drawReverse={o.drawReverse} />;
                      }
                    }
                  })}

              {/* freehand pen strokes — screen-space, no calibration needed (only a view) */}
              {view && overlays
                .filter((o): o is FreehandStroke => o.type === 'freehand' && o.visible && currentTime >= o.startTime && currentTime <= o.endTime)
                .map((o) => <FreehandLine key={o.id} points={o.points} toDisplay={vToD} color={o.color} width={o.width} />)}
              {mode === 'drawing-freehand' && fhDraft.length >= 2 && (
                <FreehandLine points={fhDraft} toDisplay={vToD} color="#FFD400" width={4} />
              )}

              {/* selection ring — for selected overlays without drag handles (tracked halo / spotlight) */}
              {selAnchor && !editTarget && (
                <>
                  <Circle x={selAnchor.x} y={selAnchor.y} radius={26} stroke="#ffffff" strokeWidth={2} dash={[6, 5]} listening={false} shadowColor="#000" shadowBlur={4} shadowOpacity={0.6} />
                  <Circle x={selAnchor.x} y={selAnchor.y} radius={3.5} fill="#ffffff" listening={false} />
                </>
              )}

              {/* draft preview for zone / connector / sector */}
              {calibration && (mode === 'drawing-zone' || mode === 'drawing-connector' || mode === 'drawing-sector') && draftZone.length > 0 && (
                <>
                  {mode === 'drawing-zone' && <CoverageZone points={draftZone} project={project} closed={draftZone.length >= 3} />}
                  {mode === 'drawing-connector' && <Connector points={draftZone} project={project} />}
                  {draftZone.map((p, i) => { const d = project(p.courtX, p.courtY); return <Circle key={i} x={d.x} y={d.y} radius={4} fill="#fff" stroke="#000" strokeWidth={1} listening={false} />; })}
                </>
              )}
              {/* path: first-click marker while drawing */}
              {mode === 'drawing-path' && pathDraft && view && (() => {
                const d = vToD(pathDraft);
                return <Circle x={d.x} y={d.y} radius={5} fill="#fff" stroke="#FF3B3B" strokeWidth={2} listening={false} />;
              })()}

              {/* player-calibration: detected boxes to click + anchored labels */}
              {mode === 'player-calibrating' && fragments && (
                <CalibBoxes fragments={fragments} frame={Math.round(sourceTime * fps)} anchors={playerAnchors} toDisplay={vToD} />
              )}

              {/* line-calibration: drawn lines + active draft */}
              {mode === 'line-calibrating' && dims && (
                <CalibLines
                  drawnLines={drawnLines}
                  lineDraft={lineDraft}
                  activeLineId={activeLineId}
                  toDisplay={vToD}
                  videoW={dims.w}
                  videoH={dims.h}
                />
              )}

              {/* corners being collected */}
              <CalibrationPoints points={draftCalib} toDisplay={vToD} />
              {/* committed corners (faint cyan) — only in the calibrate view, not the editor */}
              {calibration && mode !== 'calibrating' && showCalibration && (
                <CalibrationPoints points={calibration.imagePoints} toDisplay={vToD} committed />
              )}
            </Layer>

            {/* selection handles — every selected overlay is draggable in place (no edit mode/button) */}
            {editTarget && view && (() => {
              const o = editTarget;
              const hc = '#FF3B3B'; // handle accent
              // display px → court metres (for court-space handles)
              const toCourt = (node: { x(): number; y(): number }) => {
                const vid = displayToVideo({ x: node.x(), y: node.y() }, view);
                return unprojectToCourt(calibration!.inverseHomography, vid.x, vid.y);
              };

              if (o.type === 'path') { // endpoints — court or screen space
                if (o.space === 'court' && !calibration) return null;
                const drag = (idx: number, node: { x(): number; y(): number }) => {
                  const vid = displayToVideo({ x: node.x(), y: node.y() }, view);
                  const np = o.space === 'court'
                    ? (() => { const c = unprojectToCourt(calibration!.inverseHomography, vid.x, vid.y); return { x: c.x, y: c.y }; })()
                    : { x: vid.x, y: vid.y };
                  onUpdatePathPoints(o.id, o.points.map((pp, i) => (i === idx ? np : pp)));
                };
                return (
                  <Layer>
                    {o.points.map((pp, i) => {
                      const d = toDisplaySpace(o.space, pp.x, pp.y);
                      return <Circle key={i} x={d.x} y={d.y} radius={9} fill="#fff" stroke={hc} strokeWidth={3} draggable onDragMove={(e) => drag(i, e.target)} />;
                    })}
                  </Layer>
                );
              }

              if (!calibration) return null; // the remaining types live in court space

              if (o.type === 'text') { // drag box to move, corner handle to resize
                const tl = project(o.courtX, o.courtY);
                return (
                  <Layer>
                    <Rect x={tl.x} y={tl.y} width={o.boxW} height={o.boxH}
                      fill="rgba(255,59,59,0.08)" stroke={hc} strokeWidth={1.5} dash={[5, 4]} draggable
                      onDragMove={(e) => { const c = toCourt(e.target); onUpdateText(o.id, { courtX: c.x, courtY: c.y }); }} />
                    <Circle x={tl.x + o.boxW} y={tl.y + o.boxH} radius={8} fill="#fff" stroke={hc} strokeWidth={2.5} draggable
                      onDragMove={(e) => onUpdateText(o.id, { boxW: Math.max(40, e.target.x() - tl.x), boxH: Math.max(24, e.target.y() - tl.y) })} />
                  </Layer>
                );
              }

              if (o.type === 'sector') { // centre = move, arc tip = radius + direction
                const center = project(o.courtX, o.courtY);
                const rad = (o.dir * Math.PI) / 180;
                const tip = project(o.courtX + o.radiusM * Math.cos(rad), o.courtY + o.radiusM * Math.sin(rad));
                return (
                  <Layer>
                    <Circle x={center.x} y={center.y} radius={9} fill="#fff" stroke="#7C5CFF" strokeWidth={3} draggable
                      onDragMove={(e) => { const c = toCourt(e.target); onUpdateSector(o.id, { courtX: c.x, courtY: c.y }); }} />
                    <Circle x={tip.x} y={tip.y} radius={9} fill="#7C5CFF" stroke="#fff" strokeWidth={3} draggable
                      onDragMove={(e) => { const c = toCourt(e.target); const dx = c.x - o.courtX, dy = c.y - o.courtY; onUpdateSector(o.id, { radiusM: Math.max(0.5, Math.hypot(dx, dy)), dir: (Math.atan2(dy, dx) * 180) / Math.PI }); }} />
                  </Layer>
                );
              }

              if (o.type === 'marker') { // single point
                const d = project(o.courtX, o.courtY);
                return (
                  <Layer>
                    <Circle x={d.x} y={d.y} radius={9} fill="#fff" stroke={hc} strokeWidth={3} draggable
                      onDragMove={(e) => { const c = toCourt(e.target); onPatchOverlay(o.id, { courtX: c.x, courtY: c.y }); }} />
                  </Layer>
                );
              }

              if (o.type === 'ground-halo') { // static circle: centre = move, edge = radius
                const center = project(o.courtX, o.courtY);
                const edge = project(o.courtX + o.radiusMeters, o.courtY);
                return (
                  <Layer>
                    <Circle x={center.x} y={center.y} radius={9} fill="#fff" stroke={hc} strokeWidth={3} draggable
                      onDragMove={(e) => { const c = toCourt(e.target); onPatchOverlay(o.id, { courtX: c.x, courtY: c.y }); }} />
                    <Circle x={edge.x} y={edge.y} radius={8} fill={hc} stroke="#fff" strokeWidth={2.5} draggable
                      onDragMove={(e) => { const c = toCourt(e.target); onPatchOverlay(o.id, { radiusMeters: Math.max(0.2, Math.hypot(c.x - o.courtX, c.y - o.courtY)) }); }} />
                  </Layer>
                );
              }

              if (o.type === 'connector') { // two endpoints
                return (
                  <Layer>
                    {o.points.map((pp, i) => {
                      const d = project(pp.courtX, pp.courtY);
                      return <Circle key={i} x={d.x} y={d.y} radius={9} fill="#fff" stroke={hc} strokeWidth={3} draggable
                        onDragMove={(e) => { const c = toCourt(e.target); onPatchOverlay(o.id, { points: o.points.map((q, j) => (j === i ? { courtX: c.x, courtY: c.y } : q)) }); }} />;
                    })}
                  </Layer>
                );
              }

              if (o.type === 'coverage-zone') { // per-vertex drag
                return (
                  <Layer>
                    {o.points.map((pp, i) => {
                      const d = project(pp.courtX, pp.courtY);
                      return <Circle key={i} x={d.x} y={d.y} radius={7} fill="#fff" stroke={hc} strokeWidth={2.5} draggable
                        onDragMove={(e) => { const c = toCourt(e.target); onPatchOverlay(o.id, { points: o.points.map((q, j) => (j === i ? { courtX: c.x, courtY: c.y } : q)) }); }} />;
                    })}
                  </Layer>
                );
              }

              return null;
            })()}
          </Stage>
        </div>
      )}
      </div>
      {/* PiP window — floats over the frame (outside zoom-content so court zoom doesn't move it) */}
      <video ref={pipVideoRef} className={`pip-video ${pipSelected ? 'selected' : ''}`} playsInline hidden={!activePip}
        onMouseDown={(e) => { onSelectOverlay(activePip!.id); pipDrag(e); }}
        style={activePip ? { left: `${activePip.x * 100}%`, top: `${activePip.y * 100}%`, width: `${activePip.w * 100}%` } : undefined} />
    </div>
  );
}
