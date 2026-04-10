import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { fullSnapshot, sliceImage, setPixel } from "./ToolHelpers.js";

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
  before: { width: number; height: number; data: Uint8ClampedArray };
  rng: () => number;
}

export class SprayTool implements Tool {
  id = "spray";
  cursor = "crosshair";
  private drag: DragState | null = null;
  seed: number = 1;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    this.drag = {
      layer,
      before: fullSnapshot(layer),
      rng: mulberry32(this.seed),
    };
    this.spray(p, ctx);
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    this.spray(p, ctx);
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = this.drag.layer;
    const after = fullSnapshot(layer);
    const r = Rect.create(0, 0, layer.width, layer.height);
    const before = sliceImage(this.drag.before, r, layer.width);
    const afterSlice = sliceImage(after, r, layer.width);
    const cmd = new PixelEditCommand({
      layerId: layer.id,
      rect: r,
      before,
      after: afterSlice,
      label: "Spray",
    });
    ctx.history.execute(cmd, { stack: ctx.stack });
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      this.drag.layer.putPixels(this.drag.before, 0, 0);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }

  private spray(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = this.drag.layer;
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    const radius = ctx.settings.brushSize * 2;
    const flow = Math.max(1, Math.round(ctx.settings.sprayFlow * ctx.settings.sprayDensity));
    for (let i = 0; i < flow; i++) {
      const angle = this.drag.rng() * Math.PI * 2;
      const dist = this.drag.rng() * radius;
      const x = Math.round(p.x + Math.cos(angle) * dist);
      const y = Math.round(p.y + Math.sin(angle) * dist);
      setPixel(buf, x, y, ctx.settings.color);
    }
    layer.putPixels(buf, 0, 0);
    ctx.stack.markDirty(Rect.create(p.x - radius, p.y - radius, radius * 2, radius * 2));
  }
}
