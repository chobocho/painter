import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";

export class FillBucketTool implements Tool {
  id = "fill";
  cursor = "crosshair";

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;

    const sx = Math.floor(p.x);
    const sy = Math.floor(p.y);
    if (sx < 0 || sy < 0 || sx >= layer.width || sy >= layer.height) return;

    const lctx = layer.getCtx();
    const beforeImage = lctx.getImageData(0, 0, layer.width, layer.height);
    const beforeCopy = new Uint8ClampedArray(beforeImage.data);
    const region = lctx.getImageData(0, 0, layer.width, layer.height);

    const startIdx = (sy * region.width + sx) * 4;
    const target = [
      region.data[startIdx]!,
      region.data[startIdx + 1]!,
      region.data[startIdx + 2]!,
      region.data[startIdx + 3]!,
    ];
    const replacement = ctx.settings.color;
    if (
      target[0] === replacement.r &&
      target[1] === replacement.g &&
      target[2] === replacement.b &&
      target[3] === replacement.a
    ) return;
    const tol2 = ctx.settings.tolerance * ctx.settings.tolerance * 3;

    const matches = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= region.width || y >= region.height) return false;
      const i = (y * region.width + x) * 4;
      const dr = region.data[i]! - target[0]!;
      const dg = region.data[i + 1]! - target[1]!;
      const db = region.data[i + 2]! - target[2]!;
      const da = region.data[i + 3]! - target[3]!;
      return dr * dr + dg * dg + db * db + da * da <= tol2;
    };
    const set = (x: number, y: number) => {
      const i = (y * region.width + x) * 4;
      region.data[i] = replacement.r;
      region.data[i + 1] = replacement.g;
      region.data[i + 2] = replacement.b;
      region.data[i + 3] = replacement.a;
    };

    // Iterative scanline flood fill.
    const stack: number[] = [sx, sy];
    while (stack.length > 0) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      if (!matches(x, y)) continue;
      let xl = x;
      while (xl >= 0 && matches(xl, y)) xl--;
      xl++;
      let xr = x;
      while (xr < region.width && matches(xr, y)) xr++;
      xr--;
      for (let xx = xl; xx <= xr; xx++) {
        set(xx, y);
        if (y > 0 && matches(xx, y - 1)) stack.push(xx, y - 1);
        if (y < region.height - 1 && matches(xx, y + 1)) stack.push(xx, y + 1);
      }
    }

    lctx.putImageData(region, 0, 0);
    const r = Rect.create(0, 0, layer.width, layer.height);
    ctx.history.execute(
      new PixelEditCommand({
        layerId: layer.id,
        rect: r,
        before: { width: beforeImage.width, height: beforeImage.height, data: beforeCopy },
        after: { width: region.width, height: region.height, data: new Uint8ClampedArray(region.data) },
        label: "Fill",
      }),
      { stack: ctx.stack }
    );
    ctx.stack.markDirty(r);
  }

  onPointerMove(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerUp(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerCancel(_ctx: ToolContext): void {}
}
