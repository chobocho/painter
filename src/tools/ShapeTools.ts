// Pencil/eraser/line/rect/square/ellipse/circle/triangle tools.
//
// Implementation notes:
// - All tools draw with the layer's 2D context primitives (lineTo, fillRect,
//   ellipse, …). No tool reads or writes the full layer ImageData per pointer
//   move — that was the source of the original lag (~10 MB per move on a
//   1920x1280 layer).
// - Each tool snapshots the active layer onto a temporary "shadow" offscreen
//   canvas at pointerDown via the shared `snapshotLayer` helper. Shape tools
//   use the shadow as a clean slate to restore from on every move
//   (rubber-banding). All tools sample `before` pixels from the shadow when
//   committing the history command, so we never have to keep the original
//   ImageData around in memory.
// - Each tool tracks the bounding rect of the affected pixels via point
//   accumulation, so the committed PixelEditCommand only stores a small slice
//   instead of the entire layer.

import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { Color } from "../util/Color.js";
import { Bbox, snapshotLayer, restoreFromShadow, commitStroke, newBbox, expandBbox } from "./StrokeUtil.js";

interface DragState {
  layer: Layer;
  shadow: CanvasLike;
  shadowCtx: Ctx2D;
  start: { x: number; y: number };
  last: { x: number; y: number };
  bbox: Bbox;
}

function applyMirroredPoints(p: ToolPointer, layer: Layer, ctx: ToolContext, fn: (x: number, y: number) => void): void {
  fn(p.x, p.y);
  const sym = ctx.settings.symmetry;
  if (!sym.enabled) return;
  const w = layer.width;
  const h = layer.height;
  if (sym.axes.includes("x")) fn(w - 1 - p.x, p.y);
  if (sym.axes.includes("y")) fn(p.x, h - 1 - p.y);
  if (sym.axes.includes("x") && sym.axes.includes("y")) fn(w - 1 - p.x, h - 1 - p.y);
}

// ---- pencil / eraser ------------------------------------------------------

export class PencilTool implements Tool {
  id = "pencil";
  cursor = "crosshair";
  protected drag: DragState | null = null;
  protected eraseMode: boolean = false;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const shadow = snapshotLayer(layer, ctx.stack.factory);
    const lctx = layer.getCtx();
    lctx.save();
    lctx.lineCap = "round";
    lctx.lineJoin = "round";
    lctx.lineWidth = ctx.settings.brushSize;
    lctx.globalAlpha = ctx.settings.opacity;
    if (this.eraseMode) {
      lctx.globalCompositeOperation = "destination-out";
      lctx.fillStyle = "rgba(0,0,0,1)";
      lctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      lctx.fillStyle = Color.toCss(ctx.settings.color);
      lctx.strokeStyle = Color.toCss(ctx.settings.color);
    }

    const drag: DragState = {
      layer,
      shadow: shadow.canvas,
      shadowCtx: shadow.ctx,
      start: { x: p.x, y: p.y },
      last: { x: p.x, y: p.y },
      bbox: newBbox(p.x, p.y),
    };
    this.drag = drag;

    // Stamp a dot at the start so a single click leaves a mark.
    applyMirroredPoints(p, layer, ctx, (x, y) => {
      lctx.beginPath();
      lctx.arc(x, y, Math.max(0.5, ctx.settings.brushSize / 2), 0, Math.PI * 2);
      lctx.fill();
      expandBbox(drag.bbox, x, y);
    });
    ctx.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    const lctx = drag.layer.getCtx();
    applyMirroredPoints(p, drag.layer, ctx, (x, y) => {
      const w = drag.layer.width;
      const h = drag.layer.height;
      let lx = drag.last.x;
      let ly = drag.last.y;
      if (x !== p.x) lx = w - 1 - drag.last.x;
      if (y !== p.y) ly = h - 1 - drag.last.y;
      lctx.beginPath();
      lctx.moveTo(lx, ly);
      lctx.lineTo(x, y);
      lctx.stroke();
      expandBbox(drag.bbox, x, y);
    });
    drag.last = { x: p.x, y: p.y };
    const r = ctx.settings.brushSize + 4;
    ctx.stack.markDirty(Rect.create(p.x - r, p.y - r, r * 2, r * 2));
  }

  onPointerUp(_p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    this.drag.layer.getCtx().restore();
    commitStroke(ctx, this.drag.layer, this.drag.shadowCtx, this.drag.bbox, ctx.settings.brushSize + 4, this.eraseMode ? "Eraser" : "Pencil");
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      this.drag.layer.getCtx().restore();
      restoreFromShadow(this.drag.layer, this.drag.shadow);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }
}

