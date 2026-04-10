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
  pngBase64?: string;       // reserved for future PNG-encoder path
  rawRGBA?: string;         // base64 of raw RGBA bytes (legacy/uncompressed)
  rleRGBA?: string;         // base64 of run-length-encoded RGBA (compact form)
}

export interface SerializeOpts {
  /**
   * When true, the serializer drops pixel data entirely for blank layers and
   * RLE-compresses everything else. Used by the project save path so a white
   * 1920x1280 background shrinks from ~13 MB to a few hundred bytes instead
   * of blowing up the exported JSON.
   */
  compact?: boolean;
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
  putImageData(img: ImageData | { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number): void;
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
    let out: ImageData | { width: number; height: number; data: Uint8ClampedArray } = img;
    if (typeof ImageData !== "undefined" && !(img instanceof ImageData)) {
      out = new ImageData(img.data as any, img.width, img.height);
    }
    this.ctx.putImageData(out, x, y);
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

  serialize(opts: SerializeOpts = {}): LayerSnapshot {
    const meta = this.cloneSnapshotMeta();
    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    if (!opts.compact) {
      return { ...meta, rawRGBA: encodeBase64(img.data) };
    }
    // Compact path: detect blank, else RLE-compress.
    if (isAllTransparent(img.data)) {
      return { ...meta };
    }
    const rle = rleEncodeRGBA(img.data);
    return { ...meta, rleRGBA: encodeBase64(rle) };
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
    const expected = snap.width * snap.height * 4;
    if (snap.rleRGBA && snap.rleRGBA.length > 0) {
      const compressed = decodeBase64(snap.rleRGBA);
      const data = rleDecodeRGBA(compressed, expected);
      layer.putPixels({ width: snap.width, height: snap.height, data }, 0, 0);
    } else if (snap.rawRGBA && snap.rawRGBA.length > 0) {
      const data = decodeBase64(snap.rawRGBA);
      layer.putPixels({ width: snap.width, height: snap.height, data }, 0, 0);
    }
    // otherwise leave the layer blank (compact save for transparent layers)
    return layer;
  }
}

function isAllTransparent(d: Uint8ClampedArray): boolean {
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
}

/**
 * Simple RLE for RGBA pixels. Encoded as a sequence of 6-byte records —
 * [countHi, countLo, r, g, b, a] — so one run can cover up to 65 535 pixels
 * of the same colour. A solid 1920×1280 background shrinks from ~10 MB raw
 * → ~40 records ≈ 240 bytes before base64, ~320 bytes after.
 */
export function rleEncodeRGBA(data: Uint8ClampedArray): Uint8ClampedArray {
  const out: number[] = [];
  const n = data.length;
  let i = 0;
  while (i < n) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
    let count = 1;
    let j = i + 4;
    while (j < n && count < 65535 &&
      data[j] === r && data[j + 1] === g && data[j + 2] === b && data[j + 3] === a) {
      count++;
      j += 4;
    }
    out.push((count >> 8) & 0xff, count & 0xff, r, g, b, a);
    i = j;
  }
  return new Uint8ClampedArray(out);
}

export function rleDecodeRGBA(src: Uint8ClampedArray, expectedBytes: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(expectedBytes);
  let o = 0;
  for (let i = 0; i + 5 < src.length + 1; i += 6) {
    const count = ((src[i]! << 8) | src[i + 1]!) & 0xffff;
    const r = src[i + 2]!, g = src[i + 3]!, b = src[i + 4]!, a = src[i + 5]!;
    for (let k = 0; k < count; k++) {
      out[o++] = r;
      out[o++] = g;
      out[o++] = b;
      out[o++] = a;
    }
  }
  return out;
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
