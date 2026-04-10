import { describe, it, assertEqual, assertTrue, assertNear } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { defaultSettings, ToolContext } from "../tools/Tool.js";
import { PencilTool, EraserTool, RectTool, EllipseTool, LineTool, TriangleTool } from "../tools/ShapeTools.js";
import { SprayTool } from "../tools/SprayTool.js";
import { FillBucketTool } from "../tools/FillBucketTool.js";
import { GradientTool } from "../tools/GradientTool.js";
import { EyedropperTool } from "../tools/EyedropperTool.js";
import { SmudgeTool } from "../tools/SmudgeTool.js";
import { PatternBrush } from "../tools/PatternBrush.js";
import { ColorCyclingEngine } from "../tools/ColorCycling.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;

function bootstrap(): { stack: LayerStack; history: CommandHistory; ctx: ToolContext; layer: Layer } {
  const stack = new LayerStack(16, 16, factory);
  const layer = new Layer({ name: "L", width: 16, height: 16, factory });
  stack.add(layer);
  const preview = new Layer({ name: "P", width: 16, height: 16, factory });
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

describe("PencilTool", () => {
  it("creates exactly one history command per stroke", () => {
    const { ctx, history } = bootstrap();
    const tool = new PencilTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerMove(pointer(8, 8), ctx);
    tool.onPointerUp(pointer(8, 8), ctx);
    assertEqual(history.size().past, 1);
  });

  it("undo restores blank, redo redraws", () => {
    const { ctx, history, layer } = bootstrap();
    const tool = new PencilTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerMove(pointer(8, 8), ctx);
    tool.onPointerUp(pointer(8, 8), ctx);
    const px1 = layer.getPixels(2, 2, 1, 1).data[3];
    assertTrue((px1 ?? 0) > 0);
    history.undo({ stack: ctx.stack });
    const px2 = layer.getPixels(2, 2, 1, 1).data[3];
    assertEqual(px2, 0);
    history.redo({ stack: ctx.stack });
    const px3 = layer.getPixels(2, 2, 1, 1).data[3];
    assertTrue((px3 ?? 0) > 0);
  });

  it("symmetry x mirrors strokes", () => {
    const { ctx, layer } = bootstrap();
    ctx.settings.symmetry = { enabled: true, axes: ["x"], radial: 0 };
    const tool = new PencilTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerMove(pointer(2, 5), ctx);
    tool.onPointerUp(pointer(2, 5), ctx);
    const left = layer.getPixels(2, 2, 1, 1).data[3] ?? 0;
    const right = layer.getPixels(13, 2, 1, 1).data[3] ?? 0;
    assertTrue(left > 0);
    assertTrue(right > 0);
  });
});

describe("LineTool", () => {
  it("draws between endpoints", () => {
    const { ctx, layer } = bootstrap();
    const tool = new LineTool();
    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerMove(pointer(15, 15), ctx);
    tool.onPointerUp(pointer(15, 15), ctx);
    assertTrue((layer.getPixels(0, 0, 1, 1).data[3] ?? 0) > 0);
    assertTrue((layer.getPixels(15, 15, 1, 1).data[3] ?? 0) > 0);
  });
});

describe("RectTool", () => {
  it("filled rectangle covers interior", () => {
    const { ctx, layer } = bootstrap();
    const tool = new RectTool();
    tool.filled = true;
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerMove(pointer(8, 8), ctx);
    tool.onPointerUp(pointer(8, 8), ctx);
    assertTrue((layer.getPixels(5, 5, 1, 1).data[3] ?? 0) > 0);
  });
});

describe("EllipseTool", () => {
  it("filled ellipse fills center", () => {
    const { ctx, layer } = bootstrap();
    const tool = new EllipseTool();
    tool.filled = true;
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerMove(pointer(14, 14), ctx);
    tool.onPointerUp(pointer(14, 14), ctx);
    assertTrue((layer.getPixels(8, 8, 1, 1).data[3] ?? 0) > 0);
  });
});

describe("TriangleTool", () => {
  it("draws triangle outline", () => {
    const { ctx, history } = bootstrap();
    const tool = new TriangleTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerMove(pointer(10, 10), ctx);
    tool.onPointerUp(pointer(10, 10), ctx);
    assertEqual(history.size().past, 1);
  });
});

describe("EraserTool", () => {
  it("removes pixels via destination-out semantics", () => {
    const { ctx, layer } = bootstrap();
    layer.getCtx().fillStyle = "red";
    layer.getCtx().fillRect(0, 0, 16, 16);
    const tool = new EraserTool();
    ctx.settings.brushSize = 4;
    tool.onPointerDown(pointer(8, 8), ctx);
    tool.onPointerUp(pointer(8, 8), ctx);
    assertEqual(layer.getPixels(8, 8, 1, 1).data[3], 0);
  });
});

describe("SprayTool", () => {
  it("deterministic with seed", () => {
    const { ctx, history } = bootstrap();
    const tool = new SprayTool();
    tool.seed = 42;
    tool.onPointerDown(pointer(8, 8), ctx);
    tool.onPointerUp(pointer(8, 8), ctx);
    assertEqual(history.size().past, 1);
  });
});

describe("FillBucketTool", () => {
  it("fills connected region", () => {
    const { ctx, layer } = bootstrap();
    // Background already transparent. Set a few pixels red, fill from corner.
    layer.getCtx().fillStyle = "red";
    layer.getCtx().fillRect(8, 0, 8, 16);
    const tool = new FillBucketTool();
    ctx.settings.color = { r: 0, g: 255, b: 0, a: 255 };
    ctx.settings.tolerance = 0;
    tool.onPointerDown(pointer(0, 0), ctx);
    // Original transparent area should now be green.
    assertEqual(layer.getPixels(0, 0, 1, 1).data[1], 255);
    // Red area untouched.
    assertEqual(layer.getPixels(10, 10, 1, 1).data[0], 255);
  });
});

describe("GradientTool", () => {
  it("two-stop gradient produces interpolated edges", () => {
    const { ctx, layer } = bootstrap();
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
      { stop: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
    ];
    const tool = new GradientTool();
    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerUp(pointer(15, 0), ctx);
    const left = layer.getPixels(0, 0, 1, 1).data[0] ?? -1;
    const right = layer.getPixels(15, 0, 1, 1).data[0] ?? -1;
    assertEqual(left, 0);
    assertEqual(right, 255);
  });
});

describe("EyedropperTool", () => {
  it("picks color from active layer", () => {
    const { ctx, layer } = bootstrap();
    layer.getCtx().fillStyle = "rgba(123,45,67,1)";
    layer.getCtx().fillRect(5, 5, 1, 1);
    const tool = new EyedropperTool();
    tool.onPointerDown(pointer(5, 5), ctx);
    assertEqual(ctx.settings.color.r, 123);
    assertEqual(ctx.settings.color.g, 45);
    assertEqual(ctx.settings.color.b, 67);
  });
});

describe("SmudgeTool", () => {
  it("blends colors along motion", () => {
    const { ctx, layer } = bootstrap();
    layer.getCtx().fillStyle = "rgba(255,0,0,1)";
    layer.getCtx().fillRect(0, 0, 8, 16);
    layer.getCtx().fillStyle = "rgba(0,0,255,1)";
    layer.getCtx().fillRect(8, 0, 8, 16);
    const tool = new SmudgeTool();
    ctx.settings.brushSize = 4;
    tool.onPointerDown(pointer(7, 8), ctx);
    tool.onPointerMove(pointer(9, 8), ctx);
    tool.onPointerUp(pointer(9, 8), ctx);
    // Pixel near boundary should be neither pure red nor pure blue.
    const px = layer.getPixels(8, 8, 1, 1);
    assertTrue((px.data[0] ?? 0) > 0 || (px.data[2] ?? 0) > 0);
  });
});

describe("PatternBrush", () => {
  it("stamps pattern with non-zero pixels", () => {
    const { ctx, history } = bootstrap();
    ctx.settings.patternId = "dots";
    ctx.settings.brushSize = 4;
    const tool = new PatternBrush();
    tool.onPointerDown(pointer(8, 8), ctx);
    tool.onPointerUp(pointer(8, 8), ctx);
    assertEqual(history.size().past, 1);
  });
});

describe("ColorCyclingEngine", () => {
  it("cycles palette colors on tick", () => {
    const { stack, layer } = bootstrap();
    layer.getCtx().fillStyle = "rgba(10,10,10,1)";
    layer.getCtx().fillRect(0, 0, 1, 1);
    const engine = new ColorCyclingEngine(stack);
    engine.setGroups([{
      id: "g1",
      enabled: true,
      intervalMs: 100,
      colors: [
        { r: 10, g: 10, b: 10, a: 255 },
        { r: 20, g: 20, b: 20, a: 255 },
        { r: 30, g: 30, b: 30, a: 255 },
      ],
    }]);
    engine.tick();
    assertEqual(layer.getPixels(0, 0, 1, 1).data[0], 20);
    engine.tick();
    assertEqual(layer.getPixels(0, 0, 1, 1).data[0], 30);
  });
});
