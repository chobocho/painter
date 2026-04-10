// Shape-family tools (pencil/line/rect/square/circle/ellipse/triangle/eraser).
// All share the same pattern: snapshot before, accumulate via plot helpers, commit one PixelEditCommand on pointerUp.

import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { fullSnapshot, sliceImage, plotLine, plotBrush, plotRect, plotEllipse, plotTriangle } from "./ToolHelpers.js";
import { RGBA } from "../util/Color.js";

interface DragState {
  start: { x: number; y: number };
  last: { x: number; y: number };
  before: { width: number; height: number; data: Uint8ClampedArray };
  layer: Layer;
}

function commit(ctx: ToolContext, state: DragState, after: { width: number; height: number; data: Uint8ClampedArray }, label: string): void {
  // Determine bounding rect of changes by diffing before/after.
  const r = diffBounds(state.before, after);
  if (Rect.isEmpty(r)) return;
  const before = sliceImage(state.before, r, state.layer.width);
  const afterSlice = sliceImage(after, r, state.layer.width);
  const cmd = new PixelEditCommand({
    layerId: state.layer.id,
    rect: r,
    before,
    after: afterSlice,
    label,
  });
  ctx.history.execute(cmd, { stack: ctx.stack });
}

function diffBounds(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }): Rect {
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (
        a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2] ||
        a.data[i + 3] !== b.data[i + 3]
      ) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return Rect.empty();
  return Rect.create(minX, minY, maxX - minX + 1, maxY - minY + 1);
}

abstract class BaseShapeTool implements Tool {
  abstract id: string;
  cursor = "crosshair";
  protected drag: DragState | null = null;

  protected applyMirroredPoints(p: ToolPointer, ctx: ToolContext, fn: (x: number, y: number) => void): void {
    fn(p.x, p.y);
    const sym = ctx.settings.symmetry;
    if (!sym.enabled) return;
    const w = ctx.previewLayer.width;
    const h = ctx.previewLayer.height;
    if (sym.axes.includes("x")) fn(w - 1 - p.x, p.y);
    if (sym.axes.includes("y")) fn(p.x, h - 1 - p.y);
    if (sym.axes.includes("x") && sym.axes.includes("y")) fn(w - 1 - p.x, h - 1 - p.y);
    if (sym.radial > 0) {
      const cx = w / 2;
      const cy = h / 2;
      for (let i = 1; i < sym.radial; i++) {
        const angle = (Math.PI * 2 * i) / sym.radial;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        fn(cx + dx * cosA - dy * sinA, cy + dx * sinA + dy * cosA);
      }
    }
  }

  abstract onPointerDown(p: ToolPointer, ctx: ToolContext): void;
  abstract onPointerMove(p: ToolPointer, ctx: ToolContext): void;
  abstract onPointerUp(p: ToolPointer, ctx: ToolContext): void;

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      this.drag.layer.putPixels(this.drag.before, 0, 0);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }
}

export class PencilTool extends BaseShapeTool {
  id = "pencil";

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    this.drag = {
      start: { x: Math.round(p.x), y: Math.round(p.y) },
      last: { x: Math.round(p.x), y: Math.round(p.y) },
      before: fullSnapshot(layer),
      layer,
    };
    // Stamp initial dot.
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    this.applyMirroredPoints(p, ctx, (x, y) => plotBrush(buf, Math.round(x), Math.round(y), ctx.settings.brushSize, ctx.settings.color));
    layer.putPixels(buf, 0, 0);
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = this.drag.layer;
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    this.applyMirroredPoints(p, ctx, (x, y) => {
      plotLine(buf, this.drag!.last.x, this.drag!.last.y, Math.round(x), Math.round(y), ctx.settings.color, ctx.settings.brushSize);
    });
    layer.putPixels(buf, 0, 0);
    this.drag.last = { x: Math.round(p.x), y: Math.round(p.y) };
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const after = fullSnapshot(this.drag.layer);
    commit(ctx, this.drag, after, "Pencil");
    this.drag = null;
  }
}

