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

  /** 픽셀이 바뀔 때마다 오르는 값. 직렬화 캐시 무효화에만 쓴다. */
  private revision = 0;
  private serializeCache: { revision: number; compact: boolean; snapshot: LayerSnapshot } | null = null;

  get width(): number { return this.canvas.width; }
  get height(): number { return this.canvas.height; }
  getCanvas(): CanvasLike { return this.canvas; }

  /**
   * 그리기용 컨텍스트. 넘겨주는 순간 픽셀이 바뀔 수 있다고 보고 직렬화 캐시를
   * 버린다. 실제로 안 그렸어도 손해는 재직렬화 한 번뿐이고, 낡은 스냅샷을
   * 저장하는 일은 절대 없다. 읽기 전용 경로(getPixels)는 캐시를 유지한다.
   */
  getCtx(): Ctx2D {
    this.revision++;
    return this.ctx;
  }

  clear(x = 0, y = 0, w = this.width, h = this.height): void {
    this.revision++;
    this.ctx.clearRect(x, y, w, h);
  }

  getPixels(x: number, y: number, w: number, h: number): { width: number; height: number; data: Uint8ClampedArray } {
    return this.ctx.getImageData(x, y, w, h);
  }

  putPixels(img: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number): void {
    this.revision++;
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
    const compact = !!opts.compact;
    const meta = this.cloneSnapshotMeta();
    // 픽셀이 그대로면 지난 결과를 재사용한다. 자동 저장이 5초마다 모든 레이어를
    // 다시 인코딩하던 비용이 여기서 사라진다. 메타(이름·투명도 등)는 캐시와
    // 무관하게 바뀔 수 있으므로 항상 최신 값을 덮어씌운다.
    const cached = this.serializeCache;
    if (cached && cached.revision === this.revision && cached.compact === compact) {
      return { ...cached.snapshot, ...meta };
    }

    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    let snapshot: LayerSnapshot;
    if (!compact) {
      snapshot = { ...meta, rawRGBA: encodeBase64(img.data) };
    } else if (isAllTransparent(img.data)) {
      snapshot = { ...meta };
    } else {
      const rle = rleEncodeRGBA(img.data);
      // 노이즈가 많은 레이어(스프레이·사진)는 런이 잘게 쪼개져 RLE 가 raw 의
      // 1.5배까지 부푼다. 그럴 땐 raw 가 더 작다.
      snapshot = rle.length < img.data.length
        ? { ...meta, rleRGBA: encodeBase64(rle) }
        : { ...meta, rawRGBA: encodeBase64(img.data) };
    }
    this.serializeCache = { revision: this.revision, compact, snapshot };
    return snapshot;
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
  // 최악의 경우(모든 픽셀이 서로 다름) 픽셀 하나가 6바이트 레코드 하나가 된다.
  // 그 크기로 한 번에 잡아 두면 JS number[] 를 쓸 때의 힙 부담(1920×1280 에서
  // 약 500MB 측정)이 사라진다. O(n) 시간, O(n) 추가 메모리.
  const n = data.length;
  const out = new Uint8ClampedArray(Math.ceil(n / 4) * 6);
  let o = 0;
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
    out[o++] = (count >> 8) & 0xff;
    out[o++] = count & 0xff;
    out[o++] = r;
    out[o++] = g;
    out[o++] = b;
    out[o++] = a;
    i = j;
  }
  return out.subarray(0, o);
}

export function rleDecodeRGBA(src: Uint8ClampedArray, expectedBytes: number): Uint8ClampedArray {
  // 손상된 저장본을 조용히 깨진 픽셀로 만들지 않는다. 런 하나는 정확히 6바이트
  // (count 2 + RGBA 4)이고, 풀어낸 길이는 기대 크기와 맞아야 한다.
  if (src.length % 6 !== 0) {
    throw new Error(`rleDecodeRGBA: 손상된 RLE 길이 ${src.length} (6의 배수가 아님)`);
  }
  const out = new Uint8ClampedArray(expectedBytes);
  let o = 0;
  for (let i = 0; i < src.length; i += 6) {
    const count = ((src[i]! << 8) | src[i + 1]!) & 0xffff;
    const r = src[i + 2]!, g = src[i + 3]!, b = src[i + 4]!, a = src[i + 5]!;
    if (o + count * 4 > expectedBytes) {
      throw new Error(`rleDecodeRGBA: 기대 크기 ${expectedBytes} 를 넘는 데이터`);
    }
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
  // 브라우저 폴백. 바이트마다 문자열을 이어붙이면 9.8MB 레이어 한 장에
  // 1.6초가 걸린다. 청크 단위로 fromCharCode.apply 를 쓰면 같은 결과를
  // 훨씬 적은 문자열 할당으로 만든다. 청크는 인자 개수 한계를 넘지 않도록
  // 8K 로 잡았다. O(n) 시간, O(n) 추가 메모리.
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, data.length);
    parts.push(String.fromCharCode.apply(null, Array.prototype.slice.call(data, i, end) as number[]));
  }
  const bin = parts.join("");
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
