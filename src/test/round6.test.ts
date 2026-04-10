// Round 6 regression tests:
//
//   * Issue 5: GradientTool should only fill the *connected region* under
//     the click point, not every alpha>0 pixel on the layer. Two disjoint
//     shapes → clicking one must leave the other untouched.
//   * Issue 6: SmudgeTool should be discoverable from a blank canvas:
//     starting on an empty pixel falls back to the active brush color, and
//     dragging across empty pixels stamps that carry color so the user
//     sees something happen.
//   * Design review: every ToolDescriptor must carry a non-empty Korean
//     label and description so the status bar / tooltip can explain what
//     the tool does.

import { describe, it, assertEqual, assertTrue } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { defaultSettings, ToolContext } from "../tools/Tool.js";
import { GradientTool } from "../tools/GradientTool.js";
import { SmudgeTool } from "../tools/SmudgeTool.js";
import { buildDefaultRegistry } from "../tools/ToolRegistry.js";
import { RGBA } from "../util/Color.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;
const pointer = (x: number, y: number) => ({ x, y, pressure: 1, buttons: 1, shift: false, ctrl: false, alt: false });

function freshCtx(size: number = 32): { stack: LayerStack; history: CommandHistory; ctx: ToolContext; layer: Layer } {
  const stack = new LayerStack(size, size, factory);
  const layer = new Layer({ width: size, height: size, factory });
  stack.add(layer);
  const history = new CommandHistory();
  const ctx: ToolContext = {
    stack,
    history,
    settings: defaultSettings(),
    previewLayer: new Layer({ width: size, height: size, factory }),
  };
  return { stack, history, ctx, layer };
}

function alphaAt(layer: Layer, x: number, y: number): number {
  return layer.getPixels(x, y, 1, 1).data[3] ?? 0;
}
function rgbaAt(layer: Layer, x: number, y: number): RGBA {
  const d = layer.getPixels(x, y, 1, 1).data;
  return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! };
}

// ---- Issue 5: GradientTool clips to the connected region under the click ---

describe("GradientTool: only fills the connected region under the click (issue 5)", () => {
  it("two disjoint shapes — clicking one leaves the other untouched", () => {
    const { ctx, layer } = freshCtx(32);
    // Two white squares with a transparent gap between them.
    layer.getCtx().fillStyle = "rgba(255,255,255,1)";
    layer.getCtx().fillRect(2, 2, 8, 8);    // left square
    layer.getCtx().fillRect(20, 20, 8, 8);  // right square
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
      { stop: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
    ];
    const tool = new GradientTool();
    // Click the LEFT square.
    tool.onPointerDown(pointer(5, 5), ctx);
    tool.onPointerUp(pointer(9, 9), ctx);

    // Left square got the gradient (red-ish in the top-left).
    const left = rgbaAt(layer, 5, 5);
    assertTrue(left.r > 100, `left square should be reddish, got r=${left.r}`);

    // Right square is still pure white — gradient never bled into it.
    const right = rgbaAt(layer, 24, 24);
    assertEqual(right.r, 255);
    assertEqual(right.g, 255);
    assertEqual(right.b, 255);

    // The gap between them is still transparent.
    assertEqual(alphaAt(layer, 15, 15), 0);
  });

  it("clicking on a transparent gap fills the gap, not the surrounding shapes", () => {
    const { ctx, layer } = freshCtx(32);
    // White square in the middle; transparent everywhere else.
    layer.getCtx().fillStyle = "rgba(255,255,255,1)";
    layer.getCtx().fillRect(10, 10, 12, 12);
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 0, g: 200, b: 0, a: 255 } },
      { stop: 1, color: { r: 200, g: 0, b: 0, a: 255 } },
    ];
    // Click the empty area at the corner.
    const tool = new GradientTool();
    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerUp(pointer(31, 0), ctx);
    // The white square in the middle is unchanged (not part of the
    // connected transparent region under the click).
    const center = rgbaAt(layer, 16, 16);
    assertEqual(center.r, 255);
    assertEqual(center.g, 255);
    assertEqual(center.b, 255);
  });

  it("a single connected shape gets fully gradient-filled inside", () => {
    const { ctx, layer } = freshCtx(32);
    layer.getCtx().fillStyle = "rgba(128,128,128,1)";
    layer.getCtx().fillRect(4, 4, 24, 24);
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
      { stop: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
    ];
    const tool = new GradientTool();
    tool.onPointerDown(pointer(4, 16), ctx);
    tool.onPointerUp(pointer(27, 16), ctx);
    const left = rgbaAt(layer, 4, 16);
    const right = rgbaAt(layer, 27, 16);
    assertTrue(left.r < 50, `gradient start near black, got ${left.r}`);
    assertTrue(right.r > 200, `gradient end near white, got ${right.r}`);
  });

  it("tolerance=0 keeps a slightly-different second region untouched", () => {
    const { ctx, layer } = freshCtx(16);
    layer.getCtx().fillStyle = "rgba(100,100,100,1)";
    layer.getCtx().fillRect(0, 0, 16, 16);
    layer.getCtx().fillStyle = "rgba(110,110,110,1)";
    layer.getCtx().fillRect(8, 0, 8, 16);
    ctx.settings.tolerance = 0;
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
      { stop: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
    ];
    const tool = new GradientTool();
    tool.onPointerDown(pointer(2, 8), ctx);
    tool.onPointerUp(pointer(7, 8), ctx);
    // Right half (color 110) is outside tolerance from seed (color 100),
    // so it must be untouched.
    assertEqual(rgbaAt(layer, 12, 8).r, 110);
  });

  it("tolerance large enough bridges two near-uniform regions", () => {
    const { ctx, layer } = freshCtx(16);
    layer.getCtx().fillStyle = "rgba(100,100,100,1)";
    layer.getCtx().fillRect(0, 0, 16, 16);
    layer.getCtx().fillStyle = "rgba(110,110,110,1)";
    layer.getCtx().fillRect(8, 0, 8, 16);
    ctx.settings.tolerance = 64;
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
      { stop: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
    ];
    const tool = new GradientTool();
    tool.onPointerDown(pointer(2, 8), ctx);
    tool.onPointerUp(pointer(15, 8), ctx);
    // Right half should now have been repainted by the gradient (white-ish
    // toward the right end).
    const rightEnd = rgbaAt(layer, 15, 8);
    assertTrue(rightEnd.r > 200, `right end should be near-white, got ${rightEnd.r}`);
  });
});