export class EraserTool extends BaseShapeTool {
  id = "eraser";

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    this.drag = {
      start: { x: Math.round(p.x), y: Math.round(p.y) },
      last: { x: Math.round(p.x), y: Math.round(p.y) },
      before: fullSnapshot(layer),
      layer,
    };
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    plotBrush(buf, Math.round(p.x), Math.round(p.y), ctx.settings.brushSize, { r: 0, g: 0, b: 0, a: 0 });
    layer.putPixels(buf, 0, 0);
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = this.drag.layer;
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    plotLine(buf, this.drag.last.x, this.drag.last.y, Math.round(p.x), Math.round(p.y), { r: 0, g: 0, b: 0, a: 0 }, ctx.settings.brushSize);
    layer.putPixels(buf, 0, 0);
    this.drag.last = { x: Math.round(p.x), y: Math.round(p.y) };
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const after = fullSnapshot(this.drag.layer);
    commit(ctx, this.drag, after, "Eraser");
    this.drag = null;
  }
}

abstract class TwoPointShapeTool extends BaseShapeTool {
  protected abstract draw(buf: { width: number; height: number; data: Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number, color: RGBA, filled: boolean, brush: number, ctx: ToolContext): void;
  abstract id: string;
  filled = false;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    this.drag = {
      start: { x: Math.round(p.x), y: Math.round(p.y) },
      last: { x: Math.round(p.x), y: Math.round(p.y) },
      before: fullSnapshot(layer),
      layer,
    };
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const layer = this.drag.layer;
    layer.putPixels(this.drag.before, 0, 0);
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    this.draw(buf, this.drag.start.x, this.drag.start.y, Math.round(p.x), Math.round(p.y), ctx.settings.color, this.filled, ctx.settings.brushSize, ctx);
    layer.putPixels(buf, 0, 0);
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const after = fullSnapshot(this.drag.layer);
    commit(ctx, this.drag, after, this.id);
    this.drag = null;
  }
}

export class LineTool extends TwoPointShapeTool {
  id = "line";
  protected draw(buf: any, x0: number, y0: number, x1: number, y1: number, color: RGBA, _filled: boolean, brush: number): void {
    plotLine(buf, x0, y0, x1, y1, color, brush);
  }
}

export class RectTool extends TwoPointShapeTool {
  id = "rect";
  square = false;
  protected draw(buf: any, x0: number, y0: number, x1: number, y1: number, color: RGBA, filled: boolean, brush: number): void {
    if (this.square) {
      const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      const sx = x0 + Math.sign(x1 - x0 || 1) * s;
      const sy = y0 + Math.sign(y1 - y0 || 1) * s;
      plotRect(buf, x0, y0, sx, sy, color, filled, brush);
    } else {
      plotRect(buf, x0, y0, x1, y1, color, filled, brush);
    }
  }
}

export class EllipseTool extends TwoPointShapeTool {
  id = "ellipse";
  circle = false;
  protected draw(buf: any, x0: number, y0: number, x1: number, y1: number, color: RGBA, filled: boolean, _brush: number): void {
    const cx = Math.round((x0 + x1) / 2);
    const cy = Math.round((y0 + y1) / 2);
    let rx = Math.round(Math.abs(x1 - x0) / 2);
    let ry = Math.round(Math.abs(y1 - y0) / 2);
    if (this.circle) {
      const r = Math.max(rx, ry);
      rx = ry = r;
    }
    plotEllipse(buf, cx, cy, rx, ry, color, filled);
  }
}

export class TriangleTool extends TwoPointShapeTool {
  id = "triangle";
  protected draw(buf: any, x0: number, y0: number, x1: number, y1: number, color: RGBA, filled: boolean, _brush: number): void {
    const px = x0 * 2 - x1;
    plotTriangle(buf, x0, y0, x1, y1, px, y1, color, filled);
  }
}
