// The overlay SHAPES for a given timeline time, as Konva nodes — decoupled from
// VideoStage's editing shell (no handles / drafts / calibration UI). Rendered live
// inside VideoStage's stage AND headlessly (offscreen) by the exporter, so the
// exported frames match the editor exactly. Pure function of (time, data, view).
import { Fragment } from 'react';
import { videoToDisplay } from '../../geometry/coords';
import type { ViewTransform } from '../../geometry/coords';
import { projectCourtPoint, unprojectToCourt } from '../../geometry/homography';
import type { Pt } from '../../geometry/homography';
import { footAt } from '../../geometry/tracking';
import { drawOnProgress } from '../../lib/anim';
import { poseAt } from '../../lib/pose';
import type { CourtCalibration, Overlay, Players, PoseData, Spotlight } from '../../types';
import { GroundHalo } from './GroundHalo';
import { CoverageZone } from './CoverageZone';
import { Marker } from './Marker';
import { TextLabel } from './TextLabel';
import { PathArrow } from './PathArrow';
import { Connector } from './Connector';
import { Sector } from './Sector';
import { FreehandLine } from './FreehandLine';
import { SpotlightDim } from './SpotlightDim';
import { PoseFigure } from './PoseFigure';

export function OverlayScene({
  overlays, currentTime, sourceTime, calibration, view, width, height, players, poseData, selectedId = null,
}: {
  overlays: Overlay[];
  currentTime: number;   // timeline seconds (visibility gate + draw-on animation)
  sourceTime: number;    // source seconds (tracking / pose lookups)
  calibration: CourtCalibration;
  view: ViewTransform;
  width: number;
  height: number;
  players: Players | null;
  poseData: PoseData | null;
  selectedId?: string | null;
}) {
  const project = (courtX: number, courtY: number): Pt => videoToDisplay(projectCourtPoint(calibration.homography, courtX, courtY), view);
  const vToD = (p: Pt): Pt => videoToDisplay(p, view);
  const toDisplaySpace = (space: 'court' | 'screen', x: number, y: number): Pt => (space === 'court' ? project(x, y) : vToD({ x, y }));
  const inSpan = (o: Overlay) => o.visible && currentTime >= o.startTime && currentTime <= o.endTime;

  const spots = overlays.filter((s): s is Spotlight => s.type === 'spotlight' && inSpan(s));

  return (
    <>
      {spots.length > 0 && (
        <SpotlightDim spotlights={spots} players={players} inverseH={calibration.inverseHomography} currentTime={sourceTime} project={project} width={width} height={height} />
      )}
      {overlays.filter(inSpan).map((o) => {
        switch (o.type) {
          case 'coverage-zone':
            return <CoverageZone key={o.id} points={o.points} project={project} color={o.color} opacity={o.opacity} fillStyle={o.fillStyle} dashed={o.dashed} strokeWidth={o.strokeWidth} />;
          case 'sector':
            return <Sector key={o.id} courtX={o.courtX} courtY={o.courtY} radiusM={o.radiusM} dir={o.dir} spread={o.spread} project={project} color={o.color} opacity={o.opacity}
              drawProgress={drawOnProgress(o, currentTime)} drawReverse={o.drawReverse} />;
          case 'marker':
            return <Marker key={o.id} courtX={o.courtX} courtY={o.courtY} project={project} color={o.color} />;
          case 'text':
            return <TextLabel key={o.id} courtX={o.courtX} courtY={o.courtY} text={o.text} project={project} color={o.color}
              fontSize={o.fontSize} fontFamily={o.fontFamily} bold={o.bold} align={o.align} boxW={o.boxW} boxH={o.boxH} bg={o.bg} bgColor={o.bgColor} bgOpacity={o.bgOpacity} />;
          case 'path':
            return <PathArrow key={o.id} space={o.space} shape={o.shape} points={o.points} height={o.height} dashed={o.dashed} toDisplay={toDisplaySpace} color={o.color}
              drawProgress={drawOnProgress(o, currentTime)} drawReverse={o.drawReverse} />;
          case 'connector':
            return <Connector key={o.id} points={o.points} project={project} color={o.color} />;
          case 'freehand':
            return <FreehandLine key={o.id} points={o.points} toDisplay={vToD} color={o.color} width={o.width} />;
          case 'pose': {
            const samples = poseData?.players[o.trackId];
            const frameTime = o.freeze != null ? o.freeze : sourceTime;
            const frame = samples ? poseAt(samples, frameTime) : null;
            if (!frame) return null;
            return <PoseFigure key={o.id} frame={frame} samples={samples} trailEndT={frameTime} toDisplay={vToD} color={o.color}
              skeleton={o.skeleton} angles={o.angles} side={o.side} selected={selectedId === o.id}
              strokeWidth={o.strokeWidth} opacity={o.opacity} showJoints={o.showJoints} jointSize={o.jointSize}
              angleDisplay={o.angleDisplay} angleFontSize={o.angleFontSize} targets={o.targets} trailJoint={o.trailJoint} trailSec={o.trailSec} />;
          }
          case 'ground-halo': {
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
          default:
            return <Fragment key={o.id} />; // spotlight (drawn above) / zoom-in / speed → no shape
        }
      })}
    </>
  );
}
