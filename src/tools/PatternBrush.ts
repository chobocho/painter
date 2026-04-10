import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { fullSnapshot, sliceImage, setPixel } from "./ToolHelpers.js";
import { RGBA } from "../util/Color.js";

interface PatternMask {
  width: number;
  height: number;
  /** 1 = on, 0 = off */
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
  before: { width: number; height: number; data: Uint8ClampedArray };
}

/**
 * Pencil-like brush that stamps a tileable pattern (Deluxe Paint–inspired).
 * The pattern id comes from settings.patternId; defaults to "dots".
 */
export class PatternBrush implements Tool {
  id = "pattern";
  cursor = "crosshair";
  private drag: DragState | null = null;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    this.drag = { layer, before: fullSnapshot(layer) };
    this.stamp(p, ctx);
  }
  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (this.drag) this.stamp(p, ctx);
  }
  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const after = fullSnapshot(this.drag.layer);
    const r = Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height);
    ctx.history.execute(
      new PixelEditCommand({
        layerId: this.drag.layer.id,
        rect: r,
        before: sliceImage(this.drag.before, r, this.drag.layer.width),
        after: sliceImage(after, r, this.drag.layer.width),
        label: "Pattern",
      }),
      { stack: ctx.stack }
    );
    this.drag = null;
  }
  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      this.drag.layer.putPixels(this.drag.before, 0, 0);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }

  private stamp(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = this.drag.layer;
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    const pat = PATTERNS[ctx.settings.patternId ?? "dots"] ?? PATTERNS["dots"]!;
    const radius = Math.max(1, Math.floor(ctx.settings.brushSize));
    const color: RGBA = ctx.settings.color;
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (x * x + y * y > radius * radius) continue;
        const wx = cx + x;
        const wy = cy + y;
        const u = ((wx % pat.width) + pat.width) % pat.width;
        const v = ((wy % pat.height) + pat.height) % pat.height;
        if (pat.bits[v * pat.width + u] === 1) setPixel(buf, wx, wy, color);
      }
    }
    layer.putPixels(buf, 0, 0);
    ctx.stack.markDirty(Rect.create(cx - radius, cy - radius, radius * 2, radius * 2));
  }
}

export const PATTERN_IDS = Object.keys(PATTERNS);
