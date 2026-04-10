import { RGBA } from "../util/Color.js";

/**
 * Chroma-key background removal with anti-aliased feather edge.
 *
 * @param src       source ImageData (will not be mutated)
 * @param key       background color to remove
 * @param tolerance Euclidean RGB distance below which pixels become fully transparent (0..441)
 * @param feather   width of the soft edge band beyond the tolerance ring
 * @returns         a new ImageData with the background removed
 */
export function removeBackground(
  src: { width: number; height: number; data: Uint8ClampedArray },
  key: RGBA,
  tolerance: number,
  feather: number
): { width: number; height: number; data: Uint8ClampedArray } {
  const out = new Uint8ClampedArray(src.data);
  const tol = tolerance;
  const tol2 = tol * tol;
  const outer = tol + Math.max(0, feather);
  const outer2 = outer * outer;
  for (let i = 0; i < out.length; i += 4) {
    const dr = out[i]! - key.r;
    const dg = out[i + 1]! - key.g;
    const db = out[i + 2]! - key.b;
    const d2 = dr * dr + dg * dg + db * db;
    if (d2 <= tol2) {
      out[i + 3] = 0;
    } else if (d2 <= outer2 && feather > 0) {
      const d = Math.sqrt(d2);
      const t = (d - tol) / feather;
      out[i + 3] = Math.max(0, Math.min(255, Math.round(out[i + 3]! * t)));
    }
  }
  return { width: src.width, height: src.height, data: out };
}
