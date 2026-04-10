import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { Color } from "../util/Color.js";
import { snapshotLayer, restoreFromShadow, commitStroke, newBbox, expandBbox, Bbox } from "./StrokeUtil.js";

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
  bbox: Bbox;
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
      bbox: newBbox(p.x, p.y),
    };
    this.spray(p, ctx);
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (this.drag) this.spray(p, ctx);
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    commitStroke(ctx, this.drag.layer, this.drag.shadowCtx, this.drag.bbox, ctx.settings.brushSize * 2 + 4, "Spray");
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      restoreFromShadow(this.drag.layer, this.drag.shadow);
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
      expandBbox(drag.bbox, x, y);
    }
    lctx.restore();
    ctx.stack.markDirty(Rect.create(p.x - radius, p.y - radius, radius * 2, radius * 2));
  }
}
