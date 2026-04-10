import { Layer } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { RGBA } from "../util/Color.js";

export function clonePixels(src: { width: number; height: number; data: Uint8ClampedArray }): { width: number; height: number; data: Uint8ClampedArray } {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

export function pixelsRect(layer: Layer, r: Rect): { width: number; height: number; data: Uint8ClampedArray } {
  return clonePixels(layer.getPixels(r.x, r.y, r.w, r.h));
}

export function clampRect(r: Rect, w: number, h: number): Rect {
  return Rect.intersect(r, Rect.create(0, 0, w, h));
}

export function setPixel(buf: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
  const i = (y * buf.width + x) * 4;
  buf.data[i] = c.r;
  buf.data[i + 1] = c.g;
  buf.data[i + 2] = c.b;
  buf.data[i + 3] = c.a;
}

export function getPixel(buf: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number): RGBA {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return { r: 0, g: 0, b: 0, a: 0 };
  const i = (y * buf.width + x) * 4;
  return { r: buf.data[i]!, g: buf.data[i + 1]!, b: buf.data[i + 2]!, a: buf.data[i + 3]! };
}

/** Bresenham line drawing into an ImageData-shaped buffer. */
export function plotLine(buf: { width: number; height: number; data: Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number, color: RGBA, brush: number): void {
  let xa = Math.round(x0), ya = Math.round(y0);
  const xb = Math.round(x1), yb = Math.round(y1);
  const dx = Math.abs(xb - xa);
  const dy = -Math.abs(yb - ya);
  const sx = xa < xb ? 1 : -1;
  const sy = ya < yb ? 1 : -1;
  let err = dx + dy;
  while (true) {
    plotBrush(buf, xa, ya, brush, color);
    if (xa === xb && ya === yb) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; xa += sx; }
    if (e2 <= dx) { err += dx; ya += sy; }
  }
}

export function plotBrush(buf: { width: number; height: number; data: Uint8ClampedArray }, cx: number, cy: number, size: number, color: RGBA): void {
  const r = Math.max(1, Math.floor(size / 2));
  const r2 = r * r;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r2) setPixel(buf, cx + x, cy + y, color);
    }
  }
}

export function plotRect(buf: { width: number; height: number; data: Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number, color: RGBA, filled: boolean, brush: number): void {
  const xa = Math.min(x0, x1);
  const ya = Math.min(y0, y1);
  const xb = Math.max(x0, x1);
  const yb = Math.max(y0, y1);
  if (filled) {
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) setPixel(buf, x, y, color);
    }
  } else {
    plotLine(buf, xa, ya, xb, ya, color, brush);
    plotLine(buf, xa, yb, xb, yb, color, brush);
    plotLine(buf, xa, ya, xa, yb, color, brush);
    plotLine(buf, xb, ya, xb, yb, color, brush);
  }
}

export function plotEllipse(buf: { width: number; height: number; data: Uint8ClampedArray }, cx: number, cy: number, rx: number, ry: number, color: RGBA, filled: boolean): void {
  rx = Math.max(1, Math.abs(rx));
  ry = Math.max(1, Math.abs(ry));
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const v = (x * x) / rx2 + (y * y) / ry2;
      if (filled) {
        if (v <= 1) setPixel(buf, cx + x, cy + y, color);
      } else {
        if (v <= 1 && v >= 1 - 0.15) setPixel(buf, cx + x, cy + y, color);
      }
    }
  }
}

export function plotTriangle(buf: { width: number; height: number; data: Uint8ClampedArray }, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: RGBA, filled: boolean): void {
  if (!filled) {
    plotLine(buf, x1, y1, x2, y2, color, 1);
    plotLine(buf, x2, y2, x3, y3, color, 1);
    plotLine(buf, x3, y3, x1, y1, color, 1);
    return;
  }
  const minX = Math.max(0, Math.min(x1, x2, x3));
  const maxX = Math.min(buf.width - 1, Math.max(x1, x2, x3));
  const minY = Math.max(0, Math.min(y1, y2, y3));
  const maxY = Math.min(buf.height - 1, Math.max(y1, y2, y3));
  const sign = (a: number, b: number, c: number, d: number, e: number, f: number) =>
    (a - e) * (d - f) - (c - e) * (b - f);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d1 = sign(x, y, x1, y1, x2, y2);
      const d2 = sign(x, y, x2, y2, x3, y3);
      const d3 = sign(x, y, x3, y3, x1, y1);
      const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
      const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
      if (!(neg && pos)) setPixel(buf, x, y, color);
    }
  }
}

export function commitDelta(layer: Layer, rect: Rect, beforeFull: { width: number; height: number; data: Uint8ClampedArray }, afterFull: { width: number; height: number; data: Uint8ClampedArray }): { before: any; after: any } {
  // beforeFull/afterFull are at layer's full size; slice them down to rect.
  const sliceBefore = sliceImage(beforeFull, rect, layer.width);
  const sliceAfter = sliceImage(afterFull, rect, layer.width);
  return { before: sliceBefore, after: sliceAfter };
}

export function sliceImage(src: { width: number; height: number; data: Uint8ClampedArray }, rect: Rect, _layerWidth: number): { width: number; height: number; data: Uint8ClampedArray } {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const sx = rect.x + x;
      const sy = rect.y + y;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const sIdx = (sy * src.width + sx) * 4;
      const dIdx = (y * rect.w + x) * 4;
      out[dIdx] = src.data[sIdx]!;
      out[dIdx + 1] = src.data[sIdx + 1]!;
      out[dIdx + 2] = src.data[sIdx + 2]!;
      out[dIdx + 3] = src.data[sIdx + 3]!;
    }
  }
  return { width: rect.w, height: rect.h, data: out };
}

export function fullSnapshot(layer: Layer): { width: number; height: number; data: Uint8ClampedArray } {
  return clonePixels(layer.getPixels(0, 0, layer.width, layer.height));
}
