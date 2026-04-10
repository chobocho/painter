// Linear gradient fill (Deluxe Paint–inspired). Drag from A to B; on release
// the line direction defines the gradient axis and the affected pixels are
// updated.
//
// Round-6 contract: only the *connected region* under the click point is
// repainted. Internally we run a scanline flood fill from the click point
// (same algorithm as the fill bucket, with the same tolerance setting) to
// build a mask, then the gradient is sampled per-pixel inside that mask
// only. So clicking on one shape never bleeds into a separate shape.

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
  /** 1 = pixel is in the connected region under the click; 0 = leave alone */
  mask: Uint8Array;
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

/**
 * Build a connected-region mask starting from (sx, sy). Pixels are
 * "matching" if their RGBA Euclidean distance from the seed pixel is within
 * `tolerance` (the same setting the fill bucket uses).
 */
function buildFloodMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  tolerance: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask;
  const startIdx = (sy * width + sx) * 4;
  const tr = data[startIdx]!;
  const tg = data[startIdx + 1]!;
  const tb = data[startIdx + 2]!;
  const ta = data[startIdx + 3]!;
  const tol2 = tolerance * tolerance * 4;

  const matches = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (mask[y * width + x]) return false;
    const i = (y * width + x) * 4;
    const dr = data[i]! - tr;
    const dg = data[i + 1]! - tg;
    const db = data[i + 2]! - tb;
    const da = data[i + 3]! - ta;
    return dr * dr + dg * dg + db * db + da * da <= tol2;
  };

  const stack: number[] = [sx, sy];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (!matches(x, y)) continue;
    let xl = x;
    while (xl >= 0 && matches(xl, y)) xl--;
    xl++;
    let xr = x;
    while (xr < width && matches(xr, y)) xr++;
    xr--;
    for (let xx = xl; xx <= xr; xx++) {
      mask[y * width + xx] = 1;
    }
    for (let xx = xl; xx <= xr; xx++) {
      if (y > 0 && matches(xx, y - 1)) stack.push(xx, y - 1);
      if (y < height - 1 && matches(xx, y + 1)) stack.push(xx, y + 1);
    }
  }
  return mask;
}

export class GradientTool implements Tool {
  id = "gradient";
  cursor = "crosshair";
  private drag: DragState | null = null;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const sx = Math.floor(p.x);
    const sy = Math.floor(p.y);
    if (sx < 0 || sy < 0 || sx >= layer.width || sy >= layer.height) return;

    const shadow = snapshotLayer(layer, ctx.stack.factory);
    const layerData = layer.getCtx().getImageData(0, 0, layer.width, layer.height).data;
    const mask = buildFloodMask(layerData, layer.width, layer.height, sx, sy, ctx.settings.tolerance);

    // Compute the bounding box of the mask so the commit only stores the
    // affected slice instead of the whole layer.
    let minX = layer.width, minY = layer.height, maxX = -1, maxY = -1;
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        if (!mask[y * layer.width + x]) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    const bbox = newBbox(minX < 0 ? 0 : minX, minY < 0 ? 0 : minY);
    if (maxX >= 0) expandBbox(bbox, maxX, maxY);

    this.drag = {
      layer,
      shadow: shadow.canvas,
      shadowCtx: shadow.ctx,
      start: { x: p.x, y: p.y },
      mask,
      bbox,
    };
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
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        if (!drag.mask[y * layer.width + x]) continue;
        const i = (y * layer.width + x) * 4;
        const wasEmpty = region.data[i + 3] === 0;
        const px = x - drag.start.x;
        const py = y - drag.start.y;
        let t = (px * dx + py * dy) / len2;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        const c = sampleGradient(ctx.settings.gradientStops, t);
        region.data[i] = c.r;
        region.data[i + 1] = c.g;
        region.data[i + 2] = c.b;
        // Round-7: previously-empty pixels (alpha 0) take the gradient
        // color's alpha so they actually become visible. Pixels that
        // already had color keep their original alpha so anti-aliased
        // shape edges stay soft.
        if (wasEmpty) region.data[i + 3] = c.a;
      }
    }
    lctx.putImageData(region, 0, 0);
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }
}
