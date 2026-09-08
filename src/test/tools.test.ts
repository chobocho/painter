import { describe, it, assertEqual, assertTrue, assertFalse } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { defaultSettings, ToolContext, Tool } from "../tools/Tool.js";
import { PencilTool, EraserTool, RectTool, EllipseTool, LineTool, TriangleTool } from "../tools/ShapeTools.js";
import { SprayTool } from "../tools/SprayTool.js";
import { FillBucketTool } from "../tools/FillBucketTool.js";
import { GradientTool } from "../tools/GradientTool.js";
import { EyedropperTool } from "../tools/EyedropperTool.js";
import { SmudgeTool } from "../tools/SmudgeTool.js";
import { PatternBrush } from "../tools/PatternBrush.js";
import { buildDefaultRegistry } from "../tools/ToolRegistry.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;

function bootstrap(size: number = 32): { stack: LayerStack; history: CommandHistory; ctx: ToolContext; layer: Layer } {
  const stack = new LayerStack(size, size, factory);
  const layer = new Layer({ name: "L", width: size, height: size, factory });
  stack.add(layer);
  const preview = new Layer({ name: "P", width: size, height: size, factory });
  const history = new CommandHistory();
  const ctx: ToolContext = {
    stack,
    history,
    settings: defaultSettings(),
    previewLayer: preview,
  };
  return { stack, history, ctx, layer };
}

const pointer = (x: number, y: number) => ({ x, y, pressure: 1, buttons: 1, shift: false, ctrl: false, alt: false });

function alphaAt(layer: Layer, x: number, y: number): number {
  return layer.getPixels(x, y, 1, 1).data[3] ?? 0;
}

describe("PencilTool", () => {
  it("emits exactly one history command per stroke", () => {
    const { ctx, history } = bootstrap();
    const tool = new PencilTool();
    tool.onPointerDown(pointer(4, 4), ctx);
    tool.onPointerMove(pointer(10, 10), ctx);
    tool.onPointerUp(pointer(10, 10), ctx);
    assertEqual(history.size().past, 1);
  });

  it("draws visible pixels along the stroke path", () => {
    const { ctx, layer } = bootstrap();
    ctx.settings.brushSize = 4;
    const tool = new PencilTool();
    tool.onPointerDown(pointer(5, 5), ctx);
    tool.onPointerMove(pointer(15, 15), ctx);
    tool.onPointerUp(pointer(15, 15), ctx);
    assertTrue(alphaAt(layer, 5, 5) > 0, "start pixel painted");
    assertTrue(alphaAt(layer, 15, 15) > 0, "end pixel painted");
    assertTrue(alphaAt(layer, 10, 10) > 0, "midpoint painted");
  });

  it("single click leaves a dot", () => {
    const { ctx, layer } = bootstrap();
    ctx.settings.brushSize = 4;
    const tool = new PencilTool();
    tool.onPointerDown(pointer(8, 8), ctx);
    tool.onPointerUp(pointer(8, 8), ctx);
    assertTrue(alphaAt(layer, 8, 8) > 0);
  });

  it("multiple strokes accumulate in history", () => {
    const { ctx, history } = bootstrap();
    const tool = new PencilTool();
    for (let i = 0; i < 5; i++) {
      tool.onPointerDown(pointer(2 + i, 2), ctx);
      tool.onPointerMove(pointer(2 + i, 10), ctx);
      tool.onPointerUp(pointer(2 + i, 10), ctx);
    }
    assertEqual(history.size().past, 5);
    assertEqual(history.list().length, 5);
  });

  it("undo restores blank, redo reapplies", () => {
    const { ctx, history, layer } = bootstrap();
    const tool = new PencilTool();
    tool.onPointerDown(pointer(4, 4), ctx);
    tool.onPointerMove(pointer(10, 10), ctx);
    tool.onPointerUp(pointer(10, 10), ctx);
    assertTrue(alphaAt(layer, 7, 7) > 0);
    history.undo({ stack: ctx.stack });
    assertEqual(alphaAt(layer, 7, 7), 0);
    history.redo({ stack: ctx.stack });
    assertTrue(alphaAt(layer, 7, 7) > 0);
  });

  it("symmetry x mirrors strokes", () => {
    const { ctx, layer } = bootstrap();
    ctx.settings.brushSize = 2;
    ctx.settings.symmetry = { enabled: true, axes: ["x"], radial: 0 };
    const tool = new PencilTool();
    tool.onPointerDown(pointer(4, 8), ctx);
    tool.onPointerMove(pointer(4, 20), ctx);
    tool.onPointerUp(pointer(4, 20), ctx);
    assertTrue(alphaAt(layer, 4, 14) > 0, "left stroke painted");
    assertTrue(alphaAt(layer, 27, 14) > 0, "mirrored right stroke painted");
  });

  it("does NOT scan full layer per pointermove (perf regression)", () => {
    const { ctx } = bootstrap(8);
    const layer = ctx.stack.getActive()!;
    let getCount = 0;
    const origGetCtx = layer.getCtx.bind(layer);
    const proxy = new Proxy(origGetCtx(), {
      get(t, p) {
        if (p === "getImageData") {
          return (...args: any[]) => {
            getCount++;
            return (t as any).getImageData(...args);
          };
        }
        return (t as any)[p];
      },
    });
    (layer as any).ctx = proxy;
    const tool = new PencilTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    for (let i = 0; i < 30; i++) tool.onPointerMove(pointer(2 + i / 10, 4 + i / 10), ctx);
    tool.onPointerUp(pointer(5, 7), ctx);
    // pencil should only call getImageData on the layer at commit time (1 call: after).
    // The "before" comes from the shadow canvas, not the layer, so this stays small.
    assertTrue(getCount <= 2, `expected ≤ 2 getImageData on layer per stroke, got ${getCount}`);
  });
});

