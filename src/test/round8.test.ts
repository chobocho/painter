// Round 8: tests-first regression for the user's round-8 bug report.
//
// The symptoms: history panel stayed empty after drawing a shape, "+ 새 레이어"
// button looked inert, PNG import did nothing, no text tool existed, exported
// JSON was 22 MB for a blank project, and importing that JSON failed. The
// tests here drive the fixes:
//
//   * Issue 9 (vector storage) — compact serialization must drop blank layers
//     and RLE-compress filled ones so a fresh project round-trips to < 200 KB.
//     Persisted history must be empty (undo is in-memory only).
//   * Issue 10 (import) — ProjectCodec decode → applyState must preserve a
//     filled background and correct layer count.
//   * Issue 7 (PNG import) — importPngFile must use the 5-arg drawImage form
//     that real browsers (and our strict mock) accept.
//   * Issue 8 (text tool) — a TextTool must exist, be registered, and commit a
//     history command when a pointer-down fires.
//   * Issue 4/5 (history + add layer) — integration-style check that shape
//     tools push a history entry and that addLayer grows the stack to 3.

import { describe, it, assertEqual, assertTrue, assertFalse } from "./runner.js";
import { Layer, LayerSnapshot } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { PixelEditCommand, AddLayerCommand } from "../history/Commands.js";
import { ProjectCodec } from "../io/ProjectCodec.js";
import { RectTool } from "../tools/ShapeTools.js";
import { buildDefaultRegistry } from "../tools/ToolRegistry.js";
import { TextTool } from "../tools/TextTool.js";
import { defaultSettings, ToolContext } from "../tools/Tool.js";
import { importPngFile } from "../io/PngImporter.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";
import { Rect } from "../util/Rect.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;
const pointer = (x: number, y: number) => ({ x, y, pressure: 1, buttons: 1, shift: false, ctrl: false, alt: false });

function toolCtxFor(stack: LayerStack, history: CommandHistory): ToolContext {
  return {
    stack,
    history,
    settings: defaultSettings(),
    previewLayer: new Layer({ width: stack.width, height: stack.height, factory }),
  };
}

function blankStack(layers = 2): LayerStack {
  const stack = new LayerStack(32, 32, factory);
  for (let i = 0; i < layers; i++) {
    const l = new Layer({ name: `L${i}`, width: 32, height: 32, factory });
    stack.add(l);
  }
  return stack;
}

// ---- Issue 9: compact vector-style storage -------------------------------

describe("ProjectCodec: compact storage (issue 9)", () => {
  it("blank layers serialize WITHOUT any pixel data", () => {
    const l = new Layer({ width: 64, height: 64, factory });
    const snap = l.serialize({ compact: true });
    assertTrue(
      (snap.rawRGBA === undefined || snap.rawRGBA === "") &&
      (snap.rleRGBA === undefined || snap.rleRGBA === "") &&
      (snap.pngBase64 === undefined || snap.pngBase64 === ""),
      "a blank layer should carry zero pixel bytes under compact:true"
    );
  });

  it("solid-color layers compress dramatically under RLE", () => {
    const l = new Layer({ width: 1920, height: 1280, factory });
    const c = l.getCtx();
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 1920, 1280);
    const snap = l.serialize({ compact: true });
    const jsonSize = JSON.stringify(snap).length;
    assertTrue(jsonSize < 50_000, `a uniform 1920x1280 layer should compact to < 50 KB, got ${jsonSize} bytes`);
  });

  it("compact round-trip preserves a white background layer exactly", () => {
    const l = new Layer({ width: 32, height: 32, factory });
    const c = l.getCtx();
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 32, 32);
    const snap = l.serialize({ compact: true });
    const l2 = Layer.deserialize(snap, factory);
    const px = l2.getPixels(0, 0, 1, 1).data;
    assertEqual(px[0], 255);
    assertEqual(px[1], 255);
    assertEqual(px[2], 255);
    assertEqual(px[3], 255);
  });

  it("compact round-trip preserves a partially drawn layer", () => {
    const l = new Layer({ width: 16, height: 16, factory });
    const c = l.getCtx();
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 16, 16);
    c.fillStyle = "rgba(10,20,30,1)";
    c.fillRect(2, 3, 4, 5);
    const snap = l.serialize({ compact: true });
    const l2 = Layer.deserialize(snap, factory);
    const inside = l2.getPixels(2, 3, 1, 1).data;
    assertEqual(inside[0], 10, "R");
    assertEqual(inside[1], 20, "G");
    assertEqual(inside[2], 30, "B");
    const outside = l2.getPixels(0, 0, 1, 1).data;
    assertEqual(outside[0], 255);
    assertEqual(outside[1], 255);
    assertEqual(outside[2], 255);
  });

  it("buildState(compact:true) produces a small JSON even for a full-size project", () => {
    const stack = new LayerStack(1920, 1280, factory);
    const bg = new Layer({ name: "배경", width: 1920, height: 1280, factory });
    bg.getCtx().fillStyle = "#ffffff";
    bg.getCtx().fillRect(0, 0, 1920, 1280);
    const draw = new Layer({ name: "레이어 1", width: 1920, height: 1280, factory });
    stack.add(bg);
    stack.add(draw);

    const history = new CommandHistory();
    // Put some fake history so we can prove it gets trimmed on compact save.
    history.execute(
      new PixelEditCommand({
        layerId: draw.id,
        rect: Rect.create(0, 0, 4, 4),
        before: { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) },
        after: { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) },
      }),
      { stack }
    );

    const state = ProjectCodec.buildState({
      id: "p", name: "t", stack, history, settings: defaultSettings(), createdAt: 0, compact: true,
    });
    const json = ProjectCodec.encode(state);
    assertTrue(json.length < 200_000, `compact project JSON should be < 200 KB, got ${json.length} bytes`);
    assertEqual(state.history.past.length, 0, "compact state must not persist history");
    assertEqual(state.history.future.length, 0, "compact state must not persist future history");
  });

  it("decode(encode(compact)) restores layer count and the filled background", () => {
    const stack = new LayerStack(64, 64, factory);
    const bg = new Layer({ name: "배경", width: 64, height: 64, factory });
    bg.getCtx().fillStyle = "#ffffff";
    bg.getCtx().fillRect(0, 0, 64, 64);
    stack.add(bg);
    const draw = new Layer({ name: "레이어 1", width: 64, height: 64, factory });
    stack.add(draw);
    const history = new CommandHistory();

    const json = ProjectCodec.encode(ProjectCodec.buildState({
      id: "p", name: "t", stack, history, settings: defaultSettings(), createdAt: 0, compact: true,
    }));
    const state = ProjectCodec.decode(json);
    assertEqual(state.layers.length, 2);

    // Rebuild the stack to confirm the background survived compression.
    const stack2 = new LayerStack(state.meta.width, state.meta.height, factory);
    stack2.reset(state.layers, state.meta.width, state.meta.height, state.activeLayerId);
    const bgLayer = stack2.getAll()[0]!;
    const px = bgLayer.getPixels(32, 32, 1, 1).data;
    assertEqual(px[0], 255, "background should still be white after compact round-trip");
    assertEqual(px[3], 255, "background should still be opaque");
  });
});

