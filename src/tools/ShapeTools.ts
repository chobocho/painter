// Pencil/eraser/line/rect/square/ellipse/circle/triangle tools.
//
// Implementation notes:
// - All tools draw with the layer's 2D context primitives (lineTo, fillRect,
//   ellipse, …). No tool reads or writes the full layer ImageData per pointer
//   move — that was the source of the original lag (~10MB per move on a
//   1920x1280 layer).
// - Each tool snapshots the active layer onto a temporary "shadow" offscreen
//   canvas at pointerDown. Shape tools use the shadow as a clean slate to
//   restore from on every move (rubber-banding). All tools sample
//   `before` pixels from the shadow when committing the history command, so
//   we never have to keep the original ImageData around in memory.
// - Each tool tracks the bounding rect of the affected pixels via point
//   accumulation, so the committed PixelEditCommand only stores a small slice
//   instead of the entire layer.

import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Layer, CanvasLike, Ctx2D, CanvasFactory } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { Color } from "../util/Color.js";

interface Bbox { minX: number; minY: number; maxX: number; maxY: number; }

interface DragState {
  layer: Layer;
  shadow: CanvasLike;
  shadowCtx: Ctx2D;
  start: { x: number; y: number };
  last: { x: number; y: number };
  bbox: Bbox;
}

function newBbox(x: number, y: number): Bbox {
  return { minX: x, minY: y, maxX: x, maxY: y };
}
function expandBbox(b: Bbox, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}
function bboxToRect(b: Bbox, padding: number, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.floor(b.minX - padding));
  const y0 = Math.max(0, Math.floor(b.minY - padding));
  const x1 = Math.min(w, Math.ceil(b.maxX + padding + 1));
  const y1 = Math.min(h, Math.ceil(b.maxY + padding + 1));
  if (x1 <= x0 || y1 <= y0) return Rect.empty();
  return Rect.create(x0, y0, x1 - x0, y1 - y0);
}

function snapshotLayer(layer: Layer, factory: CanvasFactory): { canvas: CanvasLike; ctx: Ctx2D } {
  const c = factory(layer.width, layer.height);
  const cx = c.getContext("2d");
  if (!cx) throw new Error("snapshotLayer: no 2d context");
  (cx as Ctx2D).drawImage(layer.getCanvas() as unknown);
  return { canvas: c, ctx: cx as Ctx2D };
}

function restoreFromShadow(layer: Layer, shadow: CanvasLike): void {
  const ctx = layer.getCtx();
  ctx.clearRect(0, 0, layer.width, layer.height);
  ctx.drawImage(shadow as unknown);
}

function commitFromShadow(toolCtx: ToolContext, state: DragState, label: string, padding: number): void {
  const r = bboxToRect(state.bbox, padding, state.layer.width, state.layer.height);
  if (Rect.isEmpty(r)) return;
  const before = state.shadowCtx.getImageData(r.x, r.y, r.w, r.h);
  const after = state.layer.getCtx().getImageData(r.x, r.y, r.w, r.h);
  toolCtx.history.execute(
    new PixelEditCommand({
      layerId: state.layer.id,
      rect: r,
      before: { width: before.width, height: before.height, data: new Uint8ClampedArray(before.data) },
      after: { width: after.width, height: after.height, data: new Uint8ClampedArray(after.data) },
      label,
    }),
    { stack: toolCtx.stack }
  );
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
    // Stamp a dot at start so single click leaves a mark.
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
      // Find the corresponding mirrored "last" point so each mirror line
      // is drawn from its own previous position.
      const dxLast = drag.last.x;
      const dyLast = drag.last.y;
      // Apply same axis flip to last point.
      let lx = dxLast, ly = dyLast;
      const w = drag.layer.width;
      const h = drag.layer.height;
      if (x !== p.x) lx = w - 1 - dxLast;
      if (y !== p.y) ly = h - 1 - dyLast;
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
    commitFromShadow(ctx, this.drag, this.eraseMode ? "Eraser" : "Pencil", ctx.settings.brushSize + 4);
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
    // If down/up happened without a move, we still want to commit a small shape.
    if (this.drag.bbox.minX === this.drag.bbox.maxX && this.drag.bbox.minY === this.drag.bbox.maxY) {
      this.onPointerMove(p, ctx);
    }
    commitFromShadow(ctx, this.drag, this.id, ctx.settings.brushSize + 4);
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
