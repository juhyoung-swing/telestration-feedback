import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { Stage, Layer, Circle, Rect } from 'react-konva';
import { useElementSize } from '../hooks/useElementSize';
import { projectCourtPoint, unprojectToCourt, circleInCourt } from '../geometry/homography';
import type { Pt } from '../geometry/homography';
import { videoToDisplay, displayToVideo } from '../geometry/coords';
import type { ViewTransform } from '../geometry/coords';
import { footAt } from '../geometry/tracking';
import { CourtGrid } from './overlays/CourtGrid';
import { GroundHalo } from './overlays/GroundHalo';
import { CoverageZone } from './overlays/CoverageZone';
import { Marker } from './overlays/Marker';
import { TextLabel } from './overlays/TextLabel';
import { PathArrow } from './overlays/PathArrow';
import { Connector } from './overlays/Connector';
import { Sector } from './overlays/Sector';
import { SpotlightDim } from './overlays/SpotlightDim';
import { CalibrationPoints } from './overlays/CalibrationPoints';
import { CalibLines } from './overlays/CalibLines';
import { CalibBoxes } from './overlays/CalibBoxes';
import type { CourtCalibration, Overlay, Mode, DrawnLine, Players, Fragments, PlayerAnchor, Spotlight, ZoomIn } from '../types';

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
  calibration: CourtCalibration | null;
  overlays: Overlay[];
  mode: Mode;
  showGrid: boolean;
  currentTime: number; // seconds — overlays render only within their [start,end]
  hint: string | null; // on-canvas guidance for the active placement/drawing mode
  selectedId: string | null; // timeline-selected overlay → highlighted on the canvas
  onSelectOverlay: (id: string | null) => void; // click an overlay on the canvas → select it
  players: Players | null; // tracked player trajectories (foot points in video px)
  fragments: Fragments | null; // raw fragments (for player-calibration hit-testing)
  playerAnchors: PlayerAnchor[]; // clicked player anchors during player-calibration
  fps: number;
  draftCalib: Pt[]; // video px
  draftZone: { courtX: number; courtY: number }[]; // court meters
  pathDraft: Pt | null; // path drawing: first click (video px)
  onUpdatePathPoints: (id: string, points: { x: number; y: number }[]) => void; // endpoint drag
  onUpdateText: (id: string, patch: Partial<Extract<Overlay, { type: 'text' }>>) => void; // text box move/resize
  drawnLines: DrawnLine[]; // line-calibration: committed lines (video px)
  lineDraft: Pt[]; // line-calibration: active line points (video px)
  activeLineId: string | null;
  onStageClick: (videoPt: Pt) => void;
  onDimensions: (w: number, h: number) => void;
};

