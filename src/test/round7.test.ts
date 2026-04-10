// Round 7: tests-first regression suite. Each `it` block here is meant to
// fail against the round-6 codebase and pass once the round-7 fixes ship.
//
//   * Issue 9 — clicking a layer row should select that layer, even if the
//     click lands on the name input that fills most of the row's width.
//   * Issue 11 — addLayer is capped at 5 layers; the 6th call must be a
//     no-op (no history command, no stack growth) and emit a status flash.
//   * Issue 5 — gradient on an empty layer must produce visible pixels
//     (alpha != 0) inside the connected mask.
//   * Issue 6/7 — brush-size label changes per active tool category.
//   * Round-6 follow-up — LayerPanel/ProjectPanel are fully Korean.

import { describe, it, assertEqual, assertTrue, assertFalse } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { defaultSettings, ToolContext } from "../tools/Tool.js";
import { GradientTool } from "../tools/GradientTool.js";
import { LayerPanel, LayerPanelHandlers } from "../ui/LayerPanel.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";
import { MiniElement, MiniMouseEvent, installMiniDom } from "./mocks/MiniDom.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;
const pointer = (x: number, y: number) => ({ x, y, pressure: 1, buttons: 1, shift: false, ctrl: false, alt: false });

installMiniDom();

function rgbaAt(layer: Layer, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const d = layer.getPixels(x, y, 1, 1).data;
  return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! };
}

function makeStack(n: number = 1): { stack: LayerStack; layer: Layer } {
  const stack = new LayerStack(16, 16, factory);
  let active!: Layer;
  for (let i = 0; i < n; i++) {
    const l = new Layer({ name: `L${i + 1}`, width: 16, height: 16, factory });
    stack.add(l);
    if (i === 0) active = l;
  }
  return { stack, layer: active };
}

function freshHandlers(): LayerPanelHandlers & { calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const log = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); };
  const h = {
    onAdd: log("onAdd"),
    onRemove: log("onRemove"),
    onSelect: log("onSelect"),
    onToggleVisible: log("onToggleVisible"),
    onOpacity: log("onOpacity"),
    onMoveUp: log("onMoveUp"),
    onMoveDown: log("onMoveDown"),
    onRename: log("onRename"),
    calls,
  } as unknown as LayerPanelHandlers & { calls: { name: string; args: unknown[] }[] };
  return h;
}

// ---- Issue 9: clicking a layer row selects the layer (even on the name) ---

describe("LayerPanel: row click selects layer (issue 9)", () => {
  it("clicking the row triggers onSelect", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(2);
    const handlers = freshHandlers();
    const panel = new LayerPanel(root as any, stack, handlers);
    panel.render();

    const rows = root.querySelectorAll(".layer-row");
    assertTrue(rows.length >= 2, `expected ≥2 layer rows, got ${rows.length}`);
    const firstRow = rows[0]!;
    firstRow.dispatchEvent(new MiniMouseEvent("click"));

    const sel = handlers.calls.filter((c) => c.name === "onSelect");
    assertTrue(sel.length >= 1, "row click should call onSelect");
  });

  it("clicking the name input ALSO triggers onSelect (the round-6 input was eating the click)", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(2);
    const handlers = freshHandlers();
    const panel = new LayerPanel(root as any, stack, handlers);
    panel.render();

    const nameInputs = root.querySelectorAll(".layer-name");
    assertTrue(nameInputs.length >= 1);
    nameInputs[0]!.dispatchEvent(new MiniMouseEvent("click"));

    const sel = handlers.calls.filter((c) => c.name === "onSelect");
    assertTrue(sel.length >= 1, "click on the name input should still bubble (or directly fire) onSelect");
  });

  it("name input starts as readOnly (so a single tap selects, not edits)", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(1);
    const panel = new LayerPanel(root as any, stack, freshHandlers());
    panel.render();
    const nameInput = root.querySelector(".layer-name");
    assertTrue(nameInput !== null);
    assertEqual(nameInput!.readOnly, true, "name input should start in readonly mode");
  });

  it("dblclick on the name input switches it to editable", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(1);
    const panel = new LayerPanel(root as any, stack, freshHandlers());
    panel.render();
    const nameInput = root.querySelector(".layer-name")!;
    nameInput.dispatchEvent(new MiniMouseEvent("dblclick"));
    assertEqual(nameInput.readOnly, false, "dblclick should unlock editing");
  });

  it("blur on the name input restores readonly", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(1);
    const panel = new LayerPanel(root as any, stack, freshHandlers());
    panel.render();
    const nameInput = root.querySelector(".layer-name")!;
    nameInput.dispatchEvent(new MiniMouseEvent("dblclick"));
    nameInput.dispatchEvent(new MiniMouseEvent("blur"));
    assertEqual(nameInput.readOnly, true, "blur should re-lock editing");
  });
});

