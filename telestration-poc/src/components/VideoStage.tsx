import { useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { Stage, Layer, Circle } from 'react-konva';
import { useElementSize } from '../hooks/useElementSize';
import { projectCourtPoint, unprojectToCourt } from '../geometry/homography';
import type { Pt } from '../geometry/homography';
import { videoToDisplay, displayToVideo } from '../geometry/coords';
import type { ViewTransform } from '../geometry/coords';
import { footAt, polyAt } from '../geometry/tracking';
import { CourtGrid } from './overlays/CourtGrid';
import { GroundHalo } from './overlays/GroundHalo';
import { CoverageZone } from './overlays/CoverageZone';
import { Marker } from './overlays/Marker';
import { TextLabel } from './overlays/TextLabel';
import { PathArrow } from './overlays/PathArrow';
import { Connector } from './overlays/Connector';
import { PersonCutout } from './overlays/PersonCutout';
import { SpotlightDim } from './overlays/SpotlightDim';
import { CalibrationPoints } from './overlays/CalibrationPoints';
import { CalibLines } from './overlays/CalibLines';
import { CalibBoxes } from './overlays/CalibBoxes';
import type { CourtCalibration, Overlay, Mode, DrawnLine, Players, Fragments, PlayerAnchor, PlayerCutouts, Spotlight, ZoomIn } from '../types';

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
  players: Players | null; // tracked player trajectories (foot points in video px)
  cutouts: PlayerCutouts | null; // per-player silhouette polygons (video px)
  fragments: Fragments | null; // raw fragments (for player-calibration hit-testing)
  playerAnchors: PlayerAnchor[]; // clicked player anchors during player-calibration
  fps: number;
  draftCalib: Pt[]; // video px
  draftZone: { courtX: number; courtY: number }[]; // court meters
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
  players,
  cutouts,
  fragments,
  playerAnchors,
  fps,
  draftCalib,
  draftZone,
  drawnLines,
  lineDraft,
  activeLineId,
  onStageClick,
  onDimensions,
}: Props) {
  const { ref: boxRef, size } = useElementSize<HTMLDivElement>();
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const interactive = mode !== 'idle';

  // ①⇄② scale. Container aspect == video aspect, so this is a uniform scale and
  // the overlay stays pixel-aligned with the video content at any size.
  const view: ViewTransform | null =
    dims && size.width > 0 ? { scaleX: size.width / dims.w, scaleY: size.height / dims.h } : null;

  // court(③) -> video(②) -> display(①). Only defined when we have both H and a view.
  const project = (courtX: number, courtY: number): Pt =>
    videoToDisplay(projectCourtPoint(calibration!.homography, courtX, courtY), view!);
  const vToD = (p: Pt): Pt => videoToDisplay(p, view!);

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
  const zoomActive = !!activeZoom;

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
      case 'marker': case 'text': case 'zoom-in': return project(o.courtX, o.courtY);
      case 'coverage-zone': case 'path': case 'connector': return o.points[0] ? project(o.points[0].courtX, o.points[0].courtY) : null;
      case 'cutout': case 'spotlight': return atFoot(o.trackId);
      default: return null;
    }
  })();

  return (
    <div className="video-stage" ref={boxRef} style={{ aspectRatio: aspect }}>
      <div className="zoom-content" style={zoomStyle}>
      <video
        ref={videoRef}
        className="video-el"
        src={src}
        controls={!zoomActive}
        playsInline
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDims({ w: v.videoWidth, h: v.videoHeight });
          onDimensions(v.videoWidth, v.videoHeight);
        }}
      />

      {view && (
        <div
          className="konva-overlay"
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
                      case 'marker':
                        return <Marker key={o.id} courtX={o.courtX} courtY={o.courtY} project={project} color={o.color} />;
                      case 'text':
                        return <TextLabel key={o.id} courtX={o.courtX} courtY={o.courtY} text={o.text} project={project} color={o.color} />;
                      case 'path':
                        return <PathArrow key={o.id} points={o.points} curvature={o.curvature} project={project} color={o.color} />;
                      case 'connector':
                        return <Connector key={o.id} points={o.points} project={project} color={o.color} />;
                      case 'spotlight':
                        return null; // rendered by SpotlightDim above
                      case 'zoom-in':
                        return null; // applied as a CSS transform on the whole stage
                      case 'cutout': {
                        if (!cutouts) return null;
                        const poly = polyAt(cutouts[o.trackId] ?? [], Math.round(currentTime * fps));
                        if (!poly) return null;
                        return <PersonCutout key={o.id} poly={poly} toDisplay={vToD} color={o.color} />;
                      }
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

              {/* draft preview for zone / path / connector */}
              {calibration && (mode === 'drawing-zone' || mode === 'drawing-path' || mode === 'drawing-connector') && draftZone.length > 0 && (
                <>
                  {mode === 'drawing-zone' && <CoverageZone points={draftZone} project={project} closed={draftZone.length >= 3} />}
                  {mode === 'drawing-path' && <PathArrow points={draftZone} project={project} arrow={false} color="#FF3B3B" />}
                  {mode === 'drawing-connector' && <Connector points={draftZone} project={project} />}
                  {draftZone.map((p, i) => { const d = project(p.courtX, p.courtY); return <Circle key={i} x={d.x} y={d.y} radius={4} fill="#fff" stroke="#000" strokeWidth={1} listening={false} />; })}
                </>
              )}

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
          </Stage>
        </div>
      )}
      </div>

      {hint && <div className="stage-hint">{hint}</div>}
    </div>
  );
}