// ---- Issue 4: history actually records a shape commit --------------------

describe("History records shape commits (issue 4)", () => {
  it("a completed rectangle stroke pushes exactly one history entry", () => {
    const stack = blankStack(1);
    const layer = stack.getAll()[0]!;
    stack.setActive(layer.id);
    const history = new CommandHistory();
    const ctx = toolCtxFor(stack, history);
    const tool = new RectTool();
    tool.filled = true;
    tool.onPointerDown(pointer(4, 4), ctx);
    tool.onPointerMove(pointer(20, 20), ctx);
    tool.onPointerUp(pointer(20, 20), ctx);
    assertEqual(history.size().past, 1, "one rectangle stroke should produce one history command");
  });
});

// ---- Issue 5: add layer grows the stack + respects the cap --------------

describe("addLayer via AddLayerCommand (issue 5)", () => {
  it("adding a layer takes the stack from 2 to 3", () => {
    const stack = blankStack(2);
    const history = new CommandHistory();
    const newLayer = new Layer({ name: "레이어 3", width: 32, height: 32, factory });
    history.execute(
      new AddLayerCommand({ snapshot: newLayer.serialize({ compact: true }), index: stack.size() }),
      { stack }
    );
    assertEqual(stack.size(), 3);
  });
});

// ---- Issue 7: PNG import renders onto a fresh layer ---------------------

describe("importPngFile (issue 7)", () => {
  it("creates a layer with the project dimensions and draws the bitmap", async () => {
    // Build a fake File whose ImageBitmap loader returns a small canvas-backed
    // source — that's what the production drawImage path needs.
    const src = new MockHTMLCanvasElement(8, 8);
    const sctx = src.getContext("2d")!;
    sctx.fillStyle = "rgba(10,200,30,1)";
    sctx.fillRect(0, 0, 8, 8);

    const g = globalThis as unknown as { createImageBitmap?: (f: unknown) => Promise<unknown> };
    const prevCIB = g.createImageBitmap;
    g.createImageBitmap = async () => src as unknown as ImageBitmap;
    try {
      const fakeFile = { name: "green.png" } as unknown as File;
      const layer = await importPngFile(fakeFile, 32, 32, factory, "green.png");
      assertEqual(layer.width, 32);
      assertEqual(layer.height, 32);
      const center = layer.getPixels(16, 16, 1, 1).data;
      assertEqual(center[0], 10, "R should come from the source bitmap");
      assertEqual(center[1], 200, "G should come from the source bitmap");
      assertEqual(center[2], 30, "B should come from the source bitmap");
    } finally {
      g.createImageBitmap = prevCIB;
    }
  });
});

// ---- Issue 8: text tool exists and commits on pointer-down --------------

describe("TextTool (issue 8)", () => {
  it("is registered in the default tool registry with a Korean label", () => {
    const reg = buildDefaultRegistry();
    const desc = reg.getDescriptor("text");
    assertTrue(desc !== undefined, "text tool should be registered as 'text'");
    assertTrue(desc!.label.length > 0, "text tool should carry a Korean label");
    assertTrue(reg.get("text") instanceof TextTool || (reg.get("text") as unknown as { id: string }).id === "text");
  });

  it("a pointer-down with a queued string stamps text and pushes one history entry", () => {
    const stack = blankStack(1);
    const layer = stack.getAll()[0]!;
    stack.setActive(layer.id);
    const history = new CommandHistory();
    const ctx = toolCtxFor(stack, history);

    // Fill the layer white so the text stamp leaves a visible diff.
    const lctx = layer.getCtx();
    lctx.fillStyle = "#ffffff";
    lctx.fillRect(0, 0, 32, 32);

    const tool = new TextTool();
    // Inject the text via the tool's test seam instead of popping a prompt().
    tool.setNextText("안");
    ctx.settings.color = { r: 0, g: 0, b: 0, a: 255 };
    tool.onPointerDown(pointer(4, 16), ctx);
    tool.onPointerUp(pointer(4, 16), ctx);

    assertEqual(history.size().past, 1, "text stamp should produce exactly one history command");
  });
});
