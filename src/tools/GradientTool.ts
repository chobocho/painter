// Linear gradient fill (Deluxe Paint–inspired). Drag from A to B; on release
// the line direction defines the gradient axis and the affected layer pixels
// are updated. Uses raw pixel manipulation but only on the active layer's
// full surface — and only on pointerUp / per-frame preview, not per pixel
// move event.

import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D, CanvasFactory } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { Color, RGBA } from "../util/Color.js";

interface DragState {
  layer: Layer;
  shadow: CanvasLike;
  shadowCtx: Ctx2D;
  start: { x: number; y: number };
}

function snapshotLayer(layer: Layer, factory: CanvasFactory): { canvas: CanvasLike; ctx: Ctx2D } {
  const c = factory(layer.width, layer.height);
  const cx = c.getContext("2d");
  if (!cx) throw new Error("snapshotLayer: no 2d context");
  (cx as Ctx2D).drawImage(layer.getCanvas() as unknown);
  return { canvas: c, ctx: cx as Ctx2D };
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
    };
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    this.preview(p, ctx);
  }

  onPointerUp(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    this.preview(p, ctx);
    const drag = this.drag;
    const r = Rect.create(0, 0, drag.layer.width, drag.layer.height);
    const before = drag.shadowCtx.getImageData(r.x, r.y, r.w, r.h);
    const after = drag.layer.getCtx().getImageData(r.x, r.y, r.w, r.h);
    ctx.history.execute(
      new PixelEditCommand({
        layerId: drag.layer.id,
        rect: r,
        before: { width: before.width, height: before.height, data: new Uint8ClampedArray(before.data) },
        after: { width: after.width, height: after.height, data: new Uint8ClampedArray(after.data) },
        label: "Gradient",
      }),
      { stack: ctx.stack }
    );
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      const lctx = this.drag.layer.getCtx();
      lctx.clearRect(0, 0, this.drag.layer.width, this.drag.layer.height);
      lctx.drawImage(this.drag.shadow as unknown);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }

  private preview(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const layer = drag.layer;
    // Restore original pixels.
    const lctx = layer.getCtx();
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.drawImage(drag.shadow as unknown);
    // Compute gradient.
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return;
    const region = lctx.getImageData(0, 0, layer.width, layer.height);
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const px = x - drag.start.x;
        const py = y - drag.start.y;
        let t = (px * dx + py * dy) / len2;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        const c = sampleGradient(ctx.settings.gradientStops, t);
        const i = (y * layer.width + x) * 4;
        region.data[i] = c.r;
        region.data[i + 1] = c.g;
        region.data[i + 2] = c.b;
        region.data[i + 3] = c.a;
      }
    }
    lctx.putImageData(region, 0, 0);
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }
}
