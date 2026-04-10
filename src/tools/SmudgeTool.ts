// Deluxe Paint–style smudge: blends pixels under the brush along the motion.
// Operates only on the small region under the brush (not the whole layer).

import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D, CanvasFactory } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { Color, RGBA } from "../util/Color.js";

interface DragState {
  layer: Layer;
  shadow: CanvasLike;
  shadowCtx: Ctx2D;
  carry: RGBA;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function snapshotLayer(layer: Layer, factory: CanvasFactory): { canvas: CanvasLike; ctx: Ctx2D } {
  const c = factory(layer.width, layer.height);
  const cx = c.getContext("2d");
  if (!cx) throw new Error("snapshotLayer: no 2d context");
  (cx as Ctx2D).drawImage(layer.getCanvas() as unknown);
  return { canvas: c, ctx: cx as Ctx2D };
}

export class SmudgeTool implements Tool {
  id = "smudge";
  cursor = "crosshair";
  private drag: DragState | null = null;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const shadow = snapshotLayer(layer, ctx.stack.factory);
    const sample = layer.getCtx().getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1);
    this.drag = {
      layer,
      shadow: shadow.canvas,
      shadowCtx: shadow.ctx,
      carry: { r: sample.data[0]!, g: sample.data[1]!, b: sample.data[2]!, a: sample.data[3]! },
      bbox: { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y },
    };
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const r = Math.max(1, Math.floor(ctx.settings.brushSize / 2));
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    const x0 = Math.max(0, px - r);
    const y0 = Math.max(0, py - r);
    const w = Math.min(drag.layer.width - x0, r * 2 + 1);
    const h = Math.min(drag.layer.height - y0, r * 2 + 1);
    if (w <= 0 || h <= 0) return;
    const region = drag.layer.getCtx().getImageData(x0, y0, w, h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const dxp = xx + x0 - px;
        const dyp = yy + y0 - py;
        if (dxp * dxp + dyp * dyp > r * r) continue;
        const i = (yy * w + xx) * 4;
        if (region.data[i + 3] === 0) continue;
        const here: RGBA = { r: region.data[i]!, g: region.data[i + 1]!, b: region.data[i + 2]!, a: region.data[i + 3]! };
        const blended = Color.lerp(here, drag.carry, 0.5);
        region.data[i] = blended.r;
        region.data[i + 1] = blended.g;
        region.data[i + 2] = blended.b;
        region.data[i + 3] = blended.a;
        drag.carry = Color.lerp(drag.carry, here, 0.1);
      }
    }
    drag.layer.getCtx().putImageData(region, x0, y0);
    if (x0 < drag.bbox.minX) drag.bbox.minX = x0;
    if (y0 < drag.bbox.minY) drag.bbox.minY = y0;
    if (x0 + w > drag.bbox.maxX) drag.bbox.maxX = x0 + w;
    if (y0 + h > drag.bbox.maxY) drag.bbox.maxY = y0 + h;
    ctx.stack.markDirty(Rect.create(x0, y0, w, h));
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const x0 = Math.max(0, Math.floor(drag.bbox.minX));
    const y0 = Math.max(0, Math.floor(drag.bbox.minY));
    const x1 = Math.min(drag.layer.width, Math.ceil(drag.bbox.maxX + 1));
    const y1 = Math.min(drag.layer.height, Math.ceil(drag.bbox.maxY + 1));
    if (x1 <= x0 || y1 <= y0) { this.drag = null; return; }
    const r = Rect.create(x0, y0, x1 - x0, y1 - y0);
    const before = drag.shadowCtx.getImageData(r.x, r.y, r.w, r.h);
    const after = drag.layer.getCtx().getImageData(r.x, r.y, r.w, r.h);
    ctx.history.execute(
      new PixelEditCommand({
        layerId: drag.layer.id,
        rect: r,
        before: { width: before.width, height: before.height, data: new Uint8ClampedArray(before.data) },
        after: { width: after.width, height: after.height, data: new Uint8ClampedArray(after.data) },
        label: "Smudge",
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
}