export class EraserTool extends PencilTool {
  id = "eraser";
  constructor() {
    super();
    this.eraseMode = true;
  }
}

// ---- shape tools (rubber-band via shadow restore) ------------------------

abstract class TwoPointShapeTool implements Tool {
  abstract id: string;
  cursor = "crosshair";
  filled = false;
  protected drag: DragState | null = null;

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const shadow = snapshotLayer(layer, ctx.stack.factory);
    this.drag = {
      layer,
      shadow: shadow.canvas,
      shadowCtx: shadow.ctx,
      start: { x: p.x, y: p.y },
      last: { x: p.x, y: p.y },
      bbox: newBbox(p.x, p.y),
    };
  }

  onPointerMove(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    const drag = this.drag;
    drag.last = { x: p.x, y: p.y };
    expandBbox(drag.bbox, p.x, p.y);
    restoreFromShadow(drag.layer, drag.shadow);
    const lctx = drag.layer.getCtx();
    lctx.save();
    lctx.lineCap = "round";
    lctx.lineJoin = "round";
    lctx.lineWidth = Math.max(1, ctx.settings.brushSize);
    lctx.fillStyle = Color.toCss(ctx.settings.color);
    lctx.strokeStyle = Color.toCss(ctx.settings.color);
    this.drawShape(lctx, drag.start.x, drag.start.y, p.x, p.y, this.filled);
    lctx.restore();
    ctx.stack.markDirty(Rect.create(0, 0, drag.layer.width, drag.layer.height));
  }

  onPointerUp(p: ToolPointer, ctx: ToolContext): void {
    if (!this.drag) return;
    if (this.drag.bbox.minX === this.drag.bbox.maxX && this.drag.bbox.minY === this.drag.bbox.maxY) {
      this.onPointerMove(p, ctx);
    }
    commitStroke(ctx, this.drag.layer, this.drag.shadowCtx, this.drag.bbox, ctx.settings.brushSize + 4, this.id);
    this.drag = null;
  }

  onPointerCancel(ctx: ToolContext): void {
    if (this.drag) {
      restoreFromShadow(this.drag.layer, this.drag.shadow);
      ctx.stack.markDirty(Rect.create(0, 0, this.drag.layer.width, this.drag.layer.height));
    }
    this.drag = null;
  }

  protected abstract drawShape(lctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, filled: boolean): void;
}

export class LineTool extends TwoPointShapeTool {
  id = "line";
  protected drawShape(lctx: Ctx2D, x0: number, y0: number, x1: number, y1: number): void {
    lctx.beginPath();
    lctx.moveTo(x0, y0);
    lctx.lineTo(x1, y1);
    lctx.stroke();
  }
}

export class RectTool extends TwoPointShapeTool {
  id = "rect";
  square: boolean = false;
  protected drawShape(lctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, filled: boolean): void {
    let dx = x1 - x0;
    let dy = y1 - y0;
    if (this.square) {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx >= 0 ? 1 : -1) * s;
      dy = (dy >= 0 ? 1 : -1) * s;
    }
    if (filled) lctx.fillRect(x0, y0, dx, dy);
    else lctx.strokeRect(x0, y0, dx, dy);
  }
}

export class EllipseTool extends TwoPointShapeTool {
  id = "ellipse";
  circle: boolean = false;
  protected drawShape(lctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, filled: boolean): void {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    let rx = Math.abs(x1 - x0) / 2;
    let ry = Math.abs(y1 - y0) / 2;
    if (this.circle) { rx = ry = Math.max(rx, ry); }
    rx = Math.max(0.5, rx);
    ry = Math.max(0.5, ry);
    lctx.beginPath();
    lctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (filled) lctx.fill();
    else lctx.stroke();
  }
}

export class TriangleTool extends TwoPointShapeTool {
  id = "triangle";
  protected drawShape(lctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, filled: boolean): void {
    const x2 = x0 * 2 - x1;
    lctx.beginPath();
    lctx.moveTo(x0, y0);
    lctx.lineTo(x1, y1);
    lctx.lineTo(x2, y1);
    lctx.closePath();
    if (filled) lctx.fill();
    else lctx.stroke();
  }
}
