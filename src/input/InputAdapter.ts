// Unified pointer/keyboard adapter. Maps DOM PointerEvents and KeyboardEvents
// to the active tool with project-space coordinates.

import { Tool, ToolPointer, ToolContext } from "../tools/Tool.js";
import { DisplayCanvas } from "../core/Canvas.js";

export interface InputBindings {
  getActiveTool: () => Tool;
  getToolContext: () => ToolContext;
  onPointerStateChange?: (down: boolean) => void;
  onKey?: (e: KeyboardEvent) => boolean | void;
}

export class InputAdapter {
  private down = false;
  private cleanup: (() => void)[] = [];

  constructor(
    private displayCanvas: DisplayCanvas,
    private el: HTMLElement,
    private bindings: InputBindings
  ) {}

  bind(): void {
    const handlePointer = (kind: "down" | "move" | "up" | "cancel") => (ev: Event) => {
      const e = ev as PointerEvent;
      if (e.cancelable) e.preventDefault();
      const rect = this.el.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const projected = this.displayCanvas.cssToProject(cssX, cssY);
      const p: ToolPointer = {
        x: projected.x,
        y: projected.y,
        pressure: e.pressure ?? 0.5,
        buttons: e.buttons,
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
        alt: e.altKey,
      };
      const tool = this.bindings.getActiveTool();
      const ctx = this.bindings.getToolContext();
      if (kind === "down") {
        this.down = true;
        this.bindings.onPointerStateChange?.(true);
        try { (this.el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId); } catch { /* noop */ }
        tool.onPointerDown(p, ctx);
      } else if (kind === "move" && this.down) {
        tool.onPointerMove(p, ctx);
      } else if (kind === "up") {
        if (this.down) tool.onPointerUp(p, ctx);
        this.down = false;
        this.bindings.onPointerStateChange?.(false);
      } else if (kind === "cancel") {
        if (this.down) tool.onPointerCancel(ctx);
        this.down = false;
        this.bindings.onPointerStateChange?.(false);
      }
    };

    const onDown = handlePointer("down");
    const onMove = handlePointer("move");
    const onUp = handlePointer("up");
    const onCancel = handlePointer("cancel");

    this.el.addEventListener("pointerdown", onDown);
    this.el.addEventListener("pointermove", onMove);
    this.el.addEventListener("pointerup", onUp);
    // Only `pointercancel` triggers the cancel path. `pointerleave` is a
    // hover boundary event that fires on every touch release (and on any
    // mouse drag that crosses the canvas edge), so binding it to cancel
    // would erase strokes the moment the user lifts a finger or drags out.
    this.el.addEventListener("pointercancel", onCancel);

    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      this.bindings.onKey?.(e);
    };
    window.addEventListener("keydown", onKey);

    this.cleanup.push(() => {
      this.el.removeEventListener("pointerdown", onDown);
      this.el.removeEventListener("pointermove", onMove);
      this.el.removeEventListener("pointerup", onUp);
      this.el.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    });
  }

  unbind(): void {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
  }
}
