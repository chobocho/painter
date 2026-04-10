// Regression tests for the bugs reported after the first round:
//   1. Tool registry id collision
//   2. Pencil per-move full pixel buffer (perf, covered in tools.test.ts)
//   3. History/stack listeners orphaned after applyState
//
// These tests reproduce the *symptoms* the user saw, not just the underlying
// fix, so future refactors keep the user-visible behavior correct.

import { describe, it, assertEqual, assertTrue } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { defaultSettings, ToolContext } from "../tools/Tool.js";
import { PencilTool } from "../tools/ShapeTools.js";
import { PixelEditCommand } from "../history/Commands.js";
import { Rect } from "../util/Rect.js";
import { ProjectCodec } from "../io/ProjectCodec.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;
const pointer = (x: number, y: number) => ({ x, y, pressure: 1, buttons: 1, shift: false, ctrl: false, alt: false });

describe("regression: LayerStack.reset preserves listeners", () => {
  it("listeners attached before reset still fire after reset", () => {
    const stack = new LayerStack(8, 8, factory);
    let count = 0;
    stack.on("change", () => { count++; });
    stack.reset([], 8, 8, null);
    const initialCount = count;
    assertTrue(initialCount >= 1);
    stack.add(new Layer({ width: 8, height: 8, factory }));
    assertTrue(count > initialCount, "change event after reset should still fire");
  });
});

describe("regression: CommandHistory.replace preserves listeners", () => {
  it("listeners attached before replace still fire after replace", () => {
    const history = new CommandHistory();
    let count = 0;
    history.on("change", () => { count++; });
    history.replace({ past: [], future: [] });
    const initial = count;
    // Now execute a real command and verify the listener still fires.
    const stack = new LayerStack(4, 4, factory);
    const layer = new Layer({ width: 4, height: 4, factory });
    stack.add(layer);
    const empty = layer.getPixels(0, 0, 1, 1);
    history.execute(
      new PixelEditCommand({
        layerId: layer.id,
        rect: Rect.create(0, 0, 1, 1),
        before: { width: empty.width, height: empty.height, data: new Uint8ClampedArray(empty.data) },
        after: { width: empty.width, height: empty.height, data: new Uint8ClampedArray(empty.data) },
      }),
      { stack }
    );
    assertTrue(count > initial, "change event after replace should still fire");
  });
});

describe("regression: drawing accumulates after a project load round-trip", () => {
  it("project encode/decode + replace + draw yields a new history entry", () => {
    // Initial state
    const stack = new LayerStack(8, 8, factory);
    const layer = new Layer({ name: "L", width: 8, height: 8, factory });
    stack.add(layer);
    const history = new CommandHistory();
    const settings = defaultSettings();

    // Save and "load" through replace/reset (mimics PainterApp.applyState)
    const state = ProjectCodec.buildState({ id: "p", name: "P", stack, history, settings, createdAt: 1 });
    const json = ProjectCodec.encode(state);
    const decoded = ProjectCodec.decode(json);
    stack.reset(decoded.layers, decoded.meta.width, decoded.meta.height, decoded.activeLayerId);
    history.replace(decoded.history);

    let dirtyEvents = 0;
    let historyEvents = 0;
    // Drawing emits `dirty`; layer-list mutations emit `change`. The original
    // bug was that BOTH event channels stopped firing on the panels because
    // the panels held refs to dead instances. Here we verify both channels
    // still work after reset/replace.
    stack.on("dirty", () => { dirtyEvents++; });
    history.on("change", () => { historyEvents++; });

    const ctx: ToolContext = { stack, history, settings, previewLayer: new Layer({ width: 8, height: 8, factory }) };
    const tool = new PencilTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerMove(pointer(5, 5), ctx);
    tool.onPointerUp(pointer(5, 5), ctx);

    assertEqual(history.size().past, 1, "stroke should produce one history entry post-load");
    assertTrue(historyEvents >= 1, "history listeners should fire post-replace");
    assertTrue(dirtyEvents >= 1, "stack dirty listeners should fire post-reset");

    // Layer-add channel: the LayerPanel listens to `change`, so verify that
    // too survives reset.
    let changeEvents = 0;
    stack.on("change", () => { changeEvents++; });
    stack.add(new Layer({ width: 8, height: 8, factory }));
    assertTrue(changeEvents >= 1, "stack change listeners should fire post-reset");
  });
});

describe("regression: pencil draws on every layer pixel of long strokes", () => {
  it("a long stroke through the layer paints visible pixels at multiple sample points", () => {
    const stack = new LayerStack(64, 64, factory);
    const layer = new Layer({ width: 64, height: 64, factory });
    stack.add(layer);
    const history = new CommandHistory();
    const ctx: ToolContext = { stack, history, settings: defaultSettings(), previewLayer: new Layer({ width: 64, height: 64, factory }) };
    ctx.settings.brushSize = 3;
    const tool = new PencilTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    for (let i = 0; i < 60; i++) tool.onPointerMove(pointer(2 + i, 2 + i), ctx);
    tool.onPointerUp(pointer(60, 60), ctx);

    let painted = 0;
    for (let i = 5; i < 60; i += 10) {
      if ((layer.getPixels(i, i, 1, 1).data[3] ?? 0) > 0) painted++;
    }
    assertTrue(painted >= 5, `expected stroke to paint along the diagonal, hits=${painted}`);
    assertEqual(history.size().past, 1);
  });
});
