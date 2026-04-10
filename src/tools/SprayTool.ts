import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D, CanvasFactory } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { Color } from "../util/Color.js";

// Lightweight seedable RNG so spray output is testable.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface DragState {
  layer: Layer;
  shadow: CanvasLike;
  shadowCtx: Ctx2D;
  rng: () => number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function snapshotLayer(layer: Layer, factory: CanvasFactory): { canvas: CanvasLike; ctx: Ctx2D } {
  const c = factory(layer.width, layer.height);
  const cx = c.getContext("2d");
  if (!cx) throw new Error("snapshotLayer: no 2d context");
  (cx as Ctx2D).drawImage(layer.getCanvas() as unknown);
  return { canvas: c, ctx: cx as Ctx2D };
}

export class SprayTool implements Tool {
  id = "spray";
  cursor = "crosshair";
  private drag: DragState | null = null;
  seed: number = 1;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const shadow = snapshotLayer(layer, ctx.stack.factory);
    this.drag = {
      layer,
      shadow: shadow.canvas,
      shadowCtx: shadow.ctx,
      rng: mulberry32(this.seed),
      bbox: { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y },
    };
    this.spray(p, ctx);
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (this.drag) this.spray(p, ctx);
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const padding = ctx.settings.brushSize * 2 + 4;
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
        label: "Spray",
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

  private spray(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const lctx = drag.layer.getCtx();
    const radius = Math.max(2, ctx.settings.brushSize * 2);
    const flow = Math.max(1, Math.round(ctx.settings.sprayFlow * ctx.settings.sprayDensity));
    lctx.save();
    lctx.fillStyle = Color.toCss(ctx.settings.color);
    for (let i = 0; i < flow; i++) {
      const angle = drag.rng() * Math.PI * 2;
      const dist = drag.rng() * radius;
      const x = Math.round(p.x + Math.cos(angle) * dist);
      const y = Math.round(p.y + Math.sin(angle) * dist);
      lctx.fillRect(x, y, 1, 1);
      if (x < drag.bbox.minX) drag.bbox.minX = x;
      if (y < drag.bbox.minY) drag.bbox.minY = y;
      if (x > drag.bbox.maxX) drag.bbox.maxX = x;
      if (y > drag.bbox.maxY) drag.bbox.maxY = y;
    }
    lctx.restore();
    ctx.stack.markDirty(Rect.create(p.x - radius, p.y - radius, radius * 2, radius * 2));
  }
}
