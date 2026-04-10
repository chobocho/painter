// TextTool: places a Korean/ASCII string on the active layer.
//
// Interaction model (no prompt popup):
//   1. Pointer-down: a small floating <input> appears at the click position
//      on the canvas parent element.
//   2. User types and presses Enter (or clicks outside / presses Escape).
//   3. On commit: the text is rendered via fillText and committed as a
//      PixelEditCommand — so Ctrl+Z undoes it like any other stroke.
//
// When running in a non-DOM environment (Node tests), `setNextText(s)` injects
// the string directly, bypassing the overlay entirely.

import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Color } from "../util/Color.js";
import { snapshotLayer, commitStroke, newBbox, expandBbox } from "./StrokeUtil.js";

export class TextTool implements Tool {
  id = "text";
  cursor = "text";
  /** Test seam: the next call to onPointerDown uses this string instead of
   *  creating an overlay input. Cleared after one use. */
  private queuedText: string | null = null;

  setNextText(s: string): void { this.queuedText = s; }

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;

    // In-test path: use the queued string without any DOM work.
    if (this.queuedText !== null) {
      const text = this.queuedText;
      this.queuedText = null;
      this._stamp(text, p, ctx, layer);
      return;
    }

    // Browser path: create an overlay <input> so the user can type directly
    // on the canvas without a popup dialog.  We look for the canvas element's
    // parent because that's a positioned container in the layout.
    const g = globalThis as unknown as {
      document?: {
        createElement(tag: string): HTMLInputElement;
        body?: HTMLElement;
      };
    };
    if (!g.document) {
      // Headless / no DOM — fall back to prompt() as a last resort.
      const gp = globalThis as unknown as { prompt?: (...args: unknown[]) => string | null };
      if (typeof gp.prompt === "function") {
        const text = gp.prompt("텍스트를 입력하세요") ?? null;
        if (text && text.length > 0) this._stamp(text, p, ctx, layer);
      }
      return;
    }

    const input = g.document.createElement("input") as HTMLInputElement;
    input.type = "text";
    input.placeholder = "텍스트 입력 후 Enter";
    // Position near the click. We need a positioned ancestor; use body as
    // fallback if we cannot walk up to #canvas-area.
    const canvas = (ctx.stack as unknown as { _canvasEl?: HTMLElement })._canvasEl
      ?? (g as unknown as Record<string, unknown>)["document"];

    // Lay the overlay over the canvas area using fixed positioning with a
    // slight offset from the pointer so it doesn't cover the click point.
    input.style.cssText = [
      "position:fixed",
      `left:${Math.min(p.x + 8, window.innerWidth - 220)}px`,
      `top:${Math.min(p.y + 4, window.innerHeight - 50)}px`,
      "width:200px",
      "z-index:9999",
      "font-size:16px",
      "padding:4px 8px",
      "border:2px solid #0af",
      "border-radius:4px",
      "background:#fff",
      "color:#000",
    ].join(";");

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const commit = () => {
      const text = input.value.trim();
      cleanup();
      if (text.length > 0) this._stamp(text, p, ctx, layer);
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); cleanup(); }
    });
    input.addEventListener("blur", () => commit());

    const body = (g.document as unknown as { body?: HTMLElement }).body;
    if (body) {
      body.appendChild(input as unknown as HTMLElement);
      (input as unknown as { focus?: () => void }).focus?.();
    }
  }

  private _stamp(text: string, p: ToolPointer, ctx: ToolContext, layer: import("../core/Layer.js").Layer): void {
    const shadow = snapshotLayer(layer, ctx.stack.factory);
    const fontPx = Math.max(12, ctx.settings.brushSize * 6);
    const lctx = layer.getCtx();
    lctx.save();
    lctx.fillStyle = Color.toCss(ctx.settings.color);
    (lctx as unknown as { font?: string }).font = `${fontPx}px sans-serif`;
    (lctx as unknown as { textBaseline?: string }).textBaseline = "top";
    const fillText = (lctx as unknown as { fillText?: (t: string, x: number, y: number) => void }).fillText;
    if (typeof fillText === "function") {
      fillText.call(lctx, text, p.x, p.y);
    } else {
      // Fallback: solid rect proportional to font size (test environments).
      lctx.fillRect(p.x, p.y, text.length * Math.round(fontPx * 0.6), fontPx);
    }
    lctx.restore();

    const approxW = text.length * Math.round(fontPx * 0.6) + 4;
    const bbox = newBbox(p.x, p.y);
    expandBbox(bbox, p.x + approxW, p.y + fontPx);
    ctx.stack.markDirty({ x: Math.floor(p.x), y: Math.floor(p.y), w: approxW + 4, h: fontPx + 4 });

    commitStroke(ctx, layer, shadow.ctx, bbox, 4, `Text "${text.slice(0, 12)}"`);
  }

  onPointerMove(_p: ToolPointer, _ctx: ToolContext): void { /* input overlay handles its own events */ }
  onPointerUp(_p: ToolPointer, _ctx: ToolContext): void { /* single-shot */ }
  onPointerCancel(_ctx: ToolContext): void { this.queuedText = null; }
}
