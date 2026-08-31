import type { Pt, Mat3 } from './geometry/homography';

export type { Pt };

export type Mode =
  | 'idle' | 'calibrating' | 'line-calibrating' | 'player-calibrating'
  | 'placing-halo' | 'drawing-zone'
  | 'placing-marker' | 'placing-text' | 'drawing-path' | 'drawing-connector'
  | 'placing-zoom' | 'editing-path';

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

// Every render object now carries a time window [startTime, endTime] in seconds.
// It is drawn only while the video's currentTime falls inside that window.
export type TimeSpan = { startTime: number; endTime: number };

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
  trackId?: string;    // if set, courtX/courtY are derived per-frame from this player's foot
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

export type CoverageZone = TimeSpan & {
  id: string;
  type: 'coverage-zone';
  name: string;
  visible: boolean;
  points: { courtX: number; courtY: number }[]; // meters — NOT screen space
  color?: string;
  opacity?: number;
};

// A point on the court (Marker) / a labeled point (Text).
export type Marker = TimeSpan & {
  id: string; type: 'marker'; name: string; visible: boolean;
  courtX: number; courtY: number; color?: string;
};
export type TextLabel = TimeSpan & {
  id: string; type: 'text'; name: string; visible: boolean;
  courtX: number; courtY: number; text: string; color?: string;
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
};
export type Connector = TimeSpan & {
  id: string; type: 'connector'; name: string; visible: boolean;
  points: { courtX: number; courtY: number }[]; color?: string;
};

// A person cutout: the outline follows a tracked player's per-frame silhouette.
export type Cutout = TimeSpan & {
  id: string; type: 'cutout'; name: string; visible: boolean;
  trackId: string; color?: string;
};
// Spotlight: dim the whole frame, reveal (light up) the tracked player.
export type Spotlight = TimeSpan & {
  id: string; type: 'spotlight'; name: string; visible: boolean;
  trackId: string;
};
// Zoom In: while active, punch-in (magnify) the whole composited view about a court
// point (or a tracked player's foot). The video + overlays scale together, so the
// telestration stays glued to the court. `scale` = magnification factor (>1).
export type ZoomIn = TimeSpan & {
  id: string; type: 'zoom-in'; name: string; visible: boolean;
  courtX: number; courtY: number; scale: number; trackId?: string;
};

export type Overlay = GroundHalo | CoverageZone | Marker | TextLabel | PathArrow | Connector | Cutout | Spotlight | ZoomIn;

// Per-player silhouette polygons (video px), from scripts/seg_players.py.
export type CutoutSample = { f: number; poly: [number, number][] };
export type PlayerCutouts = Record<string, CutoutSample[]>;
export type CutoutData = { video: string; fps: number; width: number; height: number; step: number; players: PlayerCutouts };

// ── UI (SportsBuddy-style shell) ────────────────────────────────────────────
// Player was merged into the Effect tab (its Player section), so it's no longer a rail tab.
export type RailTab = 'media' | 'court' | 'effect' | 'narrative';

// SportsBuddy feature set as Effect-tab tiles. Player-group tiles (follow-circle / cutout /
// spotlight) apply to a player picked in the panel's lower section; the rest place on the court.
export type FeatureId =
  | 'follow-circle' | 'cutout' | 'spotlight'          // Player group (apply to a selected player)
  | 'circle' | 'path' | 'zone' | 'marker' | 'connector' // Tactic group (place on court)
  | 'text' | 'zoom-in';                                 // Action group

export type CircleParams = { radiusMeters: number; color: string; opacity: number };
export type ZoneParams = { color: string; opacity: number };
export type ZoomParams = { scale: number };
export type PathParams = { shape: 'court-line' | 'screen-line' | 'arc'; height: number; color: string; dashed: boolean };
