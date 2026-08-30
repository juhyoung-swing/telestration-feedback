// ---------------------------------------------------------------------------
// Tennis doubles court model, in meters (③ court space).
// Origin (0,0) = far-left doubles baseline corner. +x → right, +y → toward camera.
// ---------------------------------------------------------------------------
import type { Pt } from './homography';

export const DOUBLES_WIDTH = 10.97;
export const COURT_LENGTH = 23.77;
export const SINGLES_WIDTH = 8.23;
export const ALLEY = (DOUBLES_WIDTH - SINGLES_WIDTH) / 2; // 1.37
export const NET_Y = COURT_LENGTH / 2;                     // 11.885
export const SERVICE_FROM_NET = 6.4;
export const SERVICE_FAR_Y = NET_Y - SERVICE_FROM_NET;     // 5.485
export const SERVICE_NEAR_Y = NET_Y + SERVICE_FROM_NET;    // 18.285
export const CENTER_X = DOUBLES_WIDTH / 2;                 // 5.485
export const SINGLES_LEFT_X = ALLEY;                       // 1.37
export const SINGLES_RIGHT_X = ALLEY + SINGLES_WIDTH;      // 9.60

/**
 * The 4 calibration corners in the EXACT click order the user is asked for:
 *   1 far-left · 2 far-right · 3 near-right · 4 near-left  (doubles baseline corners)
 */
export const COURT_CORNERS: Pt[] = [
  { x: 0, y: 0 },                        // 1 far-left
  { x: DOUBLES_WIDTH, y: 0 },            // 2 far-right
  { x: DOUBLES_WIDTH, y: COURT_LENGTH }, // 3 near-right
  { x: 0, y: COURT_LENGTH },             // 4 near-left
];

export const CORNER_LABELS = [
  '① 먼 왼쪽 (far-left)',
  '② 먼 오른쪽 (far-right)',
  '③ 가까운 오른쪽 (near-right)',
  '④ 가까운 왼쪽 (near-left)',
];

export type CourtLineKind = 'perimeter' | 'singles' | 'service' | 'net' | 'center';
export type CourtLine = { name: string; kind: CourtLineKind; points: Pt[] };

/** Known court lines, in court meters. Projecting these through H must overlap the real lines in the video. */
export function courtLines(): CourtLine[] {
  return [
    {
      name: 'doubles perimeter', kind: 'perimeter',
      points: [
        { x: 0, y: 0 }, { x: DOUBLES_WIDTH, y: 0 },
        { x: DOUBLES_WIDTH, y: COURT_LENGTH }, { x: 0, y: COURT_LENGTH }, { x: 0, y: 0 },
      ],
    },
    { name: 'left singles', kind: 'singles', points: [{ x: SINGLES_LEFT_X, y: 0 }, { x: SINGLES_LEFT_X, y: COURT_LENGTH }] },
    { name: 'right singles', kind: 'singles', points: [{ x: SINGLES_RIGHT_X, y: 0 }, { x: SINGLES_RIGHT_X, y: COURT_LENGTH }] },
    { name: 'net', kind: 'net', points: [{ x: 0, y: NET_Y }, { x: DOUBLES_WIDTH, y: NET_Y }] },
    { name: 'far service', kind: 'service', points: [{ x: SINGLES_LEFT_X, y: SERVICE_FAR_Y }, { x: SINGLES_RIGHT_X, y: SERVICE_FAR_Y }] },
    { name: 'near service', kind: 'service', points: [{ x: SINGLES_LEFT_X, y: SERVICE_NEAR_Y }, { x: SINGLES_RIGHT_X, y: SERVICE_NEAR_Y }] },
    { name: 'center service', kind: 'center', points: [{ x: CENTER_X, y: SERVICE_FAR_Y }, { x: CENTER_X, y: SERVICE_NEAR_Y }] },
    { name: 'center mark far', kind: 'center', points: [{ x: CENTER_X, y: 0 }, { x: CENTER_X, y: 0.3 }] },
    { name: 'center mark near', kind: 'center', points: [{ x: CENTER_X, y: COURT_LENGTH - 0.3 }, { x: CENTER_X, y: COURT_LENGTH }] },
  ];
}
