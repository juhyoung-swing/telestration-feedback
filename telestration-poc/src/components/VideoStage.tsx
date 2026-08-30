import { useState } from 'react';
import type { RefObject } from 'react';
import { Stage, Layer } from 'react-konva';
import { useElementSize } from '../hooks/useElementSize';
import { projectCourtPoint, unprojectToCourt } from '../geometry/homography';
import type { Pt } from '../geometry/homography';
import { videoToDisplay, displayToVideo } from '../geometry/coords';
import type { ViewTransform } from '../geometry/coords';
import { footAt } from '../geometry/tracking';
import { CourtGrid } from './overlays/CourtGrid';
import { GroundHalo } from './overlays/GroundHalo';
import { CoverageZone } from './overlays/CoverageZone';
import { CalibrationPoints } from './overlays/CalibrationPoints';
import { CalibLines } from './overlays/CalibLines';
import { CalibBoxes } from './overlays/CalibBoxes';
import type { CourtCalibration, Overlay, Mode, DrawnLine, Players, Fragments, PlayerAnchor } from '../types';

type Props = {
  src: string;
  videoRef: RefObject<HTMLVideoElement>;
  calibration: CourtCalibration | null;
  overlays: Overlay[];
  mode: Mode;
  showGrid: boolean;
  currentTime: number; // seconds — overlays render only within their [start,end]
  players: Players | null; // tracked player trajectories (foot points in video px)
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
  players,
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

  return (
    <div className="video-stage" ref={boxRef} style={{ aspectRatio: aspect }}>
      <video
        ref={videoRef}
        className="video-el"
        src={src}
        controls
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
              {calibration && showGrid && <CourtGrid project={project} />}

              {calibration &&
                overlays
                  .filter((o) => o.visible && currentTime >= o.startTime && currentTime <= o.endTime)
                  .map((o) => {
                    if (o.type === 'coverage-zone') {
                      return <CoverageZone key={o.id} points={o.points} project={project} color={o.color} opacity={o.opacity} />;
                    }
                    // ground-halo: a tracked halo derives its court position from the
                    // player's foot at the current time (foot → H⁻¹ → court meters).
                    let cx = o.courtX, cy = o.courtY;
                    if (o.trackId && players) {
                      const foot = footAt(players[o.trackId] ?? [], currentTime);
                      if (!foot) return null; // player not present at this instant
                      const c = unprojectToCourt(calibration.inverseHomography, foot[0], foot[1]);
                      cx = c.x; cy = c.y;
                    }
                    return (
                      <GroundHalo key={o.id} courtX={cx} courtY={cy} radiusMeters={o.radiusMeters} project={project} color={o.color} opacity={o.opacity} />
                    );
                  })}

              {calibration && mode === 'drawing-zone' && draftZone.length > 0 && (
                <CoverageZone points={draftZone} project={project} closed={draftZone.length >= 3} />
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
  );
}
