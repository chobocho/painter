// Minimal headless canvas/context implementation for Node tests.
// Backed by a Uint8ClampedArray of RGBA pixels. Implements just the surface
// area used by tools, layers, and the compositor.

export interface MockImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export class MockCanvasRenderingContext2D {
  canvas: MockHTMLCanvasElement;
  fillStyle: string = "#000000";
  strokeStyle: string = "#000000";
  lineWidth: number = 1;
  globalAlpha: number = 1;
  globalCompositeOperation: string = "source-over";
  imageSmoothingEnabled: boolean = true;
  lineCap: string = "butt";
  lineJoin: string = "miter";

  private _path: { x: number; y: number; type: "M" | "L" }[] = [];

  constructor(canvas: MockHTMLCanvasElement) {
    this.canvas = canvas;
  }

  setTransform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number): void {}
  scale(_x: number, _y: number): void {}
  translate(_x: number, _y: number): void {}
  save(): void {}
  restore(): void {}

  clearRect(x: number, y: number, w: number, h: number): void {
    this._fillRectInternal(x, y, w, h, [0, 0, 0, 0]);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const c = parseColor(this.fillStyle);
    c[3] = Math.round(c[3] * this.globalAlpha);
    this._fillRectInternal(x, y, w, h, c);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const c = parseColor(this.strokeStyle);
    c[3] = Math.round(c[3] * this.globalAlpha);
    // 1px outline only
    this._fillRectInternal(x, y, w, 1, c);
    this._fillRectInternal(x, y + h - 1, w, 1, c);
    this._fillRectInternal(x, y, 1, h, c);
    this._fillRectInternal(x + w - 1, y, 1, h, c);
  }

  beginPath(): void { this._path = []; }
  closePath(): void {}
  moveTo(x: number, y: number): void { this._path.push({ x, y, type: "M" }); }
  lineTo(x: number, y: number): void { this._path.push({ x, y, type: "L" }); }
  arc(_x: number, _y: number, _r: number, _s: number, _e: number): void {}
  ellipse(_x: number, _y: number, _a: number, _b: number, _r: number, _s: number, _e: number): void {}

  stroke(): void {
    const c = parseColor(this.strokeStyle);
    c[3] = Math.round(c[3] * this.globalAlpha);
    for (let i = 1; i < this._path.length; i++) {
      const a = this._path[i - 1]!;
      const b = this._path[i]!;
      this._line(a.x, a.y, b.x, b.y, c);
    }
  }

  fill(): void {}

  drawImage(src: MockHTMLCanvasElement, ...rest: number[]): void {
    if (rest.length === 2) {
      const [dx, dy] = rest as [number, number];
      this._blit(src, 0, 0, src.width, src.height, dx, dy, src.width, src.height);
    } else if (rest.length === 4) {
      const [dx, dy, dw, dh] = rest as [number, number, number, number];
      this._blit(src, 0, 0, src.width, src.height, dx, dy, dw, dh);
    } else if (rest.length === 8) {
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

  private _fillRectInternal(x: number, y: number, w: number, h: number, rgba: number[]): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.canvas.width, Math.floor(x + w));
    const y1 = Math.min(this.canvas.height, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const idx = (yy * this.canvas.width + xx) * 4;
        if (rgba[3] === 0 && this.globalCompositeOperation === "source-over") {
          // clearRect path
          this.canvas.pixels[idx] = 0;
          this.canvas.pixels[idx + 1] = 0;
          this.canvas.pixels[idx + 2] = 0;
          this.canvas.pixels[idx + 3] = 0;
        } else {
          this.canvas.pixels[idx] = rgba[0]!;
          this.canvas.pixels[idx + 1] = rgba[1]!;
          this.canvas.pixels[idx + 2] = rgba[2]!;
          this.canvas.pixels[idx + 3] = rgba[3]!;
        }
      }
    }
  }

  private _line(x0: number, y0: number, x1: number, y1: number, rgba: number[]): void {
    // Bresenham
    let xa = Math.round(x0), ya = Math.round(y0);
    const xb = Math.round(x1), yb = Math.round(y1);
    const dx = Math.abs(xb - xa);
    const dy = -Math.abs(yb - ya);
    const sx = xa < xb ? 1 : -1;
    const sy = ya < yb ? 1 : -1;
    let err = dx + dy;
    while (true) {
      this._fillRectInternal(xa, ya, 1, 1, rgba);
      if (xa === xb && ya === yb) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; xa += sx; }
      if (e2 <= dx) { err += dx; ya += sy; }
    }
  }

  private _blit(src: MockHTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
    // nearest-neighbour blit; respects globalAlpha
    for (let yy = 0; yy < dh; yy++) {
      for (let xx = 0; xx < dw; xx++) {
        const u = Math.floor(sx + (xx / dw) * sw);
        const v = Math.floor(sy + (yy / dh) * sh);
        if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
        const sIdx = (v * src.width + u) * 4;
        const dxp = dx + xx;
        const dyp = dy + yy;
        if (dxp < 0 || dyp < 0 || dxp >= this.canvas.width || dyp >= this.canvas.height) continue;
        const dIdx = (dyp * this.canvas.width + dxp) * 4;
        const sa = (src.pixels[sIdx + 3]! / 255) * this.globalAlpha;
        if (sa <= 0) continue;
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

  // When width/height are reassigned, the bitmap is reallocated (matching DOM behavior).
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

// Install on globalThis so DOM-typed code (`document.createElement('canvas')`) works in Node tests.
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