describe("EraserTool", () => {
  it("removes pixels from a filled area", () => {
    const { ctx, layer } = bootstrap();
    layer.getCtx().fillStyle = "red";
    layer.getCtx().fillRect(0, 0, 32, 32);
    assertTrue(alphaAt(layer, 16, 16) > 0);
    const tool = new EraserTool();
    ctx.settings.brushSize = 6;
    tool.onPointerDown(pointer(16, 16), ctx);
    tool.onPointerUp(pointer(16, 16), ctx);
    assertEqual(alphaAt(layer, 16, 16), 0);
  });

  it("emits a single history command", () => {
    const { ctx, history, layer } = bootstrap();
    layer.getCtx().fillStyle = "red";
    layer.getCtx().fillRect(0, 0, 32, 32);
    const tool = new EraserTool();
    tool.onPointerDown(pointer(10, 10), ctx);
    tool.onPointerMove(pointer(20, 20), ctx);
    tool.onPointerUp(pointer(20, 20), ctx);
    assertEqual(history.size().past, 1);
  });
});

describe("LineTool", () => {
  it("draws between endpoints and emits a command", () => {
    const { ctx, history, layer } = bootstrap();
    ctx.settings.brushSize = 2;
    const tool = new LineTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerMove(pointer(28, 28), ctx);
    tool.onPointerUp(pointer(28, 28), ctx);
    assertEqual(history.size().past, 1);
    assertTrue(alphaAt(layer, 2, 2) > 0);
    assertTrue(alphaAt(layer, 28, 28) > 0);
    assertTrue(alphaAt(layer, 15, 15) > 0);
  });
});

describe("RectTool", () => {
  it("filled rectangle covers interior", () => {
    const { ctx, history, layer } = bootstrap();
    const tool = new RectTool();
    tool.filled = true;
    tool.onPointerDown(pointer(4, 4), ctx);
    tool.onPointerMove(pointer(20, 20), ctx);
    tool.onPointerUp(pointer(20, 20), ctx);
    assertEqual(history.size().past, 1);
    assertTrue(alphaAt(layer, 12, 12) > 0);
  });

  it("outline rectangle paints only the perimeter", () => {
    const { ctx, layer } = bootstrap();
    ctx.settings.brushSize = 1;
    const tool = new RectTool();
    tool.filled = false;
    tool.onPointerDown(pointer(4, 4), ctx);
    tool.onPointerMove(pointer(20, 20), ctx);
    tool.onPointerUp(pointer(20, 20), ctx);
    assertTrue(alphaAt(layer, 4, 4) > 0);
    assertTrue(alphaAt(layer, 20, 20) > 0);
    assertEqual(alphaAt(layer, 12, 12), 0);
  });

  it("square mode clamps to equal sides", () => {
    const { ctx, history } = bootstrap();
    const tool = new RectTool();
    tool.square = true;
    tool.onPointerDown(pointer(4, 4), ctx);
    tool.onPointerMove(pointer(20, 10), ctx);
    tool.onPointerUp(pointer(20, 10), ctx);
    assertEqual(history.size().past, 1);
  });

  it("rubber-band: previous preview is restored each move", () => {
    const { ctx, layer } = bootstrap();
    ctx.settings.brushSize = 1;
    const tool = new RectTool();
    tool.filled = true;
    tool.onPointerDown(pointer(4, 4), ctx);
    tool.onPointerMove(pointer(28, 28), ctx);
    tool.onPointerMove(pointer(10, 10), ctx);
    tool.onPointerUp(pointer(10, 10), ctx);
    // Pixels in the discarded large preview should be gone.
    assertEqual(alphaAt(layer, 25, 25), 0);
    // Pixels in the final small rect should be present.
    assertTrue(alphaAt(layer, 7, 7) > 0);
  });
});

