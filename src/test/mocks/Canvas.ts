// Headless canvas/context for Node tests. Backed by a Uint8ClampedArray of
// RGBA pixels. Implements just enough surface area for tools, layers, and the
// compositor — including line/circle stamping, lineWidth, destination-out,
// drawImage between canvases, and getImageData/putImageData of arbitrary
// regions.

export interface MockImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type PathOp =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "A"; x: number; y: number; r: number }
  | { type: "E"; x: number; y: number; rx: number; ry: number };

export class MockCanvasRenderingContext2D {
  canvas: MockHTMLCanvasElement;
  fillStyle: string = "#000000";
  strokeStyle: string = "#000000";
  lineWidth: number = 1;
  lineCap: string = "butt";
  lineJoin: string = "miter";
  globalAlpha: number = 1;
  globalCompositeOperation: string = "source-over";
  imageSmoothingEnabled: boolean = true;

  private _path: PathOp[] = [];
  private _stateStack: Partial<MockCanvasRenderingContext2D>[] = [];

  constructor(canvas: MockHTMLCanvasElement) {
    this.canvas = canvas;
  }

  save(): void {
    this._stateStack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
    });
  }
  restore(): void {
    const s = this._stateStack.pop();
    if (!s) return;
    Object.assign(this, s);
  }

  setTransform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number): void {}
  scale(_x: number, _y: number): void {}
  translate(_x: number, _y: number): void {}

  clearRect(x: number, y: number, w: number, h: number): void {
    this._fillRectInternal(x, y, w, h, [0, 0, 0, 0], true);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const c = parseColor(this.fillStyle);
    this._fillRectInternal(x, y, w, h, c, false);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const c = parseColor(this.strokeStyle);
    const lw = Math.max(1, Math.floor(this.lineWidth));
    // Treat the rect as having corners at (x,y) and (x+w,y+h) inclusive,
    // matching how real canvas strokes a 1px line that straddles the edge.
    this._fillRectInternal(x, y, w + lw, lw, c, false);
    this._fillRectInternal(x, y + h, w + lw, lw, c, false);
    this._fillRectInternal(x, y, lw, h + lw, c, false);
    this._fillRectInternal(x + w, y, lw, h + lw, c, false);
  }

  beginPath(): void { this._path = []; }
  closePath(): void {}
  moveTo(x: number, y: number): void { this._path.push({ type: "M", x, y }); }
  lineTo(x: number, y: number): void { this._path.push({ type: "L", x, y }); }
  arc(x: number, y: number, r: number, _s: number, _e: number, _ccw?: boolean): void {
    this._path.push({ type: "A", x, y, r });
  }
  ellipse(x: number, y: number, rx: number, ry: number, _r: number, _s: number, _e: number, _ccw?: boolean): void {
    this._path.push({ type: "E", x, y, rx, ry });
  }

  stroke(): void {
    const c = parseColor(this.strokeStyle);
    const w = this.lineWidth;
    let last: { x: number; y: number } | null = null;
    for (const op of this._path) {
      if (op.type === "M") {
        last = { x: op.x, y: op.y };
      } else if (op.type === "L") {
        if (last) this._line(last.x, last.y, op.x, op.y, c, w);
        last = { x: op.x, y: op.y };
      } else if (op.type === "A") {
        this._strokeCircle(op.x, op.y, op.r, c, w);
      } else if (op.type === "E") {
        this._strokeEllipse(op.x, op.y, op.rx, op.ry, c, w);
      }
    }
  }

  fill(): void {
    const c = parseColor(this.fillStyle);
    for (const op of this._path) {
      if (op.type === "A") {
        this._fillCircle(op.x, op.y, op.r, c);
      } else if (op.type === "E") {
        this._fillEllipse(op.x, op.y, op.rx, op.ry, c);
      }
    }
    // Triangle / polygon fill: if path is M L L close, fill the triangle.
    const lines = this._path.filter((p) => p.type === "M" || p.type === "L") as ({ type: "M" | "L"; x: number; y: number }[]);
    if (lines.length >= 3 && lines[0]!.type === "M") {
      this._fillPolygon(lines.map((p) => ({ x: p.x, y: p.y })), c);
    }
  }

  drawImage(src: MockHTMLCanvasElement, ...rest: number[]): void {
    // Strict: matches the real CanvasRenderingContext2D contract. The legal
    // forms are 3, 5, or 9 total arguments (image + 2 / 4 / 8 numbers).
    // Anything else throws — exactly like a real browser does.
    if (rest.length !== 2 && rest.length !== 4 && rest.length !== 8) {
      throw new TypeError(
        `MockCanvas drawImage: expected 2, 4, or 8 numeric args after the source, got ${rest.length}. ` +
        `(Real browsers throw the same error: this is on purpose to keep tests honest.)`
      );
    }
    if (!src || typeof src.getContext !== "function") {
      throw new TypeError("MockCanvas drawImage: source is not a canvas-like object");
    }
    if (rest.length === 2) {
      const [dx, dy] = rest as [number, number];
      this._blit(src, 0, 0, src.width, src.height, dx, dy, src.width, src.height);
    } else if (rest.length === 4) {
      const [dx, dy, dw, dh] = rest as [number, number, number, number];
      this._blit(src, 0, 0, src.width, src.height, dx, dy, dw, dh);
    } else {
      const [sx, sy, sw, sh, dx, dy, dw, dh] = rest as [number, number, number, number, number, number, number, number];
      this._blit(src, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  }

  getImageData(x: number, y: number, w: number, h: number): MockImageData {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const sx = x + xx;
        const sy = y + yy;
        if (sx < 0 || sy < 0 || sx >= this.canvas.width || sy >= this.canvas.height) continue;
        const sIdx = (sy * this.canvas.width + sx) * 4;
        const dIdx = (yy * w + xx) * 4;
        out[dIdx] = this.canvas.pixels[sIdx]!;
        out[dIdx + 1] = this.canvas.pixels[sIdx + 1]!;
        out[dIdx + 2] = this.canvas.pixels[sIdx + 2]!;
        out[dIdx + 3] = this.canvas.pixels[sIdx + 3]!;
      }
    }
    return { width: w, height: h, data: out };
  }

  putImageData(img: MockImageData, x: number, y: number): void {
    for (let yy = 0; yy < img.height; yy++) {
      for (let xx = 0; xx < img.width; xx++) {
        const dx = x + xx;
        const dy = y + yy;
        if (dx < 0 || dy < 0 || dx >= this.canvas.width || dy >= this.canvas.height) continue;
        const dIdx = (dy * this.canvas.width + dx) * 4;
        const sIdx = (yy * img.width + xx) * 4;
        this.canvas.pixels[dIdx] = img.data[sIdx]!;
        this.canvas.pixels[dIdx + 1] = img.data[sIdx + 1]!;
        this.canvas.pixels[dIdx + 2] = img.data[sIdx + 2]!;
        this.canvas.pixels[dIdx + 3] = img.data[sIdx + 3]!;
      }
    }
  }

  createImageData(w: number, h: number): MockImageData {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  // ---- internal raster helpers --------------------------------------------

  private _putPixel(x: number, y: number, rgba: number[], isClear: boolean): void {
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const idx = (y * this.canvas.width + x) * 4;
    if (isClear) {
      this.canvas.pixels[idx] = 0;
      this.canvas.pixels[idx + 1] = 0;
      this.canvas.pixels[idx + 2] = 0;
      this.canvas.pixels[idx + 3] = 0;
      return;
    }
    if (this.globalCompositeOperation === "destination-out") {
      const sa = (rgba[3]! / 255) * this.globalAlpha;
      this.canvas.pixels[idx + 3] = Math.round(this.canvas.pixels[idx + 3]! * (1 - sa));
      return;
    }
    // source-over (and any other op falls through to plain replace).
    const sa = (rgba[3]! / 255) * this.globalAlpha;
    if (sa >= 1) {
      this.canvas.pixels[idx] = rgba[0]!;
      this.canvas.pixels[idx + 1] = rgba[1]!;
      this.canvas.pixels[idx + 2] = rgba[2]!;
      this.canvas.pixels[idx + 3] = 255;
    } else if (sa > 0) {
      const da = this.canvas.pixels[idx + 3]! / 255;
      const outA = sa + da * (1 - sa);
      const blend = (s: number, d: number) => Math.round((s * sa + d * da * (1 - sa)) / Math.max(0.001, outA));
      this.canvas.pixels[idx] = blend(rgba[0]!, this.canvas.pixels[idx]!);
      this.canvas.pixels[idx + 1] = blend(rgba[1]!, this.canvas.pixels[idx + 1]!);
      this.canvas.pixels[idx + 2] = blend(rgba[2]!, this.canvas.pixels[idx + 2]!);
      this.canvas.pixels[idx + 3] = Math.round(outA * 255);
    }
  }

  private _fillRectInternal(x: number, y: number, w: number, h: number, rgba: number[], isClear: boolean): void {
    const x0 = Math.max(0, Math.floor(Math.min(x, x + w)));
    const y0 = Math.max(0, Math.floor(Math.min(y, y + h)));
    const x1 = Math.min(this.canvas.width, Math.floor(Math.max(x, x + w)));
    const y1 = Math.min(this.canvas.height, Math.floor(Math.max(y, y + h)));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        this._putPixel(xx, yy, rgba, isClear);
      }
    }
  }

  private _stamp(cx: number, cy: number, radius: number, rgba: number[]): void {
    const r = Math.max(0, Math.floor(radius));
    if (r === 0) {
      this._putPixel(Math.round(cx), Math.round(cy), rgba, false);
      return;
    }
    const r2 = r * r;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r2) this._putPixel(Math.round(cx) + x, Math.round(cy) + y, rgba, false);
      }
    }
  }

  private _line(x0: number, y0: number, x1: number, y1: number, rgba: number[], width: number): void {
    let xa = Math.round(x0), ya = Math.round(y0);
    const xb = Math.round(x1), yb = Math.round(y1);
    const dx = Math.abs(xb - xa);
    const dy = -Math.abs(yb - ya);
    const sx = xa < xb ? 1 : -1;
    const sy = ya < yb ? 1 : -1;
    let err = dx + dy;
    const radius = Math.max(0, width / 2);
    while (true) {
      this._stamp(xa, ya, radius, rgba);
      if (xa === xb && ya === yb) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; xa += sx; }
      if (e2 <= dx) { err += dx; ya += sy; }
    }
  }

  private _strokeCircle(cx: number, cy: number, r: number, rgba: number[], width: number): void {
    const steps = Math.max(8, Math.floor(r * 6));
    let prevX = cx + r, prevY = cy;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      this._line(prevX, prevY, x, y, rgba, width);
      prevX = x;
      prevY = y;
    }
  }

  private _strokeEllipse(cx: number, cy: number, rx: number, ry: number, rgba: number[], width: number): void {
    const steps = Math.max(12, Math.floor(Math.max(rx, ry) * 6));
    let prevX = cx + rx, prevY = cy;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = cx + rx * Math.cos(a);
      const y = cy + ry * Math.sin(a);
      this._line(prevX, prevY, x, y, rgba, width);
      prevX = x;
      prevY = y;
    }
  }

  private _fillCircle(cx: number, cy: number, r: number, rgba: number[]): void {
    const ri = Math.ceil(r);
    const r2 = r * r;
    for (let y = -ri; y <= ri; y++) {
      for (let x = -ri; x <= ri; x++) {
        if (x * x + y * y <= r2) this._putPixel(Math.round(cx) + x, Math.round(cy) + y, rgba, false);
      }
    }
  }

  private _fillEllipse(cx: number, cy: number, rx: number, ry: number, rgba: number[]): void {
    const rxi = Math.ceil(rx);
    const ryi = Math.ceil(ry);
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    for (let y = -ryi; y <= ryi; y++) {
      for (let x = -rxi; x <= rxi; x++) {
        if ((x * x) / Math.max(1, rx2) + (y * y) / Math.max(1, ry2) <= 1) {
          this._putPixel(Math.round(cx) + x, Math.round(cy) + y, rgba, false);
        }
      }
    }
  }

  private _fillPolygon(points: { x: number; y: number }[], rgba: number[]): void {
    if (points.length < 3) return;
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
    const maxY = Math.min(this.canvas.height - 1, Math.ceil(Math.max(...points.map((p) => p.y))));
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          const t = (y - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      xs.sort((u, v) => u - v);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.max(0, Math.floor(xs[i]!));
        const x1 = Math.min(this.canvas.width - 1, Math.ceil(xs[i + 1]!));
        for (let x = x0; x <= x1; x++) this._putPixel(x, y, rgba, false);
      }
    }
  }

  private _blit(src: MockHTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
    const srcW = src.width;
    for (let yy = 0; yy < dh; yy++) {
      for (let xx = 0; xx < dw; xx++) {
        const u = Math.floor(sx + (xx / dw) * sw);
        const v = Math.floor(sy + (yy / dh) * sh);
        if (u < 0 || v < 0 || u >= srcW || v >= src.height) continue;
        const sIdx = (v * srcW + u) * 4;
        const sa = (src.pixels[sIdx + 3]! / 255) * this.globalAlpha;
        if (sa <= 0) continue;
        const dxp = dx + xx;
        const dyp = dy + yy;
        if (dxp < 0 || dyp < 0 || dxp >= this.canvas.width || dyp >= this.canvas.height) continue;
        const dIdx = (dyp * this.canvas.width + dxp) * 4;
        const da = this.canvas.pixels[dIdx + 3]! / 255;
        const outA = sa + da * (1 - sa);
        if (outA <= 0) continue;
        const blend = (s: number, d: number) => Math.round((s * sa + d * da * (1 - sa)) / outA);
        this.canvas.pixels[dIdx] = blend(src.pixels[sIdx]!, this.canvas.pixels[dIdx]!);
        this.canvas.pixels[dIdx + 1] = blend(src.pixels[sIdx + 1]!, this.canvas.pixels[dIdx + 1]!);
        this.canvas.pixels[dIdx + 2] = blend(src.pixels[sIdx + 2]!, this.canvas.pixels[dIdx + 2]!);
        this.canvas.pixels[dIdx + 3] = Math.round(outA * 255);
      }
    }
  }
}

