import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D, CanvasFactory } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { Color, RGBA } from "../util/Color.js";

interface PatternMask {
  width: number;
  height: number;
  bits: Uint8Array;
}

const PATTERNS: Record<string, PatternMask> = {
  dots: {
    width: 4, height: 4,
    bits: new Uint8Array([
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 0,
      1, 0, 0, 1,
    ]),
  },
  hatch: {
    width: 4, height: 4,
    bits: new Uint8Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  },
  cross: {
    width: 5, height: 5,
    bits: new Uint8Array([
      0, 0, 1, 0, 0,
      0, 0, 1, 0, 0,
      1, 1, 1, 1, 1,
      0, 0, 1, 0, 0,
      0, 0, 1, 0, 0,
    ]),
  },
};

interface DragState {
  layer: Layer;
  shadow: CanvasLike;
  shadowCtx: Ctx2D;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function snapshotLayer(layer: Layer, factory: CanvasFactory): { canvas: CanvasLike; ctx: Ctx2D } {
  const c = factory(layer.width, layer.height);
  const cx = c.getContext("2d");
  if (!cx) throw new Error("snapshotLayer: no 2d context");
  (cx as Ctx2D).drawImage(layer.getCanvas() as unknown);
  return { canvas: c, ctx: cx as Ctx2D };
}

/**
 * Pencil-like tool that stamps a tileable pattern instead of a solid color.
 * Operates on the small region under each stamp, not the whole layer.
 */
export class PatternBrush implements Tool {
  id = "pattern";
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
      bbox: { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y },
    };
    this.stamp(p, ctx);
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (this.drag) this.stamp(p, ctx);
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const padding = Math.max(2, ctx.settings.brushSize) + 2;
    const x0 = Math.max(0, Math.floor(drag.bbox.minX - padding));
    const y0 = Math.max(0, Math.floor(drag.bbox.minY - padding));
    const x1 = Math.min(drag.layer.width, Math.ceil(drag.bbox.maxX + padding + 1));
    const y1 = Math.min(drag.layer.height, Math.ceil(drag.bbox.maxY + padding + 1));
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
        label: "Pattern",
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

  private stamp(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const pat = PATTERNS[ctx.settings.patternId ?? "dots"] ?? PATTERNS["dots"]!;
    const radius = Math.max(1, Math.floor(ctx.settings.brushSize));
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    const x0 = Math.max(0, cx - radius);
    const y0 = Math.max(0, cy - radius);
    const w = Math.min(drag.layer.width - x0, radius * 2 + 1);
    const h = Math.min(drag.layer.height - y0, radius * 2 + 1);
    if (w <= 0 || h <= 0) return;
    const region = drag.layer.getCtx().getImageData(x0, y0, w, h);
    const color: RGBA = ctx.settings.color;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const wx = x0 + xx;
        const wy = y0 + yy;
        const ddx = wx - cx;
        const ddy = wy - cy;
        if (ddx * ddx + ddy * ddy > radius * radius) continue;
        const u = ((wx % pat.width) + pat.width) % pat.width;
        const v = ((wy % pat.height) + pat.height) % pat.height;
        if (pat.bits[v * pat.width + u] !== 1) continue;
        const i = (yy * w + xx) * 4;
        region.data[i] = color.r;
        region.data[i + 1] = color.g;
        region.data[i + 2] = color.b;
        region.data[i + 3] = color.a;
      }
    }
    drag.layer.getCtx().putImageData(region, x0, y0);
    if (x0 < drag.bbox.minX) drag.bbox.minX = x0;
    if (y0 < drag.bbox.minY) drag.bbox.minY = y0;
    if (x0 + w > drag.bbox.maxX) drag.bbox.maxX = x0 + w;
    if (y0 + h > drag.bbox.maxY) drag.bbox.maxY = y0 + h;
    ctx.stack.markDirty(Rect.create(x0, y0, w, h));
    // Suppress unused-import warning for Color when settings.color is RGBA already.
    void Color;
  }
}

export const PATTERN_IDS = Object.keys(PATTERNS);