describe("EllipseTool", () => {
  it("filled ellipse fills center", () => {
    const { ctx, history, layer } = bootstrap();
    const tool = new EllipseTool();
    tool.filled = true;
    tool.onPointerDown(pointer(4, 4), ctx);
    tool.onPointerMove(pointer(28, 28), ctx);
    tool.onPointerUp(pointer(28, 28), ctx);
    assertEqual(history.size().past, 1);
    assertTrue(alphaAt(layer, 16, 16) > 0);
  });
});

describe("TriangleTool", () => {
  it("draws and emits a command", () => {
    const { ctx, history, layer } = bootstrap();
    const tool = new TriangleTool();
    tool.filled = true;
    tool.onPointerDown(pointer(16, 4), ctx);
    tool.onPointerMove(pointer(28, 28), ctx);
    tool.onPointerUp(pointer(28, 28), ctx);
    assertEqual(history.size().past, 1);
    assertTrue(alphaAt(layer, 16, 20) > 0);
  });
});

describe("SprayTool", () => {
  it("emits a command and paints something near the cursor", () => {
    const { ctx, history, layer } = bootstrap();
    const tool = new SprayTool();
    tool.seed = 42;
    ctx.settings.brushSize = 4;
    tool.onPointerDown(pointer(16, 16), ctx);
    for (let i = 0; i < 6; i++) tool.onPointerMove(pointer(16 + i, 16), ctx);
    tool.onPointerUp(pointer(22, 16), ctx);
    assertEqual(history.size().past, 1);
    let painted = 0;
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) {
      if (alphaAt(layer, x, y) > 0) painted++;
    }
    assertTrue(painted > 5, "spray should paint at least a few pixels");
  });
});

describe("FillBucketTool", () => {
  it("fills connected transparent region", () => {
    const { ctx, layer } = bootstrap();
    layer.getCtx().fillStyle = "red";
    layer.getCtx().fillRect(16, 0, 16, 32);
    const tool = new FillBucketTool();
    ctx.settings.color = { r: 0, g: 255, b: 0, a: 255 };
    ctx.settings.tolerance = 0;
    tool.onPointerDown(pointer(2, 2), ctx);
    assertEqual(layer.getPixels(2, 2, 1, 1).data[1], 255);
    assertEqual(layer.getPixels(20, 20, 1, 1).data[0], 255);
  });

  it("emits a single history command", () => {
    const { ctx, history } = bootstrap();
    const tool = new FillBucketTool();
    ctx.settings.color = { r: 0, g: 255, b: 0, a: 255 };
    tool.onPointerDown(pointer(4, 4), ctx);
    assertEqual(history.size().past, 1);
  });
});

describe("GradientTool", () => {
  it("two-stop gradient produces interpolated edges across an existing fill", () => {
    // The new (round-5) semantics: gradient only repaints existing pixels.
    // Pre-fill the entire layer so the gradient has something to clip against.
    const { ctx, history, layer } = bootstrap();
    layer.getCtx().fillStyle = "rgba(255,255,255,1)";
    layer.getCtx().fillRect(0, 0, 32, 32);
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
      { stop: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
    ];
    const tool = new GradientTool();
    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerUp(pointer(31, 0), ctx);
    assertEqual(history.size().past, 1);
    assertEqual(layer.getPixels(0, 0, 1, 1).data[0], 0);
    assertEqual(layer.getPixels(31, 0, 1, 1).data[0], 255);
  });
});

