import type { Pt, Mat3 } from './geometry/homography';

export type { Pt };

export type Mode = 'idle' | 'calibrating' | 'line-calibrating' | 'placing-halo' | 'drawing-zone' | 'player-calibrating';

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

export type Overlay = GroundHalo | CoverageZone;

// ── UI (SportsBuddy-style shell) ────────────────────────────────────────────
export type RailTab = 'media' | 'court' | 'player' | 'highlight' | 'narrative';

// SportsBuddy feature set. `circle` and `zone` are wired to our real geometry;
// the rest are UI-present but placement is not implemented yet (v1 shell).
export type FeatureId = 'circle' | 'spotlight' | 'connector' | 'path' | 'zone' | 'marker' | 'zoom-in';

export type CircleParams = { radiusMeters: number; color: string; opacity: number };
export type ZoneParams = { color: string; opacity: number };