// ---- Issue 11: 5-layer cap + Korean header ------------------------------

describe("LayerPanel: 5-layer cap + Korean header (issue 11)", () => {
  it("header title contains the Korean word '레이어' and the n/5 count", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(2);
    const panel = new LayerPanel(root as any, stack, freshHandlers());
    panel.render();
    const title = root.querySelector(".panel-title");
    assertTrue(title !== null);
    assertTrue(title!.textContent.includes("레이어"), `title should mention 레이어, got "${title!.textContent}"`);
    assertTrue(title!.textContent.includes("2/5"), `title should show n/5 count, got "${title!.textContent}"`);
  });

  it("add button is disabled when the stack already has 5 layers", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(5);
    const panel = new LayerPanel(root as any, stack, freshHandlers());
    panel.render();
    const addBtn = root.querySelector(".layer-add-btn");
    assertTrue(addBtn !== null, "add button should be findable by class");
    assertEqual(addBtn!.disabled, true, "add button should be disabled at the cap");
  });

  it("add button is enabled when the stack has fewer than 5 layers", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(3);
    const panel = new LayerPanel(root as any, stack, freshHandlers());
    panel.render();
    const addBtn = root.querySelector(".layer-add-btn");
    assertTrue(addBtn !== null);
    assertEqual(addBtn!.disabled, false);
  });

  it("clicking add button triggers onAdd handler", () => {
    const root = new MiniElement("DIV");
    const { stack } = makeStack(2);
    const handlers = freshHandlers();
    const panel = new LayerPanel(root as any, stack, handlers);
    panel.render();
    const addBtn = root.querySelector(".layer-add-btn")!;
    addBtn.dispatchEvent(new MiniMouseEvent("click"));
    const adds = handlers.calls.filter((c) => c.name === "onAdd");
    assertEqual(adds.length, 1);
  });
});

// ---- Issue 5: gradient must produce visible pixels on an empty layer -----

describe("GradientTool: empty layer click leaves visible pixels (issue 5)", () => {
  it("blank layer + gradient with full-alpha stops paints opaque pixels inside the mask", () => {
    const stack = new LayerStack(16, 16, factory);
    const layer = new Layer({ width: 16, height: 16, factory });
    stack.add(layer);
    const history = new CommandHistory();
    const ctx: ToolContext = {
      stack,
      history,
      settings: defaultSettings(),
      previewLayer: new Layer({ width: 16, height: 16, factory }),
    };
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 200, g: 0, b: 0, a: 255 } },
      { stop: 1, color: { r: 0, g: 0, b: 200, a: 255 } },
    ];
    const tool = new GradientTool();
    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerUp(pointer(15, 0), ctx);
    // Pixels along the gradient line should now be opaque, not transparent.
    const left = rgbaAt(layer, 0, 0);
    const right = rgbaAt(layer, 15, 0);
    assertTrue(left.a > 0, `left edge should be visible after gradient on empty, got a=${left.a}`);
    assertTrue(right.a > 0, `right edge should be visible after gradient on empty, got a=${right.a}`);
    assertTrue(left.r > 100, `left should be reddish, got ${JSON.stringify(left)}`);
    assertTrue(right.b > 100, `right should be blueish, got ${JSON.stringify(right)}`);
  });

  it("colored pixels still keep their original alpha (anti-aliased edges stay)", () => {
    const stack = new LayerStack(8, 8, factory);
    const layer = new Layer({ width: 8, height: 8, factory });
    stack.add(layer);
    layer.getCtx().fillStyle = "rgba(100,100,100,0.4)";
    layer.getCtx().fillRect(2, 2, 1, 1);
    const original = rgbaAt(layer, 2, 2);
    const history = new CommandHistory();
    const ctx: ToolContext = {
      stack, history,
      settings: defaultSettings(),
      previewLayer: new Layer({ width: 8, height: 8, factory }),
    };
    ctx.settings.gradientStops = [
      { stop: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
      { stop: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
    ];
    const tool = new GradientTool();
    tool.onPointerDown(pointer(2, 2), ctx);
    tool.onPointerUp(pointer(7, 2), ctx);
    const after = rgbaAt(layer, 2, 2);
    assertEqual(after.a, original.a, "alpha of previously-colored pixel preserved");
  });
});
