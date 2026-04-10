// Linear gradient fill (Deluxe Paint–inspired). Drag from A to B; on release
// the line direction defines the gradient axis and the affected layer pixels
// are updated.

import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { Color, RGBA } from "../util/Color.js";
import { snapshotLayer, restoreFromShadow, commitStroke, newBbox, expandBbox, Bbox } from "./StrokeUtil.js";

interface DragState {
  layer: Layer;
  shadow: CanvasLike;
  shadowCtx: Ctx2D;
  start: { x: number; y: number };
  bbox: Bbox;
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

export class GradientTool implements Tool {
  id = "gradient";
  cursor = "crosshair";
  private drag: DragState | null = null;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const shadow = snapshotLayer(layer, ctx.stack.factory);
    this.drag = {
      layer,
      shadow: shadow.canvas,
      shadowCtx: shadow.ctx,
      start: { x: p.x, y: p.y },
      bbox: newBbox(0, 0),
    };
    expandBbox(this.drag.bbox, layer.width - 1, layer.height - 1);
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    this.preview(p, ctx);
  }

  onPointerUp(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    this.preview(p, ctx);
    commitStroke(ctx, this.drag.layer, this.drag.shadowCtx, this.drag.bbox, 0, "Gradient");
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      restoreFromShadow(this.drag.layer, this.drag.shadow);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }

  private preview(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const layer = drag.layer;
    restoreFromShadow(layer, drag.shadow);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return;
    const lctx = layer.getCtx();
    const region = lctx.getImageData(0, 0, layer.width, layer.height);
    // Deluxe Paint–style gradient fill: only repaint pixels that already
    // have content on the layer. Empty pixels are left alone, so the
    // gradient is clipped to the existing shape outline / fill rather
    // than blanket-filling the whole canvas.
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const i = (y * layer.width + x) * 4;
        if (region.data[i + 3] === 0) continue;
        const px = x - drag.start.x;
        const py = y - drag.start.y;
        let t = (px * dx + py * dy) / len2;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        const c = sampleGradient(ctx.settings.gradientStops, t);
        region.data[i] = c.r;
        region.data[i + 1] = c.g;
        region.data[i + 2] = c.b;
        // Preserve the existing alpha so anti-aliased edges keep their
        // softness and the original shape outline is unchanged.
      }
    }
    lctx.putImageData(region, 0, 0);
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }
}
