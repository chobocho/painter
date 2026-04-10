import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { fullSnapshot, sliceImage, getPixel, setPixel } from "./ToolHelpers.js";
import { Color, RGBA } from "../util/Color.js";

interface DragState {
  layer: Layer;
  before: { width: number; height: number; data: Uint8ClampedArray };
  last: { x: number; y: number };
  carry: RGBA;
}

/**
 * Deluxe Paint–style smudge: samples the color under the pointer at start,
 * blends ~50/50 with each pixel painted under the brush as you drag, and
 * gradually picks up new color along the way.
 */
export class SmudgeTool implements Tool {
  id = "smudge";
  cursor = "crosshair";
  private drag: DragState | null = null;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    const carry = getPixel(buf, Math.floor(p.x), Math.floor(p.y));
    this.drag = {
      layer,
      before: fullSnapshot(layer),
      last: { x: Math.round(p.x), y: Math.round(p.y) },
      carry,
    };
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = this.drag.layer;
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    const r = Math.max(1, Math.floor(ctx.settings.brushSize / 2));
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const cx = px + x;
        const cy = py + y;
        const here = getPixel(buf, cx, cy);
        if (here.a === 0) continue;
        const blended = Color.lerp(here, this.drag.carry, 0.5);
        setPixel(buf, cx, cy, blended);
        this.drag.carry = Color.lerp(this.drag.carry, here, 0.1);
      }
    }
    layer.putPixels(buf, 0, 0);
    this.drag.last = { x: px, y: py };
    ctx.stack.markDirty(Rect.create(px - r, py - r, r * 2 + 1, r * 2 + 1));
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
        label: "Smudge",
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
}