export class MockHTMLCanvasElement {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  private _ctx: MockCanvasRenderingContext2D | null = null;

  constructor(w: number = 300, h: number = 150) {
    this.width = w;
    this.height = h;
    this.pixels = new Uint8ClampedArray(w * h * 4);
  }

  getContext(type: string): MockCanvasRenderingContext2D | null {
    if (type !== "2d") return null;
    if (!this._ctx) this._ctx = new MockCanvasRenderingContext2D(this);
    return this._ctx;
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.pixels = new Uint8ClampedArray(w * h * 4);
  }
}

function parseColor(s: string): number[] {
  if (s.startsWith("#")) {
    if (s.length === 4) {
      const r = parseInt(s[1]! + s[1]!, 16);
      const g = parseInt(s[2]! + s[2]!, 16);
      const b = parseInt(s[3]! + s[3]!, 16);
      return [r, g, b, 255];
    }
    if (s.length === 7) {
      const r = parseInt(s.slice(1, 3), 16);
      const g = parseInt(s.slice(3, 5), 16);
      const b = parseInt(s.slice(5, 7), 16);
      return [r, g, b, 255];
    }
    if (s.length === 9) {
      const r = parseInt(s.slice(1, 3), 16);
      const g = parseInt(s.slice(3, 5), 16);
      const b = parseInt(s.slice(5, 7), 16);
      const a = parseInt(s.slice(7, 9), 16);
      return [r, g, b, a];
    }
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1]!.split(",").map((p) => parseFloat(p.trim()));
    return [parts[0]!, parts[1]!, parts[2]!, parts[3] !== undefined ? Math.round(parts[3]! * 255) : 255];
  }
  const named: Record<string, number[]> = {
    red: [255, 0, 0, 255], green: [0, 128, 0, 255], blue: [0, 0, 255, 255],
    black: [0, 0, 0, 255], white: [255, 255, 255, 255], yellow: [255, 255, 0, 255],
    orange: [255, 165, 0, 255], pink: [255, 192, 203, 255], purple: [128, 0, 128, 255],
    gray: [128, 128, 128, 255], lightgray: [211, 211, 211, 255], lightblue: [173, 216, 230, 255],
    lightgreen: [144, 238, 144, 255], brown: [165, 42, 42, 255],
  };
  return named[s] ?? [0, 0, 0, 255];
}

export function installCanvasGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g["document"]) {
    g["document"] = {
      createElement(tag: string): MockHTMLCanvasElement | Record<string, unknown> {
        if (tag === "canvas") return new MockHTMLCanvasElement(300, 150);
        return {};
      },
    };
  }
  if (!g["HTMLCanvasElement"]) {
    g["HTMLCanvasElement"] = MockHTMLCanvasElement;
  }
}
