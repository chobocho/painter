import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { RGBA } from "../util/Color.js";
import { Ctx2D } from "../core/Layer.js";

/**
 * Reads the pixel under the pointer from the composite of all visible
 * layers (not just the active one) and updates `settings.color`. Also
 * fires `ctx.onColorPicked` so the Palette UI can sync — without this
 * callback the user gets no visual feedback that the pick worked.
 *
 * Composes only a 1x1 destination canvas. We don't `getImageData` over
 * the entire layer; that was the round-4 problem (slow on big projects).
 */
export class EyedropperTool implements Tool {
  id = "eyedropper";
  cursor = "crosshair";

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const stack = ctx.stack;
    if (px < 0 || py < 0 || px >= stack.width || py >= stack.height) return;

    // Build a 1x1 composite of every visible layer at (px, py).
    const tmp = stack.factory(1, 1);
    const tctx = tmp.getContext("2d") as Ctx2D | null;
    if (!tctx) return;
    for (const layer of stack.getAll()) {
      if (!layer.visible || layer.opacity <= 0) continue;
      tctx.globalAlpha = layer.opacity;
      tctx.globalCompositeOperation = layer.blendMode;
      // 9-arg drawImage: copy a 1x1 region from (px,py) to (0,0).
      tctx.drawImage(layer.getCanvas() as unknown, px, py, 1, 1, 0, 0, 1, 1);
    }
    tctx.globalAlpha = 1;
    tctx.globalCompositeOperation = "source-over";
    const data = tctx.getImageData(0, 0, 1, 1).data;
    const picked: RGBA = { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! };
    // If everything under the cursor is transparent, fall back to the
    // active layer's pixel so the user still gets *some* color.
    let final = picked;
    if (picked.a === 0) {
      const active = stack.getActive();
      if (active) {
        const d2 = active.getPixels(px, py, 1, 1).data;
        final = { r: d2[0]!, g: d2[1]!, b: d2[2]!, a: d2[3]! };
      }
    }
    ctx.settings.color = final;
    ctx.onColorPicked?.(final);
  }

  onPointerMove(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerUp(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerCancel(_ctx: ToolContext): void {}
}
