// Headless overlay renderer: draws the overlay layer for ANY timeline time to an
// offscreen canvas — no live playback, no on-screen DOM. Reuses the exact overlay
// components (via OverlayScene) so exported frames match the editor. This is the
// key piece that lets export render faster than real time (decode → compose → encode).
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Stage, Layer } from 'react-konva';
import type Konva from 'konva';
import type { ViewTransform } from '../geometry/coords';
import { OverlayScene } from '../components/overlays/OverlayScene';
import type { CourtCalibration, Overlay, Players, PoseData } from '../types';

export type OverlaySceneInput = {
  overlays: Overlay[];
  currentTime: number;
  sourceTime: number;
  calibration: CourtCalibration;
  players: Players | null;
  poseData: PoseData | null;
};

// A reusable offscreen Konva stage at a fixed export resolution.
export class HeadlessOverlayRenderer {
  private container: HTMLDivElement;
  private root: Root;
  private stageRef: { current: Konva.Stage | null } = { current: null };
  readonly width: number;
  readonly height: number;
  private view: ViewTransform;

  constructor(exportW: number, exportH: number, videoW: number, videoH: number) {
    this.width = exportW;
    this.height = exportH;
    this.view = { scaleX: exportW / videoW, scaleY: exportH / videoH };
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(this.container);
    this.root = createRoot(this.container);
  }

  /** Render the overlay layer at one moment → a canvas (transparent where no overlay). */
  render(input: OverlaySceneInput): HTMLCanvasElement {
    flushSync(() => {
      this.root.render(
        <Stage ref={(s) => { this.stageRef.current = s; }} width={this.width} height={this.height} listening={false}>
          <Layer listening={false}>
            <OverlayScene
              overlays={input.overlays}
              currentTime={input.currentTime}
              sourceTime={input.sourceTime}
              calibration={input.calibration}
              view={this.view}
              width={this.width}
              height={this.height}
              players={input.players}
              poseData={input.poseData}
              selectedId={null}
            />
          </Layer>
        </Stage>,
      );
    });
    return this.stageRef.current!.toCanvas();
  }

  dispose() {
    try { this.root.unmount(); } catch { /* ignore */ }
    this.container.remove();
  }
}