export function VideoStage({
  src,
  videoRef,
  calibration,
  overlays,
  mode,
  showGrid,
  currentTime,
  hint,
  selectedId,
  onSelectOverlay,
  players,
  fragments,
  playerAnchors,
  fps,
  draftCalib,
  draftZone,
  pathDraft,
  onUpdatePathPoints,
  onUpdateText,
  drawnLines,
  lineDraft,
  activeLineId,
  onStageClick,
  onDimensions,
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

  const interactive = mode !== 'idle';

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

  const aspect = dims ? `${dims.w} / ${dims.h}` : '16 / 9';

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
      const foot = footAt(players[activeZoom.trackId] ?? [], currentTime);
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
      const f = footAt(players?.[id] ?? [], currentTime);
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
      case 'sector': return project(o.courtX, o.courtY);
      case 'spotlight': return atFoot(o.trackId);
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
            const foot = footAt(players[o.trackId] ?? [], currentTime);
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

  return (
    <div className="video-stage" ref={boxRef} style={{ aspectRatio: aspect }}>
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

      {view && (
        <div
          className="konva-overlay"
          ref={overlayRef}
          onMouseDown={handleClick}
          style={{
            pointerEvents: interactive ? 'auto' : 'none', // idle → native video controls stay usable
            cursor: interactive ? 'crosshair' : 'default',
          }}
        >
          <Stage width={size.width} height={size.height}>
            <Layer listening={false}>
              {/* spotlight: dim the frame + reveal players (must be first so it only dims the video) */}
              {calibration && (() => {
                const spots = overlays.filter((s): s is Spotlight => s.type === 'spotlight' && s.visible && currentTime >= s.startTime && currentTime <= s.endTime);
                return spots.length > 0 ? (
                  <SpotlightDim spotlights={spots} players={players} inverseH={calibration.inverseHomography} currentTime={currentTime} project={project} width={size.width} height={size.height} />
                ) : null;
              })()}

              {calibration && showGrid && <CourtGrid project={project} />}

              {calibration &&
                overlays
                  .filter((o) => o.visible && currentTime >= o.startTime && currentTime <= o.endTime)
                  .map((o) => {
                    switch (o.type) {
                      case 'coverage-zone':
                        return <CoverageZone key={o.id} points={o.points} project={project} color={o.color} opacity={o.opacity} />;
                      case 'sector':
                        return <Sector key={o.id} courtX={o.courtX} courtY={o.courtY} radiusM={o.radiusM} dir={o.dir} spread={o.spread} project={project} color={o.color} opacity={o.opacity} />;
                      case 'marker':
                        return <Marker key={o.id} courtX={o.courtX} courtY={o.courtY} project={project} color={o.color} />;
                      case 'text':
                        return <TextLabel key={o.id} courtX={o.courtX} courtY={o.courtY} text={o.text} project={project} color={o.color}
                          fontSize={o.fontSize} fontFamily={o.fontFamily} bold={o.bold} align={o.align} boxW={o.boxW} boxH={o.boxH}
                          bg={o.bg} bgColor={o.bgColor} bgOpacity={o.bgOpacity} />;
                      case 'path':
                        return <PathArrow key={o.id} space={o.space} shape={o.shape} points={o.points} height={o.height} dashed={o.dashed} toDisplay={toDisplaySpace} color={o.color} />;
                      case 'connector':
                        return <Connector key={o.id} points={o.points} project={project} color={o.color} />;
                      case 'spotlight':
                        return null; // rendered by SpotlightDim above
                      case 'zoom-in':
                        return null; // applied as a CSS transform on the whole stage
                      case 'speed':
                        return null; // playback-rate modifier, no canvas shape
                      case 'ground-halo': {
                        // a tracked halo derives its court position from the player's
                        // foot at the current time (foot → H⁻¹ → court meters).
                        let cx = o.courtX, cy = o.courtY;
                        if (o.trackId && players) {
                          const foot = footAt(players[o.trackId] ?? [], currentTime);
                          if (!foot) return null;
                          const c = unprojectToCourt(calibration.inverseHomography, foot[0], foot[1]);
                          cx = c.x; cy = c.y;
                        }
                        return <GroundHalo key={o.id} courtX={cx} courtY={cy} radiusMeters={o.radiusMeters} project={project} color={o.color} opacity={o.opacity} />;
                      }
                    }
                  })}

              {/* selection ring (synced from the timeline) */}
              {selAnchor && (
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
                <CalibBoxes fragments={fragments} frame={Math.round(currentTime * fps)} anchors={playerAnchors} toDisplay={vToD} />
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
              {/* committed corners (faint cyan) when not actively recalibrating */}
              {calibration && mode !== 'calibrating' && (
                <CalibrationPoints points={calibration.imagePoints} toDisplay={vToD} committed />
              )}
            </Layer>

            {/* editing-path: draggable endpoint handles on a listening layer */}
            {mode === 'editing-path' && view && (() => {
              const o = overlays.find((x) => x.id === selectedId);
              if (!o || o.type !== 'path') return null;
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
                    return <Circle key={i} x={d.x} y={d.y} radius={9} fill="#fff" stroke="#FF3B3B" strokeWidth={3} draggable onDragMove={(e) => drag(i, e.target)} />;
                  })}
                </Layer>
              );
            })()}

            {/* editing-text: drag the box to move, corner handle to resize */}
            {mode === 'editing-text' && view && calibration && (() => {
              const o = overlays.find((x) => x.id === selectedId);
              if (!o || o.type !== 'text') return null;
              const tl = project(o.courtX, o.courtY);
              return (
                <Layer>
                  <Rect
                    x={tl.x} y={tl.y} width={o.boxW} height={o.boxH}
                    fill="rgba(255,59,59,0.08)" stroke="#FF3B3B" strokeWidth={1.5} dash={[5, 4]} draggable
                    onDragMove={(e) => { const vid = displayToVideo({ x: e.target.x(), y: e.target.y() }, view); const c = unprojectToCourt(calibration.inverseHomography, vid.x, vid.y); onUpdateText(o.id, { courtX: c.x, courtY: c.y }); }}
                  />
                  <Circle
                    x={tl.x + o.boxW} y={tl.y + o.boxH} radius={8} fill="#fff" stroke="#FF3B3B" strokeWidth={2.5} draggable
                    onDragMove={(e) => onUpdateText(o.id, { boxW: Math.max(40, e.target.x() - tl.x), boxH: Math.max(24, e.target.y() - tl.y) })}
                  />
                </Layer>
              );
            })()}
          </Stage>
        </div>
      )}
      </div>

      {hint && <div className="stage-hint">{hint}</div>}
    </div>
  );
}
