// End-to-end integration tests that drive the InputAdapter via dispatched
// PointerEvents on a mock element. These are the tests that catch
// "everything passes in unit tests but the real device is broken" bugs:
// they run with the strict canvas mock so any 1-arg drawImage call (etc.)
// throws exactly like a real browser would.

import { describe, it, assertEqual, assertTrue } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { DisplayCanvas } from "../core/Canvas.js";
import { defaultSettings, Tool, ToolContext } from "../tools/Tool.js";
import { PencilTool, EraserTool, LineTool, RectTool, EllipseTool, TriangleTool } from "../tools/ShapeTools.js";
import { SprayTool } from "../tools/SprayTool.js";
import { FillBucketTool } from "../tools/FillBucketTool.js";
import { GradientTool } from "../tools/GradientTool.js";
import { SmudgeTool } from "../tools/SmudgeTool.js";
import { PatternBrush } from "../tools/PatternBrush.js";
import { InputAdapter } from "../input/InputAdapter.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";
import { MockHTMLElement, MockPointerEvent, installWindowGlobal } from "./mocks/Dom.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;

interface Wired {
  stack: LayerStack;
  history: CommandHistory;
  ctx: ToolContext;
  el: MockHTMLElement;
  display: DisplayCanvas;
  setTool: (t: Tool) => void;
  destroy: () => void;
}

function wirePainterApp(opts: { projectW?: number; projectH?: number; cssW?: number; cssH?: number; dpr?: number; offsetX?: number; offsetY?: number } = {}): Wired {
  installWindowGlobal();
  const projectW = opts.projectW ?? 100;
  const projectH = opts.projectH ?? 100;
  const cssW = opts.cssW ?? projectW;
  const cssH = opts.cssH ?? projectH;
  const dpr = opts.dpr ?? 1;
  const offsetX = opts.offsetX ?? 0;
  const offsetY = opts.offsetY ?? 0;

  const stack = new LayerStack(projectW, projectH, factory);
  stack.add(new Layer({ name: "L", width: projectW, height: projectH, factory }));
  const history = new CommandHistory();
  const settings = defaultSettings();
  settings.brushSize = 4;
  const previewLayer = new Layer({ width: projectW, height: projectH, factory });

  const canvasEl = new MockHTMLCanvasElement(cssW * dpr, cssH * dpr);
  const display = new DisplayCanvas(canvasEl as any, projectW, projectH, dpr);
  display.resizeDisplay(cssW, cssH, dpr);

  const el = new MockHTMLElement(cssW, cssH, offsetX, offsetY);
  let activeTool: Tool = new PencilTool();
  const toolCtx: ToolContext = { stack, history, settings, previewLayer };

  const input = new InputAdapter(display, el as any, {
    getActiveTool: () => activeTool,
    getToolContext: () => toolCtx,
  });
  input.bind();

  return {
    stack,
    history,
    ctx: toolCtx,
    el,
    display,
    setTool: (t) => { activeTool = t; },
    destroy: () => input.unbind(),
  };
}

function dispatch(el: MockHTMLElement, type: string, x: number, y: number): void {
  el.dispatchEvent(new MockPointerEvent(type, { clientX: x, clientY: y }));
}

function alphaAt(layer: Layer, x: number, y: number): number {
  return layer.getPixels(x, y, 1, 1).data[3] ?? 0;
}

