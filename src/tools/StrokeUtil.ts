// Shared helpers used by every drawing tool. Centralized so the
// snapshot/restore logic exists in exactly one place — the round-2 bug
// where 11 separate snapshotLayer copies all called drawImage with too
// few arguments motivated this refactor.

import { Layer, CanvasLike, Ctx2D, CanvasFactory } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { ToolContext } from "./Tool.js";

export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ShadowSnapshot {
  canvas: CanvasLike;
  ctx: Ctx2D;
}

export function newBbox(x: number, y: number): Bbox {
  return { minX: x, minY: y, maxX: x, maxY: y };
}

export function expandBbox(b: Bbox, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

export function bboxToRect(b: Bbox, padding: number, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.floor(b.minX - padding));
  const y0 = Math.max(0, Math.floor(b.minY - padding));
  const x1 = Math.min(w, Math.ceil(b.maxX + padding + 1));
  const y1 = Math.min(h, Math.ceil(b.maxY + padding + 1));
  if (x1 <= x0 || y1 <= y0) return Rect.empty();
  return Rect.create(x0, y0, x1 - x0, y1 - y0);
}

/**
 * Capture the layer's pixels onto a fresh offscreen canvas. Uses the 3-arg
 * drawImage form (`drawImage(src, 0, 0)`) which is the minimum legal call
 * in the real DOM Canvas API. Browsers throw a TypeError on 1-arg calls.
 */
export function snapshotLayer(layer: Layer, factory: CanvasFactory): ShadowSnapshot {
  const c = factory(layer.width, layer.height);
  const cx = c.getContext("2d");
  if (!cx) throw new Error("snapshotLayer: no 2d context");
  (cx as Ctx2D).drawImage(layer.getCanvas() as unknown, 0, 0);
  return { canvas: c, ctx: cx as Ctx2D };
}

/**
 * Restore a layer's pixels from a previously captured shadow snapshot.
 * Used by every shape tool's rubber-band preview.
 */
export function restoreFromShadow(layer: Layer, shadow: CanvasLike): void {
  const ctx = layer.getCtx();
  ctx.clearRect(0, 0, layer.width, layer.height);
  ctx.drawImage(shadow as unknown, 0, 0);
}

/**
 * Build a PixelEditCommand from a stroke's bounding rect, sliced from the
 * shadow (`before`) and the live layer (`after`).
 */
export function commitStroke(
  toolCtx: ToolContext,
  layer: Layer,
  shadowCtx: Ctx2D,
  bbox: Bbox,
  padding: number,
  label: string
): void {
  const r = bboxToRect(bbox, padding, layer.width, layer.height);
  if (Rect.isEmpty(r)) return;
  const before = shadowCtx.getImageData(r.x, r.y, r.w, r.h);
  const after = layer.getCtx().getImageData(r.x, r.y, r.w, r.h);
  toolCtx.history.execute(
    new PixelEditCommand({
      layerId: layer.id,
      rect: r,
      before: { width: before.width, height: before.height, data: new Uint8ClampedArray(before.data) },
      after: { width: after.width, height: after.height, data: new Uint8ClampedArray(after.data) },
      label,
    }),
    { stack: toolCtx.stack }
  );
}