// ---- Issue 6: SmudgeTool falls back to brush color on empty start ---------

describe("SmudgeTool: discoverable on a blank canvas (issue 6)", () => {
  it("starting on an empty pixel uses the brush color as carry", () => {
    const { ctx, layer, history } = freshCtx(16);
    ctx.settings.color = { r: 200, g: 50, b: 50, a: 255 };
    ctx.settings.brushSize = 4;
    const tool = new SmudgeTool();
    tool.onPointerDown(pointer(8, 8), ctx);
    tool.onPointerMove(pointer(10, 8), ctx);
    tool.onPointerUp(pointer(10, 8), ctx);
    // Pixels along the drag should now carry the brush color.
    const px = rgbaAt(layer, 9, 8);
    assertTrue(px.a > 0, "smudge on blank canvas should leave visible pixels");
    assertEqual(px.r, 200);
    assertEqual(px.g, 50);
    assertEqual(px.b, 50);
    assertEqual(history.size().past, 1);
  });

  it("dragging from a colored pixel into empty space stamps that color", () => {
    const { ctx, layer } = freshCtx(16);
    layer.getCtx().fillStyle = "rgba(80,160,40,1)";
    layer.getCtx().fillRect(2, 8, 1, 1);
    ctx.settings.brushSize = 3;
    const tool = new SmudgeTool();
    tool.onPointerDown(pointer(2, 8), ctx);
    // Drag right into empty space — the carry color (80,160,40) should
    // get stamped onto formerly empty pixels.
    tool.onPointerMove(pointer(5, 8), ctx);
    tool.onPointerMove(pointer(8, 8), ctx);
    tool.onPointerUp(pointer(8, 8), ctx);
    const stamped = rgbaAt(layer, 6, 8);
    assertTrue(stamped.a > 0, "carry color should stamp on empty pixels along the drag");
    // The exact channel values depend on the lerp accumulation, but green
    // must dominate since the carry started green.
    assertTrue(stamped.g > stamped.r, `green should dominate, got ${JSON.stringify(stamped)}`);
  });

  it("emits exactly one history command per stroke", () => {
    const { ctx, history } = freshCtx(16);
    ctx.settings.color = { r: 1, g: 2, b: 3, a: 255 };
    const tool = new SmudgeTool();
    tool.onPointerDown(pointer(5, 5), ctx);
    tool.onPointerMove(pointer(10, 10), ctx);
    tool.onPointerUp(pointer(10, 10), ctx);
    assertEqual(history.size().past, 1);
  });
});

// ---- Design review: every tool has Korean label + description ------------

describe("design review: every tool has Korean label and description", () => {
  it("buildDefaultRegistry produces 19 descriptors with non-empty fields", () => {
    const r = buildDefaultRegistry();
    const list = r.list();
    assertEqual(list.length, 19);
    for (const d of list) {
      assertTrue(d.label.length > 0, `${d.id} missing label`);
      assertTrue(d.description.length > 0, `${d.id} missing description`);
      assertTrue(d.icon.length > 0, `${d.id} missing icon`);
      // Korean character check: at least one Hangul codepoint somewhere.
      const hasHangul = /[가-힣]/.test(d.label) || /[가-힣]/.test(d.description);
      assertTrue(hasHangul, `${d.id} should have a Korean label or description`);
    }
  });

  it("getDescriptor returns the right entry by id", () => {
    const r = buildDefaultRegistry();
    const d = r.getDescriptor("smudge");
    assertTrue(d !== undefined);
    assertEqual(d!.label, "문지르기");
    assertTrue(d!.description.length > 0);
    // The description must mention something the user can act on; we don't
    // pin the exact wording but it must include a Hangul verb fragment.
    assertTrue(/[가-힣]/.test(d!.description));
  });

  it("gradient and eyedropper descriptions reflect the new round-5/6 contracts", () => {
    const r = buildDefaultRegistry();
    const grad = r.getDescriptor("gradient")!;
    assertTrue(grad.description.includes("영역"), "gradient description should mention 영역");
    const eye = r.getDescriptor("eyedropper")!;
    assertTrue(eye.description.includes("색"), "eyedropper description should mention 색");
  });
});