describe("integration: pencil end-to-end through InputAdapter", () => {
  it("dispatched pointerdown/move/up draws and pushes one history command", () => {
    const w = wirePainterApp();
    const layer = w.stack.getActive()!;
    dispatch(w.el, "pointerdown", 10, 10);
    dispatch(w.el, "pointermove", 50, 50);
    dispatch(w.el, "pointerup",  50, 50);
    assertEqual(w.history.size().past, 1, "one stroke = one history command");
    assertTrue(alphaAt(layer, 10, 10) > 0, "stroke start painted");
    assertTrue(alphaAt(layer, 30, 30) > 0, "stroke midpoint painted");
    assertTrue(alphaAt(layer, 49, 49) > 0, "stroke end painted");
    w.destroy();
  });

  it("multiple strokes accumulate in history (regression: history was not growing)", () => {
    const w = wirePainterApp();
    for (let i = 0; i < 5; i++) {
      dispatch(w.el, "pointerdown", 10 + i, 20);
      dispatch(w.el, "pointermove", 10 + i, 80);
      dispatch(w.el, "pointerup",   10 + i, 80);
    }
    assertEqual(w.history.size().past, 5, "five strokes should yield five history commands");
    assertEqual(w.history.list().length, 5);
    w.destroy();
  });

  it("CSS-to-project coordinate mapping with DPR and CSS scaling", () => {
    // Project is 200x200 but the canvas is displayed at 100x100 CSS px.
    // A click at (50, 50) CSS px should map to (100, 100) project space.
    const w = wirePainterApp({ projectW: 200, projectH: 200, cssW: 100, cssH: 100, dpr: 2 });
    const layer = w.stack.getActive()!;
    dispatch(w.el, "pointerdown", 50, 50);
    dispatch(w.el, "pointerup",   50, 50);
    assertTrue(alphaAt(layer, 100, 100) > 0, "click in CSS center should paint project center");
    w.destroy();
  });

  it("element offset is subtracted from clientX/Y", () => {
    // Canvas is positioned at (300, 200) on the page.
    const w = wirePainterApp({ projectW: 100, projectH: 100, cssW: 100, cssH: 100, offsetX: 300, offsetY: 200 });
    const layer = w.stack.getActive()!;
    // A click at page (350, 250) is (50, 50) inside the canvas.
    dispatch(w.el, "pointerdown", 350, 250);
    dispatch(w.el, "pointerup",   350, 250);
    assertTrue(alphaAt(layer, 50, 50) > 0, "offset should be subtracted before mapping to project");
    w.destroy();
  });

  it("pointerdown captures the pointer for drag-outside support", () => {
    const w = wirePainterApp();
    dispatch(w.el, "pointerdown", 10, 10);
    assertTrue(w.el.capturedPointers.length > 0, "pointer should be captured on down");
    dispatch(w.el, "pointerup", 10, 10);
    w.destroy();
  });

  it("pointermove without pointerdown is ignored", () => {
    const w = wirePainterApp();
    dispatch(w.el, "pointermove", 50, 50);
    assertEqual(w.history.size().past, 0);
    w.destroy();
  });
});

describe("integration: every tool draws via dispatched events", () => {
  // Each tool gets routed through the live InputAdapter; the strict mock
  // canvas will throw on any bad drawImage signature, so a tool that "works
  // in unit tests" but uses the real DOM API incorrectly (round-2 bug) will
  // surface here as a thrown TypeError.
  const cases: { id: string; tool: () => Tool }[] = [
    { id: "pencil",   tool: () => new PencilTool() },
    { id: "eraser",   tool: () => new EraserTool() },
    { id: "line",     tool: () => new LineTool() },
    { id: "rect",     tool: () => { const t = new RectTool(); t.filled = false; return t; } },
    { id: "rectF",    tool: () => { const t = new RectTool(); t.filled = true;  return t; } },
    { id: "ellipse",  tool: () => { const t = new EllipseTool(); t.filled = false; return t; } },
    { id: "ellipseF", tool: () => { const t = new EllipseTool(); t.filled = true;  return t; } },
    { id: "triangle", tool: () => new TriangleTool() },
    { id: "spray",    tool: () => new SprayTool() },
    { id: "fill",     tool: () => new FillBucketTool() },
    { id: "gradient", tool: () => new GradientTool() },
    { id: "smudge",   tool: () => new SmudgeTool() },
    { id: "pattern",  tool: () => new PatternBrush() },
  ];

  for (const c of cases) {
    it(`${c.id}: down→move→up emits a history command`, () => {
      const w = wirePainterApp();
      // Pre-paint a green background so the eraser/smudge/fill have something
      // to act on, and pick a brush color that differs from the background so
      // the fill bucket doesn't no-op.
      const layer = w.stack.getActive()!;
      layer.getCtx().fillStyle = "rgba(0,200,0,1)";
      layer.getCtx().fillRect(0, 0, layer.width, layer.height);
      w.ctx.settings.color = { r: 0, g: 0, b: 200, a: 255 };

      w.setTool(c.tool());
      dispatch(w.el, "pointerdown", 20, 20);
      dispatch(w.el, "pointermove", 60, 60);
      dispatch(w.el, "pointerup",   60, 60);
      assertTrue(w.history.size().past >= 1, `${c.id} did not push a command`);
      w.destroy();
    });
  }
});

describe("integration: strict mock catches bad drawImage signatures", () => {
  it("MockCanvas drawImage throws on a 1-arg call", () => {
    const a = new MockHTMLCanvasElement(8, 8);
    const b = new MockHTMLCanvasElement(8, 8);
    const ctx = a.getContext("2d")!;
    let threw = false;
    try {
      // Deliberate bad call: drawImage requires (image, dx, dy) at minimum.
      (ctx as unknown as { drawImage: (...args: unknown[]) => void }).drawImage(b);
    } catch {
      threw = true;
    }
    assertTrue(threw, "strict mock must throw on 1-arg drawImage");
  });

  it("MockCanvas drawImage accepts 2-arg form", () => {
    const a = new MockHTMLCanvasElement(8, 8);
    const b = new MockHTMLCanvasElement(8, 8);
    const ctx = a.getContext("2d")!;
    ctx.drawImage(b as any, 0, 0);
  });
});
