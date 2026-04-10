import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { RGBA } from "../util/Color.js";
import { snapshotLayer, restoreFromShadow, commitStroke, newBbox, expandBbox, Bbox } from "./StrokeUtil.js";

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
  bbox: Bbox;
}

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
      bbox: newBbox(p.x, p.y),
    };
    this.stamp(p, ctx);
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (this.drag) this.stamp(p, ctx);
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    commitStroke(ctx, this.drag.layer, this.drag.shadowCtx, this.drag.bbox, ctx.settings.brushSize + 2, "Pattern");
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      restoreFromShadow(this.drag.layer, this.drag.shadow);
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
    expandBbox(drag.bbox, x0, y0);
    expandBbox(drag.bbox, x0 + w - 1, y0 + h - 1);
    ctx.stack.markDirty(Rect.create(x0, y0, w, h));
  }
}

export const PATTERN_IDS = Object.keys(PATTERNS);
