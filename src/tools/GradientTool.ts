import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { fullSnapshot, sliceImage, setPixel } from "./ToolHelpers.js";
import { Color, RGBA } from "../util/Color.js";

interface DragState {
  layer: Layer;
  before: { width: number; height: number; data: Uint8ClampedArray };
  start: { x: number; y: number };
}

function sampleGradient(stops: { stop: number; color: RGBA }[], t: number): RGBA {
  if (t <= stops[0]!.stop) return stops[0]!.color;
  if (t >= stops[stops.length - 1]!.stop) return stops[stops.length - 1]!.color;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (t >= a.stop && t <= b.stop) {
      const u = (t - a.stop) / (b.stop - a.stop);
      return Color.lerp(a.color, b.color, u);
    }
  }
  return stops[stops.length - 1]!.color;
}

/**
 * Linear gradient fill (Deluxe Paint–inspired). Drag from A to B; on release
 * the line direction defines the gradient axis and the layer is filled.
 */
export class GradientTool implements Tool {
  id = "gradient";
  cursor = "crosshair";
  private drag: DragState | null = null;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    this.drag = {
      layer,
      before: fullSnapshot(layer),
      start: { x: p.x, y: p.y },
    };
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    this.preview(p, ctx);
  }

  onPointerUp(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    this.preview(p, ctx);
    const after = fullSnapshot(this.drag.layer);
    const r = Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height);
    ctx.history.execute(
      new PixelEditCommand({
        layerId: this.drag.layer.id,
        rect: r,
        before: sliceImage(this.drag.before, r, this.drag.layer.width),
        after: sliceImage(after, r, this.drag.layer.width),
        label: "Gradient",
      }),
      { stack: ctx.stack }
    );
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      this.drag.layer.putPixels(this.drag.before, 0, 0);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }

  private preview(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = this.drag.layer;
    layer.putPixels(this.drag.before, 0, 0);
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    const dx = p.x - this.drag.start.x;
    const dy = p.y - this.drag.start.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const px = x - this.drag.start.x;
        const py = y - this.drag.start.y;
        let t = (px * dx + py * dy) / len2;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        setPixel(buf, x, y, sampleGradient(ctx.settings.gradientStops, t));
      }
    }
    layer.putPixels(buf, 0, 0);
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }
}
