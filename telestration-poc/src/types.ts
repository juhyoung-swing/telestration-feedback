import type { Pt, Mat3 } from './geometry/homography';

export type { Pt };

export type Mode =
  | 'idle' | 'calibrating' | 'line-calibrating' | 'player-calibrating'
  | 'placing-halo' | 'drawing-zone'
  | 'placing-marker' | 'placing-text' | 'drawing-path' | 'drawing-connector'
  | 'placing-zoom' | 'drawing-sector' | 'drawing-freehand';

/** One court line drawn during line-calibration: which line + the clicked points (video px). */
export type DrawnLine = { id: string; points: Pt[] };

/**
 * Calibration is the only thing tying court space to the video. Court coordinates
 * are authoritative; screen coordinates are always derived by projecting through H.
 */
export type CourtCalibration = {
  imagePoints: Pt[];       // the 4 clicked corners, in VIDEO intrinsic px (②)
  homography: Mat3;        // court(③) -> video(②)
  inverseHomography: Mat3; // video(②) -> court(③)
};

// Every render object now carries a time window [startTime, endTime] in TIMELINE
// seconds. It is drawn only while the playhead falls inside that window. `clipId`
// binds it to a base-video clip instance (so a duplicated/repeated clip does NOT
// inherit the original's annotations); absent = the sole identity clip.
export type TimeSpan = { startTime: number; endTime: number; clipId?: string };

export type GroundHalo = TimeSpan & {
  id: string;
  type: 'ground-halo';
  name: string;
  visible: boolean;
  courtX: number;      // meters (static placement, OR fallback for a tracked halo)
  courtY: number;      // meters
  radiusMeters: number;
  color?: string;
  opacity?: number;
  dashed?: boolean;    // dashed ring instead of solid
  trackId?: string;    // if set, courtX/courtY are derived per-frame from this player's foot
  drawOn?: boolean;    // animate the ring drawing itself around
  drawSec?: number;
  drawDelay?: number;
  drawEase?: 'linear' | 'inout';
  drawReverse?: boolean;
  drawLoop?: boolean;
};

// ── tracking (from scripts/track_players.py → stitch_tracks.py) ──────────────
export type FootSample = { f: number; t: number; foot: [number, number] }; // foot in video px
export type Players = Record<string, FootSample[]>;
export type TrackingData = {
  video: string; fps: number; width: number; height: number; step: number;
  players: Players;
};

// Raw fragments (with per-fragment appearance descriptor + boxes) for user-anchored re-ID.
export type Box = [number, number, number, number]; // x1,y1,x2,y2 (video px)
export type Fragment = { desc: [number, number, number]; pts: { f: number; t: number; foot: [number, number]; box: Box }[] };
export type Fragments = Record<string, Fragment>;
export type FragmentData = { video: string; fps: number; width: number; height: number; step: number; tracks: Fragments };
export type PlayerAnchor = { label: string; desc: [number, number, number]; fragId: string };

// ── pose / form analysis (from electron/ml/pose.cjs) ─────────────────────────
// 17 COCO keypoints per person per sampled frame, in video px. Keyed by the same
// player labels ("1".."K", nearest = P1) as the position pipeline's Players.
export type PoseKpt = [number, number, number]; // x, y, score (video px)
export type PoseSample = { f: number; t: number; foot: [number, number]; kpts: PoseKpt[] };
export type PosePlayers = Record<string, PoseSample[]>;
export type PoseData = {
  video: string; fps: number; width: number; height: number; step: number;
  players: PosePlayers;
};

// A recorded voice-over segment placed on the timeline (coach feedback narration).
// The audio blob lives in IndexedDB, keyed by `key`; it plays while the playhead is
// within [startTime, startTime + dur] (timeline seconds).
export type Narration = { id: string; startTime: number; dur: number; key: string };

export type ZoneFill = 'solid' | 'hatch' | 'none';
export type CoverageZone = TimeSpan & {
  id: string;
  type: 'coverage-zone';
  name: string;
  visible: boolean;
  points: { courtX: number; courtY: number }[]; // meters — NOT screen space
  color?: string;
  opacity?: number;
  fillStyle?: ZoneFill;   // interior: solid tint / diagonal hatch / outline-only
  dashed?: boolean;       // dashed border
  strokeWidth?: number;   // border thickness (px)
};

