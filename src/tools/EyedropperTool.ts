import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { getPixel } from "./ToolHelpers.js";

/**
 * Reads the pixel under the pointer from a composite snapshot if available,
 * else from the active layer. Updates the active color in tool settings.
 * Does not push a history command (tool-state only).
 */
export class EyedropperTool implements Tool {
  id = "eyedropper";
  cursor = "crosshair";

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const source = ctx.composite ?? ctx.stack.getActive();
    if (!source) return;
    const buf = source.getPixels(0, 0, source.width, source.height);
    const c = getPixel(buf, Math.floor(p.x), Math.floor(p.y));
    if (c.a > 0) {
      ctx.settings.color = c;
    }
  }
  onPointerMove(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerUp(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerCancel(_ctx: ToolContext): void {}
}
