import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { fullSnapshot, sliceImage, getPixel, setPixel } from "./ToolHelpers.js";
import { Color } from "../util/Color.js";

export class FillBucketTool implements Tool {
  id = "fill";
  cursor = "crosshair";

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;
    const before = fullSnapshot(layer);
    const buf = layer.getPixels(0, 0, layer.width, layer.height);

    const sx = Math.floor(p.x);
    const sy = Math.floor(p.y);
    if (sx < 0 || sy < 0 || sx >= buf.width || sy >= buf.height) return;

    const target = getPixel(buf, sx, sy);
    const replacement = ctx.settings.color;
    if (Color.equals(target, replacement)) return;
    const tol2 = ctx.settings.tolerance * ctx.settings.tolerance * 3;

    // Iterative scanline flood fill.
    const stack: number[] = [sx, sy];
    while (stack.length > 0) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) continue;
      const c = getPixel(buf, x, y);
      if (Color.distanceSq(c, target) > tol2) continue;
      // scan left
      let xl = x;
      while (xl >= 0 && Color.distanceSq(getPixel(buf, xl, y), target) <= tol2) xl--;
      xl++;
      let xr = x;
      while (xr < buf.width && Color.distanceSq(getPixel(buf, xr, y), target) <= tol2) xr++;
      xr--;
      for (let xx = xl; xx <= xr; xx++) {
        setPixel(buf, xx, y, replacement);
        if (y > 0 && Color.distanceSq(getPixel(buf, xx, y - 1), target) <= tol2) stack.push(xx, y - 1);
        if (y < buf.height - 1 && Color.distanceSq(getPixel(buf, xx, y + 1), target) <= tol2) stack.push(xx, y + 1);
      }
    }

    layer.putPixels(buf, 0, 0);
    const after = fullSnapshot(layer);
    const r = Rect.create(0, 0, layer.width, layer.height);
    ctx.history.execute(
      new PixelEditCommand({
        layerId: layer.id,
        rect: r,
        before: sliceImage(before, r, layer.width),
        after: sliceImage(after, r, layer.width),
        label: "Fill",
      }),
      { stack: ctx.stack }
    );
  }

  onPointerMove(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerUp(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerCancel(_ctx: ToolContext): void {}
}
