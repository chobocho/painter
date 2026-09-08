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

    // position:fixed 는 화면(viewport) 좌표계다. 예전에는 프로젝트 좌표 p.x/p.y 를
    // 그대로 써서, 화면보다 큰 프로젝트에서는 오버레이가 엉뚱한 곳에 떴다.
    const screenX = p.clientX ?? p.x;
    const screenY = p.clientY ?? p.y;
    input.style.cssText = [
      "position:fixed",
      `left:${Math.min(screenX + 8, window.innerWidth - 220)}px`,
      `top:${Math.min(screenY + 4, window.innerHeight - 50)}px`,
      "width:200px",
      "z-index:9999",
      "font-size:16px",
      "padding:4px 8px",
      "border:2px solid #0af",
      "border-radius:4px",
      "background:#fff",
      "color:#000",
    ].join(";");

    // 오버레이는 한 번만 끝난다. 브라우저는 input 을 지운 뒤에도 blur 를 한 번
    // 더 보내므로, 플래그가 없으면 Enter 커밋이 두 번 찍히고 Escape 로 취소한
    // 글자도 blur 에서 다시 찍혔다.
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const commit = () => {
      if (done) return;
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
    // 실제 렌더 폭을 재서 쓴다. 0.6em 추정은 한글(약 1em)에 부족해 undo rect 가
    // 글자 오른쪽을 덮지 못했다. 반드시 restore() 전에 재야 한다 — 복원 뒤에는
    // 폰트가 기본값(10px)으로 돌아가 폭이 절반 이하로 나온다.
    const measure = (lctx as unknown as { measureText?: (t: string) => { width: number } }).measureText;
    const textW = typeof measure === "function"
      ? Math.ceil(measure.call(lctx, text).width)
      : text.length * Math.round(fontPx * 0.6);
    lctx.restore();

    const approxW = textW + 4;
    const bbox = newBbox(p.x, p.y);
    expandBbox(bbox, p.x + approxW, p.y + fontPx);
    ctx.stack.markDirty({ x: Math.floor(p.x), y: Math.floor(p.y), w: approxW + 4, h: fontPx + 4 });

    commitStroke(ctx, layer, shadow.ctx, bbox, 4, `Text "${text.slice(0, 12)}"`);
  }

  onPointerMove(_p: ToolPointer, _ctx: ToolContext): void { /* input overlay handles its own events */ }
  onPointerUp(_p: ToolPointer, _ctx: ToolContext): void { /* single-shot */ }
  onPointerCancel(_ctx: ToolContext): void { this.queuedText = null; }
}
