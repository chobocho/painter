import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { Emitter } from "../util/Events.js";
import { RGBA } from "../util/Color.js";

export interface ToolPointer {
  x: number;
  y: number;
  pressure: number;
  buttons: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface SymmetryConfig {
  enabled: boolean;
  axes: ("x" | "y")[];
  radial: number; // 0 = off, otherwise N-way radial
}

export interface ToolSettings {
  color: RGBA;
  secondaryColor: RGBA;
  brushSize: number;
  opacity: number;        // 0..1
  tolerance: number;      // 0..255 for fill bucket / chroma key
  spacing: number;        // pencil spacing
  sprayDensity: number;   // 0..1
  sprayFlow: number;      // particles per move event
  symmetry: SymmetryConfig;
  patternId: string | null;
  gradientStops: { stop: number; color: RGBA }[];
}

export const defaultSettings = (): ToolSettings => ({
  color: { r: 255, g: 0, b: 0, a: 255 },
  secondaryColor: { r: 255, g: 255, b: 255, a: 255 },
  brushSize: 4,
  opacity: 1,
  tolerance: 16,
  spacing: 1,
  sprayDensity: 0.4,
  sprayFlow: 12,
  symmetry: { enabled: false, axes: [], radial: 0 },
  patternId: null,
  gradientStops: [
    { stop: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
    { stop: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
  ],
});

export interface ToolContext {
  stack: LayerStack;
  history: CommandHistory;
  settings: ToolSettings;
  previewLayer: Layer;
  /** Composite snapshot used by eyedropper. Optional. */
  composite?: Layer;
  /**
   * Callback fired by tools that change the active color (e.g. eyedropper).
   * The PainterApp wires this to the Palette so the swatch UI updates and
   * the user gets visual feedback that their click did something.
   */
  onColorPicked?: (c: RGBA) => void;
}

export interface Tool {
  id: string;
  cursor: string;
  onPointerDown(p: ToolPointer, ctx: ToolContext): void;
  onPointerMove(p: ToolPointer, ctx: ToolContext): void;
  onPointerUp(p: ToolPointer, ctx: ToolContext): void;
  onPointerCancel(ctx: ToolContext): void;
}

export class ToolSettingsEmitter extends Emitter<{ change: ToolSettings }> {
  constructor(public state: ToolSettings) { super(); }
  patch(p: Partial<ToolSettings>): void {
    this.state = { ...this.state, ...p };
    this.emit("change", this.state);
  }
}
