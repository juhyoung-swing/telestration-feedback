// ---------------------------------------------------------------------------
// Display scaling: video intrinsic px (②) ⇄ DOM/CSS px (①).
//
// The overlay <video> is wrapped in a box whose aspect-ratio equals the video's,
// so `object-fit: contain` fills it with NO letterboxing → the displayed content
// rect equals the container rect. The only ①⇄② transform is a uniform scale
// (displayedSize / intrinsicSize).
//
// On resize we update ONLY this transform. H (②⇄③) is untouched.
// ---------------------------------------------------------------------------
import type { Pt } from './homography';

export type ViewTransform = {
  scaleX: number; // displayedWidth  / videoWidth
  scaleY: number; // displayedHeight / videoHeight
};

/** video intrinsic px (②) -> displayed CSS px (①) */
export function videoToDisplay(p: Pt, t: ViewTransform): Pt {
  return { x: p.x * t.scaleX, y: p.y * t.scaleY };
}

/** displayed CSS px (①, e.g. a click relative to the overlay) -> video intrinsic px (②) */
export function displayToVideo(p: Pt, t: ViewTransform): Pt {
  return { x: p.x / t.scaleX, y: p.y / t.scaleY };
}