describe("EyedropperTool", () => {
  it("picks color from active layer (no history command)", () => {
    const { ctx, history, layer } = bootstrap();
    layer.getCtx().fillStyle = "rgba(123,45,67,1)";
    layer.getCtx().fillRect(5, 5, 1, 1);
    const tool = new EyedropperTool();
    tool.onPointerDown(pointer(5, 5), ctx);
    assertEqual(ctx.settings.color.r, 123);
    assertEqual(ctx.settings.color.g, 45);
    assertEqual(ctx.settings.color.b, 67);
    assertEqual(history.size().past, 0);
  });
});

describe("SmudgeTool", () => {
  it("emits a command after a stroke", () => {
    const { ctx, history, layer } = bootstrap();
    layer.getCtx().fillStyle = "rgba(255,0,0,1)";
    layer.getCtx().fillRect(0, 0, 16, 32);
    layer.getCtx().fillStyle = "rgba(0,0,255,1)";
    layer.getCtx().fillRect(16, 0, 16, 32);
    const tool = new SmudgeTool();
    ctx.settings.brushSize = 4;
    tool.onPointerDown(pointer(15, 16), ctx);
    tool.onPointerMove(pointer(17, 16), ctx);
    tool.onPointerUp(pointer(17, 16), ctx);
    assertEqual(history.size().past, 1);
  });
});

describe("PatternBrush", () => {
  it("stamps and emits a command", () => {
    const { ctx, history } = bootstrap();
    ctx.settings.patternId = "dots";
    ctx.settings.brushSize = 4;
    const tool = new PatternBrush();
    tool.onPointerDown(pointer(16, 16), ctx);
    tool.onPointerMove(pointer(20, 20), ctx);
    tool.onPointerUp(pointer(20, 20), ctx);
    assertEqual(history.size().past, 1);
  });
});

describe("ToolRegistry", () => {
  it("default registry has all expected tools with unique ids", () => {
    const r = buildDefaultRegistry();
    const expected = [
      "pencil", "eraser", "line",
      "rect", "rect-filled", "square", "square-filled",
      "ellipse", "ellipse-filled", "circle", "circle-filled",
      "triangle", "triangle-filled",
      "spray", "fill", "gradient", "eyedropper", "smudge", "pattern",
      "text",
    ];
    for (const id of expected) assertTrue(r.has(id), `missing tool ${id}`);
    const ids = r.list().map((d) => d.id);
    assertEqual(new Set(ids).size, ids.length, "duplicate tool ids");
    assertEqual(ids.length, expected.length);
  });

  it("each descriptor has a non-empty icon", () => {
    const r = buildDefaultRegistry();
    for (const d of r.list()) {
      assertTrue(d.icon.length > 0, `tool ${d.id} missing icon`);
    }
  });

  it("rect vs rect-filled and circle vs circle-filled are distinct instances", () => {
    const r = buildDefaultRegistry();
    const rect = r.get("rect") as any;
    const rectF = r.get("rect-filled") as any;
    assertFalse(rect === rectF);
    assertEqual(rect.filled, false);
    assertEqual(rectF.filled, true);

    const circle = r.get("circle") as any;
    const circleF = r.get("circle-filled") as any;
    assertFalse(circle === circleF);
    assertEqual(circle.filled, false);
    assertEqual(circleF.filled, true);
    assertEqual(circle.circle, true);
    assertEqual(circleF.circle, true);
  });

  it("each tool routed via the registry produces a history command", () => {
    const ids = ["pencil", "eraser", "line", "rect", "rect-filled", "square", "square-filled",
      "ellipse", "ellipse-filled", "circle", "circle-filled", "triangle", "triangle-filled",
      "spray", "fill", "gradient", "smudge", "pattern"];
    for (const id of ids) {
      const { ctx, history, layer } = bootstrap();
      // Pre-paint with a color *different* from the brush color so the fill
      // bucket doesn't no-op and the eraser/smudge have something to act on.
      layer.getCtx().fillStyle = "rgba(0,200,0,1)";
      layer.getCtx().fillRect(0, 0, 32, 32);
      ctx.settings.color = { r: 0, g: 0, b: 200, a: 255 };
      const r = buildDefaultRegistry();
      const tool = r.get(id)!;
      tool.onPointerDown(pointer(8, 8), ctx);
      tool.onPointerMove(pointer(20, 20), ctx);
      tool.onPointerUp(pointer(20, 20), ctx);
      assertTrue(history.size().past >= 1, `tool ${id} did not push a command`);
    }
  });
});