// A point on the court (Marker) / a labeled point (Text).
export type Marker = TimeSpan & {
  id: string; type: 'marker'; name: string; visible: boolean;
  courtX: number; courtY: number; color?: string;
};
export type TextLabel = TimeSpan & {
  id: string; type: 'text'; name: string; visible: boolean;
  courtX: number; courtY: number;   // top-left anchor (court meters), projected to the box's top-left
  text: string;
  fontSize: number;                 // display px
  fontFamily: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  color?: string;
  boxW: number; boxH: number;       // box size (display px) — drag to resize
  bg: boolean; bgColor: string; bgOpacity: number;
};
// Path: a directional arrow between two endpoints.
//  - space 'court'  → endpoints are court metres, projected onto the floor (perspective).
//  - space 'screen' → endpoints are video px, drawn flat on screen (ignores the court).
//  - shape 'line'   → straight. shape 'arc' → a 3D-look parabola that lifts UP off the floor
//    (peak = `height` × chord length, upward in screen), like a ball/lob trajectory.
export type PathArrow = TimeSpan & {
  id: string; type: 'path'; name: string; visible: boolean;
  space: 'court' | 'screen';
  shape: 'line' | 'arc';
  points: { x: number; y: number }[]; // [start, end] — court metres or video px per `space`
  height: number; // arc peak as a fraction of chord length; 0 for a line
  dashed: boolean;
  color?: string;
  drawOn?: boolean;      // animate the arrow drawing itself
  drawSec?: number;      // draw-on duration (seconds)
  drawDelay?: number;    // start drawing this many seconds after the overlay appears
  drawEase?: 'linear' | 'inout'; // constant speed vs ease-in-out
  drawReverse?: boolean; // reveal end→start instead of start→end
  drawLoop?: boolean;    // keep re-drawing (draw, hold, repeat)
};
export type Connector = TimeSpan & {
  id: string; type: 'connector'; name: string; visible: boolean;
  points: { courtX: number; courtY: number }[]; color?: string;
};
// A filled radial sector (fan) on the court: from a centre, a wedge of `spread`
// degrees pointing at `dir`, out to `radiusM` metres. Vertices are computed in
// court metres and projected through H, so it conforms to the court perspective.
export type Sector = TimeSpan & {
  id: string; type: 'sector'; name: string; visible: boolean;
  courtX: number; courtY: number; // centre (court metres)
  radiusM: number;                // radius (metres)
  dir: number;                    // direction angle (degrees) in the court plane
  spread: number;                 // total arc angle (degrees)
  color?: string; opacity?: number;
  drawOn?: boolean;    // animate the fan outline drawing itself
  drawSec?: number;
  drawDelay?: number;
  drawEase?: 'linear' | 'inout';
  drawReverse?: boolean;
  drawLoop?: boolean;
};

// Freehand pen stroke: a flat, screen-space (video px) polyline the coach draws
// directly on the frame — like a telestrator pen. Needs no calibration (drawn flat,
// not projected onto the court). Used heavily during live COACH capture.
export type FreehandStroke = TimeSpan & {
  id: string; type: 'freehand'; name: string; visible: boolean;
  points: { x: number; y: number }[]; // VIDEO px
  color?: string;
  width: number;                       // stroke width (display px)
};

