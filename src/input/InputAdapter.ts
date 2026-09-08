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
  // 진행 중인 스트로크. pointerdown 시점의 도구와 pointerId 를 고정한다.
  // 이벤트마다 getActiveTool() 을 다시 부르면, 스트로크 도중 단축키로 도구를
  // 바꿨을 때 이전 도구의 drag 가 고아가 되어 ctx.save() 가 복구되지 않고
  // 스트로크도 커밋되지 않는다(undo 불가, shadow 캔버스 누수).
  private stroke: { tool: Tool; pointerId: number } | null = null;
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
        clientX: e.clientX,
        clientY: e.clientY,
      };
      const ctx = this.bindings.getToolContext();
      const pointerId = e.pointerId ?? 0;
      if (kind === "down") {
        // 스트로크 진행 중에 닿은 두 번째 손가락은 무시한다. 예전에는 여기서
        // 스트로크가 재시작되어 첫 손가락의 획이 통째로 버려졌다.
        if (this.stroke) return;
        this.stroke = { tool: this.bindings.getActiveTool(), pointerId };
        this.bindings.onPointerStateChange?.(true);
        try { (this.el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(pointerId); } catch { /* noop */ }
        this.stroke.tool.onPointerDown(p, ctx);
        return;
      }
      const stroke = this.stroke;
      if (!stroke || stroke.pointerId !== pointerId) return;
      if (kind === "move") {
        stroke.tool.onPointerMove(p, ctx);
      } else if (kind === "up") {
        this.stroke = null;
        stroke.tool.onPointerUp(p, ctx);
        this.bindings.onPointerStateChange?.(false);
      } else if (kind === "cancel") {
        this.stroke = null;
        stroke.tool.onPointerCancel(ctx);
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
