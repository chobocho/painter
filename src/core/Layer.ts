import { Uid } from "../util/Uid.js";

export type BlendMode = "source-over" | "multiply" | "screen" | "overlay";

export interface LayerSnapshot {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  width: number;
  height: number;
  pngBase64?: string;       // for serialized save
  rawRGBA?: string;         // base64 RGBA fallback when no PNG encoder available
}

// Tiny structural types so this module compiles in environments without DOM lib too.
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): Ctx2D | null;
}

export interface Ctx2D {
  canvas: CanvasLike;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, s: number, e: number, ccw?: boolean): void;
  ellipse(x: number, y: number, a: number, b: number, r: number, s: number, e: number, ccw?: boolean): void;
  stroke(): void;
  fill(): void;
  drawImage(...args: unknown[]): void;
  getImageData(x: number, y: number, w: number, h: number): { width: number; height: number; data: Uint8ClampedArray };
  putImageData(img: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number): void;
  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray };
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

export type CanvasFactory = (w: number, h: number) => CanvasLike;

export const defaultCanvasFactory: CanvasFactory = (w, h) => {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas") as unknown as CanvasLike;
    c.width = w;
    c.height = h;
    return c;
  }
  // Fallback shouldn't be hit at runtime; tests inject their own factory.
  throw new Error("No canvas factory available; provide one explicitly.");
};

export class Layer {
  readonly id: string;
  name: string;
  visible: boolean = true;
  opacity: number = 1;
  blendMode: BlendMode = "source-over";
  locked: boolean = false;

  private canvas: CanvasLike;
  private ctx: Ctx2D;

  constructor(opts: {
    id?: string;
    name?: string;
    width: number;
    height: number;
    factory: CanvasFactory;
  }) {
    this.id = opts.id ?? Uid.next();
    this.name = opts.name ?? "Layer";
    this.canvas = opts.factory(opts.width, opts.height);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to acquire 2d context");
    this.ctx = ctx;
  }

  get width(): number { return this.canvas.width; }
  get height(): number { return this.canvas.height; }
  getCanvas(): CanvasLike { return this.canvas; }
  getCtx(): Ctx2D { return this.ctx; }

  clear(x = 0, y = 0, w = this.width, h = this.height): void {
    this.ctx.clearRect(x, y, w, h);
  }

  getPixels(x: number, y: number, w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    return this.ctx.getImageData(x, y, w, h);
  }

  putPixels(img: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number): void {
    this.ctx.putImageData(img, x, y);
  }

  cloneSnapshotMeta(): Omit<LayerSnapshot, "pngBase64" | "rawRGBA"> {
    return {
      id: this.id,
      name: this.name,
      visible: this.visible,
      opacity: this.opacity,
      blendMode: this.blendMode,
      locked: this.locked,
      width: this.width,
      height: this.height,
    };
  }

  serialize(): LayerSnapshot {
    const meta = this.cloneSnapshotMeta();
    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    return { ...meta, rawRGBA: encodeBase64(img.data) };
  }

  static deserialize(snap: LayerSnapshot, factory: CanvasFactory): Layer {
    const layer = new Layer({
      id: snap.id,
      name: snap.name,
      width: snap.width,
      height: snap.height,
      factory,
    });
    layer.visible = snap.visible;
    layer.opacity = snap.opacity;
    layer.blendMode = snap.blendMode;
    layer.locked = snap.locked;
    if (snap.rawRGBA) {
      const data = decodeBase64(snap.rawRGBA);
      layer.ctx.putImageData({ width: snap.width, height: snap.height, data }, 0, 0);
    }
    return layer;
  }
}

export function encodeBase64(data: Uint8ClampedArray): string {
  const g = globalThis as unknown as { Buffer?: { from(d: Uint8Array): { toString(enc: string): string } } };
  if (g.Buffer) {
    return g.Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]!);
  const g2 = globalThis as unknown as { btoa?: (s: string) => string };
  return g2.btoa ? g2.btoa(bin) : bin;
}

export function decodeBase64(s: string): Uint8ClampedArray {
  const g = globalThis as unknown as { Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (g.Buffer) {
    const buf = g.Buffer.from(s, "base64");
    return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const g2 = globalThis as unknown as { atob?: (s: string) => string };
  const bin = g2.atob ? g2.atob(s) : s;
  const out = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
