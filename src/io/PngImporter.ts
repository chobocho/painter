// PNG file → Layer. Uses createImageBitmap when available; falls back to a
// regular HTMLImageElement otherwise. The new layer is sized to fit inside
// the destination project.

import { Layer, CanvasFactory } from "../core/Layer.js";

export async function importPngFile(
  file: File,
  projectWidth: number,
  projectHeight: number,
  factory: CanvasFactory,
  name?: string
): Promise<Layer> {
  const bitmap = await loadBitmap(file);
  const fit = fitInside(bitmap.width, bitmap.height, projectWidth, projectHeight);
  const layer = new Layer({ name: name ?? file.name, width: projectWidth, height: projectHeight, factory });
  const ctx = layer.getCtx();
  // 5-arg drawImage(source, dx, dy, dw, dh). The 9-arg form with explicit
  // source rect was rejected by the strict canvas mock (and reportedly by
  // some Android browser builds) when the source was an HTMLImageElement
  // fallback — this simpler form scales the whole bitmap into fit.
  (ctx as any).drawImage(bitmap as unknown, fit.x, fit.y, fit.w, fit.h);
  return layer;
}

function fitInside(srcW: number, srcH: number, dstW: number, dstH: number): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(dstW / srcW, dstH / srcH, 1);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h };
}

async function loadBitmap(file: File): Promise<{ width: number; height: number }> {
  if (typeof (globalThis as any).createImageBitmap === "function") {
    return await (globalThis as any).createImageBitmap(file);
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
