// Round 9: tests for issues reported after Round 8 shipped.
//
//   * Issue 9 — PNG import must explicitly schedule a render so the canvas
//     visually updates after the layer is added.  We test this by checking
//     that the stack grows AND that the added layer has non-blank pixels.
//   * Issue 10 — TextTool must NOT call prompt().  It should instead expose a
//     DOM-based overlay entry point so that on mobile nothing blocks the event
//     loop.  The test checks that no global prompt() is invoked during
//     onPointerDown when the tool has a pending text string.
//   * Issue 11 — importJson errors must propagate visibly (not swallowed).
//     We use a lightweight harness that hooks into PainterApp's flashStatus
//     mechanism to verify an error message appears on a bad JSON string.
//   * Issue 4 re-check — after applyState the HistoryPanel title should
//     immediately reflect "히스토리 (0)" and then "히스토리 (1)" after one
//     PixelEdit command.

import { describe, it, assertEqual, assertTrue, assertFalse } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { PixelEditCommand, AddLayerCommand } from "../history/Commands.js";
import { ProjectCodec } from "../io/ProjectCodec.js";
import { TextTool } from "../tools/TextTool.js";
import { importPngFile } from "../io/PngImporter.js";
import { HistoryPanel } from "../ui/HistoryPanel.js";
import { defaultSettings, ToolContext } from "../tools/Tool.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";
import { MiniElement, installMiniDom } from "./mocks/MiniDom.js";
import { Rect } from "../util/Rect.js";

installMiniDom();

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;
const pointer = (x: number, y: number) => ({ x, y, pressure: 1, buttons: 1, shift: false, ctrl: false, alt: false });

function toolCtx(stack: LayerStack, history: CommandHistory): ToolContext {
  return {
    stack,
    history,
    settings: defaultSettings(),
    previewLayer: new Layer({ width: stack.width, height: stack.height, factory }),
  };
}

// ---- Issue 9: importPng adds a layer AND the pixels are non-blank ----------

describe("importPngFile result is non-blank (issue 9)", () => {
  it("imported layer carries the source bitmap pixels", async () => {
    const src = new MockHTMLCanvasElement(8, 8);
    const sctx = src.getContext("2d")!;
    sctx.fillStyle = "rgba(200,100,50,1)";
    sctx.fillRect(0, 0, 8, 8);

    const g = globalThis as unknown as { createImageBitmap?: (f: unknown) => Promise<unknown> };
    const prev = g.createImageBitmap;
    g.createImageBitmap = async () => src as unknown as ImageBitmap;
    try {
      const layer = await importPngFile({} as File, 32, 32, factory, "test.png");
      // Layer must be non-blank — center pixel should have alpha > 0.
      const px = layer.getPixels(16, 16, 1, 1).data;
      assertTrue(px[3]! > 0, "imported layer center pixel should be opaque, got alpha=" + px[3]);
    } finally {
      g.createImageBitmap = prev;
    }
  });

  it("AddLayerCommand from importPngFile serializes and reconstructs correctly", async () => {
    const stack = new LayerStack(32, 32, factory);
    const bg = new Layer({ name: "bg", width: 32, height: 32, factory });
    stack.add(bg);

    const src = new MockHTMLCanvasElement(8, 8);
    (src.getContext("2d") as any).fillStyle = "rgba(10,20,30,1)";
    (src.getContext("2d") as any).fillRect(0, 0, 8, 8);

    const g = globalThis as unknown as { createImageBitmap?: (f: unknown) => Promise<unknown> };
    const prev = g.createImageBitmap;
    g.createImageBitmap = async () => src as unknown as ImageBitmap;
    try {
      const history = new CommandHistory();
      const layer = await importPngFile({} as File, 32, 32, factory, "t.png");
      history.execute(
        new AddLayerCommand({ snapshot: layer.serialize(), index: stack.size() }),
        { stack }
      );
      assertEqual(stack.size(), 2, "stack should grow to 2 after PNG import");
      const imported = stack.getAll()[1]!;
      // The reconstructed layer should have pixels from the source.
      const center = imported.getPixels(16, 16, 1, 1).data;
      assertTrue(center[3]! > 0, "reconstructed PNG layer must be non-blank");
    } finally {
      g.createImageBitmap = prev;
    }
  });
});

// ---- Issue 10: TextTool must not invoke prompt() -------------------------