// Spotlight: dim the whole frame, reveal (light up) the tracked player.
export type Spotlight = TimeSpan & {
  id: string; type: 'spotlight'; name: string; visible: boolean;
  trackId: string;
};
// Pose (form) overlay: draw a player's skeleton + annotate joint angles, sourced
// from the pose-analysis cache (PoseData) by trackId, per the video currentTime.
export type PoseAngleId = 'elbow' | 'knee' | 'rotation' | 'trunk';
export type PoseAngleDisplay = 'both' | 'number' | 'arc';
export type PoseOverlay = TimeSpan & {
  id: string; type: 'pose'; name: string; visible: boolean;
  trackId: string;              // pose player label ("1".."K")
  color?: string;
  skeleton: boolean;            // draw the stick figure
  angles: PoseAngleId[];        // which joint angles to annotate
  side: 'left' | 'right';       // which arm/leg for elbow/knee angles
  // ── appearance ──
  strokeWidth?: number;         // skeleton line width (default 3)
  opacity?: number;             // skeleton opacity 0..1 (default 1)
  showJoints?: boolean;         // draw joint dots (default true)
  jointSize?: number;           // joint dot radius (default 3)
  angleDisplay?: PoseAngleDisplay; // arc+number / number / arc (default 'both')
  angleFontSize?: number;       // angle label size (default 14)
  // ── coaching ──
  targets?: Partial<Record<PoseAngleId, [number, number]>>; // per-angle [min,max]°: in-range green, out red
  trailJoint?: number | null;   // COCO keypoint index to trace over time (null = off)
  trailSec?: number;            // trail window length in seconds (default 1.2)
  freeze?: number | null;       // freeze the pose at this SOURCE time (null = live/tracking)
};
// Picture-in-Picture: a small video window from another source (or a moment of the main
// video) floated OVER the main frame for a time range — e.g. student form + pro form. It
// overlaps the timeline (plays alongside the main), unlike a sequential inserted clip.
// x/y/w are FRACTIONS of the frame (0..1); height follows the source's aspect.
export type PipOverlay = TimeSpan & {
  id: string; type: 'pip'; name: string; visible: boolean;
  sourceId: string;   // a VideoSource id (inserted) — the PiP footage
  srcStart: number;   // source in-point; the PiP plays srcStart + (t - startTime)
  x: number; y: number; // top-left, fraction of frame width/height
  w: number;          // width, fraction of frame width (height derived from source aspect)
  muted?: boolean;    // drop the PiP's audio (default: muted — main/narration carry sound)
};

// Speed segment: while the playhead is inside [start,end], the video plays at `rate`
// (slow-motion < 1, fast > 1). Not drawn on the canvas — a playback modifier on the timeline.
export type SpeedSegment = TimeSpan & {
  id: string; type: 'speed'; name: string; visible: boolean;
  rate: number;
};
// Zoom In: while active, punch-in (magnify) the whole composited view about a court
// point (or a tracked player's foot). The video + overlays scale together, so the
// telestration stays glued to the court. `scale` = magnification factor (>1).
export type ZoomIn = TimeSpan & {
  id: string; type: 'zoom-in'; name: string; visible: boolean;
  courtX: number; courtY: number; scale: number; trackId?: string;
};

export type Overlay = GroundHalo | CoverageZone | Marker | TextLabel | PathArrow | Connector | Sector | Spotlight | PoseOverlay | ZoomIn | SpeedSegment | FreehandStroke | PipOverlay;

// ── UI (SportsBuddy-style shell) ────────────────────────────────────────────
// Media/Court were removed: video import + court calibration happen at project creation.
export type RailTab = 'effect' | 'narrative';

// SportsBuddy feature set as Effect-tab tiles. Player-group tiles (follow-circle /
// spotlight) apply to a player picked in the panel's lower section; the rest place on the court.
export type FeatureId =
  | 'follow-circle' | 'spotlight' | 'pose'            // Player group (apply to a selected player)
  | 'circle' | 'path' | 'zone' | 'marker' | 'connector' | 'sector' | 'freehand' // Tactic group (place on court / draw)
  | 'text' | 'zoom-in' | 'slowmo' | 'pip'               // Action group
  | 'coach';                                            // COACH group (live recording)

export type CircleParams = { radiusMeters: number; color: string; opacity: number; dashed: boolean; drawOn: boolean; drawSec: number; drawDelay: number; drawEase: 'linear' | 'inout'; drawReverse: boolean; drawLoop: boolean };
export type ZoneParams = { color: string; opacity: number; fillStyle: ZoneFill; dashed: boolean; strokeWidth: number };
export type ZoomParams = { scale: number };
export type PathParams = { shape: 'court-line' | 'screen-line' | 'arc'; height: number; color: string; dashed: boolean; drawOn: boolean; drawSec: number; drawDelay: number; drawEase: 'linear' | 'inout'; drawReverse: boolean; drawLoop: boolean };
export type TextParams = { fontSize: number; fontFamily: string; bold: boolean; align: 'left' | 'center' | 'right'; color: string; bg: boolean; bgColor: string; bgOpacity: number };
export type FreehandParams = { color: string; width: number };

// An INSERTED video (multi-source). The main/original calibrated video stays the
// project's videoKey; extra sources are footage dropped into the timeline. Clips carry
// a `sourceId` to say which video they play (absent = main). Different aspect ratios are
// letterboxed into the fixed project frame; court overlays apply only to the main video.
export type VideoSource = {
  id: string;
  name: string;
  key: string;        // IndexedDB blob key
  w: number; h: number; // intrinsic px
  duration: number;   // seconds
};
