// Deluxe Paint–style smudge: blends pixels under the brush along the motion.
// Operates only on the small region under the brush, never the whole layer.

import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { Color, RGBA } from "../util/Color.js";
import { snapshotLayer, restoreFromShadow, commitStroke, newBbox, expandBbox, Bbox } from "./StrokeUtil.js";

interface DragState {
  layer: Layer;
  shadow: CanvasLike;
  shadowCtx: Ctx2D;
  carry: RGBA;
  bbox: Bbox;
}

export class SmudgeTool implements Tool {
  id = "smudge";
  cursor = "crosshair";
  private drag: DragState | null = null;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const shadow = snapshotLayer(layer, ctx.stack.factory);
    const px = Math.max(0, Math.min(layer.width - 1, Math.floor(p.x)));
    const py = Math.max(0, Math.min(layer.height - 1, Math.floor(p.y)));
    const sample = layer.getCtx().getImageData(px, py, 1, 1);
    this.drag = {
      layer,
      shadow: shadow.canvas,
      shadowCtx: shadow.ctx,
      carry: { r: sample.data[0]!, g: sample.data[1]!, b: sample.data[2]!, a: sample.data[3]! },
      bbox: newBbox(p.x, p.y),
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
    expandBbox(drag.bbox, x0, y0);
    expandBbox(drag.bbox, x0 + w - 1, y0 + h - 1);
    ctx.stack.markDirty(Rect.create(x0, y0, w, h));
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    commitStroke(ctx, this.drag.layer, this.drag.shadowCtx, this.drag.bbox, 2, "Smudge");
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      restoreFromShadow(this.drag.layer, this.drag.shadow);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }
}