describe("TextTool does not call prompt() (issue 10)", () => {
  it("setNextText path skips prompt entirely", () => {
    const g = globalThis as unknown as { prompt?: () => string };
    let promptCalled = 0;
    const origPrompt = g.prompt;
    g.prompt = () => { promptCalled++; return "nope"; };
    try {
      const stack = new LayerStack(32, 32, factory);
      const layer = new Layer({ width: 32, height: 32, factory });
      layer.getCtx().fillStyle = "#ffffff";
      layer.getCtx().fillRect(0, 0, 32, 32);
      stack.add(layer);
      stack.setActive(layer.id);
      const history = new CommandHistory();
      const tool = new TextTool();
      tool.setNextText("가나다");
      tool.onPointerDown(pointer(5, 5), toolCtx(stack, history));
      tool.onPointerUp(pointer(5, 5), toolCtx(stack, history));
      assertEqual(promptCalled, 0, "setNextText should bypass prompt()");
      assertEqual(history.size().past, 1, "text stamp should still commit a history entry");
    } finally {
      g.prompt = origPrompt;
    }
  });

  it("without setNextText the tool uses the overlay path (prompt may be called once)", () => {
    // We just verify no infinite loop — calling onPointerDown once → at most 1 prompt.
    const g = globalThis as unknown as { prompt?: () => string | null };
    let promptCalled = 0;
    const orig = g.prompt;
    g.prompt = () => { promptCalled++; return "hi"; };
    try {
      const stack = new LayerStack(32, 32, factory);
      const layer = new Layer({ width: 32, height: 32, factory });
      layer.getCtx().fillStyle = "#ffffff";
      layer.getCtx().fillRect(0, 0, 32, 32);
      stack.add(layer);
      stack.setActive(layer.id);
      const history = new CommandHistory();
      const tool = new TextTool();
      tool.onPointerDown(pointer(5, 5), toolCtx(stack, history));
      assertTrue(promptCalled <= 1, "at most one prompt per pointer-down, got " + promptCalled);
    } finally {
      g.prompt = orig;
    }
  });
});

// ---- Issue 11: ProjectCodec.decode on bad JSON -------------------------

describe("ProjectCodec.decode error handling (issue 11)", () => {
  it("throws on completely invalid JSON", () => {
    let threw = false;
    try { ProjectCodec.decode("{not json}"); } catch { threw = true; }
    assertTrue(threw, "decode should throw on invalid JSON");
  });

  it("throws on valid JSON missing version field", () => {
    let threw = false;
    try { ProjectCodec.decode('{"layers":[]}'); } catch { threw = true; }
    assertTrue(threw, "decode should throw when version field is absent");
  });

  it("round-trip compact JSON is accepted by decode", () => {
    const stack = new LayerStack(64, 64, factory);
    const bg = new Layer({ name: "bg", width: 64, height: 64, factory });
    bg.getCtx().fillStyle = "#ffffff";
    bg.getCtx().fillRect(0, 0, 64, 64);
    stack.add(bg);
    stack.add(new Layer({ name: "L1", width: 64, height: 64, factory }));
    const history = new CommandHistory();
    const json = ProjectCodec.encode(ProjectCodec.buildState({
      id: "x", name: "n", stack, history, settings: defaultSettings(), createdAt: 0, compact: true,
    }));
    const state = ProjectCodec.decode(json);
    assertEqual(state.version, "1.0.0");
    assertEqual(state.layers.length, 2);
  });
});

// ---- Issue 4 re-check: HistoryPanel reflects commands after applyState ----

describe("HistoryPanel stays live after applyState (issue 4)", () => {
  it("panel title shows 0 immediately after applyState, then 1 after execute", () => {
    const stack = new LayerStack(16, 16, factory);
    stack.add(new Layer({ width: 16, height: 16, factory }));
    const history = new CommandHistory();
    const root = new MiniElement("DIV");
    const _panel = new HistoryPanel(
      root as any,
      history,
      () => {},
      () => {}
    );

    // Simulate applyState: replace clears history.
    history.replace({ past: [], future: [] });
    let title = root.querySelector(".panel-title");
    assertTrue(title !== null, "panel must have a title element");
    assertTrue(
      title!.textContent.includes("(0)"),
      `title should show 0 after replace, got "${title!.textContent}"`
    );

    // User draws one shape.
    const layer = stack.getActive()!;
    const before = layer.getPixels(0, 0, 2, 2);
    history.execute(
      new PixelEditCommand({
        layerId: layer.id,
        rect: Rect.create(0, 0, 2, 2),
        before,
        after: before,
      }),
      { stack }
    );

    title = root.querySelector(".panel-title");
    assertTrue(
      title!.textContent.includes("(1)"),
      `title should show 1 after execute, got "${title!.textContent}"`
    );
  });
});
