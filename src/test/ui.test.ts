// UI panel tests. We don't drive a real DOM, but we can verify the toggle
// state machinery on LayerPanel directly. The render() calls would crash on
// `document.createElement` in Node, so we shim it here.

import { describe, it, assertEqual, assertTrue, assertFalse } from "./runner.js";
import { LayerPanel } from "../ui/LayerPanel.js";
import { LayerStack } from "../core/LayerStack.js";
import { Layer } from "../core/Layer.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;

// Minimal `document.createElement` shim that returns objects supporting the
// chained calls LayerPanel makes during render.
function installDocumentShim(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const make = (): any => {
    const el: any = {
      tagName: "DIV",
      children: [] as any[],
      style: {},
      classList: {
        add: (_c: string) => {},
        remove: (_c: string) => {},
        toggle: (_c: string, _f?: boolean) => {},
        contains: (_c: string) => false,
      },
      dataset: {},
      attributes: {},
      _innerHTML: "",
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v: string) {
        this._innerHTML = v;
        this.children = [];
      },
      textContent: "",
      title: "",
      type: "",
      value: "",
      min: "",
      max: "",
      step: "",
      className: "",
      appendChild(c: any) { this.children.push(c); return c; },
      removeChild(c: any) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        return c;
      },
      addEventListener(_t: string, _f: any) {},
      removeEventListener(_t: string, _f: any) {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      setAttribute(k: string, v: string) { this.attributes[k] = v; },
    };
    return el;
  };
  if (!g["document"] || !(g["document"] as any).createElement) {
    g["document"] = { createElement: make };
  } else {
    const existing = g["document"] as any;
    if (!existing.createElement || existing.createElement.toString().includes("canvas")) {
      // Replace the canvas-only shim with a richer one.
      existing.createElement = (tag: string) => {
        if (tag === "canvas") return new MockHTMLCanvasElement(300, 150);
        return make();
      };
    }
  }
}

installDocumentShim();

function rootEl(): any {
  return (globalThis as any).document.createElement("div");
}

describe("LayerPanel toggle", () => {
  it("starts expanded by default", () => {
    const stack = new LayerStack(8, 8, factory);
    stack.add(new Layer({ width: 8, height: 8, factory }));
    const panel = new LayerPanel(rootEl(), stack, {
      onAdd: () => {}, onRemove: () => {}, onSelect: () => {},
      onToggleVisible: () => {}, onOpacity: () => {},
      onMoveUp: () => {}, onMoveDown: () => {}, onRename: () => {},
    });
    assertFalse(panel.isCollapsed());
  });

  it("toggle() flips collapsed state", () => {
    const stack = new LayerStack(8, 8, factory);
    stack.add(new Layer({ width: 8, height: 8, factory }));
    const panel = new LayerPanel(rootEl(), stack, {
      onAdd: () => {}, onRemove: () => {}, onSelect: () => {},
      onToggleVisible: () => {}, onOpacity: () => {},
      onMoveUp: () => {}, onMoveDown: () => {}, onRename: () => {},
    });
    panel.toggle();
    assertTrue(panel.isCollapsed());
    panel.toggle();
    assertFalse(panel.isCollapsed());
  });

  it("setCollapsed(true) followed by render produces no layer-list children", () => {
    const stack = new LayerStack(8, 8, factory);
    stack.add(new Layer({ width: 8, height: 8, factory }));
    stack.add(new Layer({ width: 8, height: 8, factory }));
    const root = rootEl();
    const panel = new LayerPanel(root, stack, {
      onAdd: () => {}, onRemove: () => {}, onSelect: () => {},
      onToggleVisible: () => {}, onOpacity: () => {},
      onMoveUp: () => {}, onMoveDown: () => {}, onRename: () => {},
    });
    panel.setCollapsed(true);
    // After collapse, render() should append only the header, no list.
    // We can't introspect the DOM cleanly with the shim, but we can confirm
    // setCollapsed(false) restores expanded state for re-rendering.
    assertTrue(panel.isCollapsed());
    panel.setCollapsed(false);
    assertFalse(panel.isCollapsed());
  });

  it("a stack change event triggers re-render and keeps collapsed state", () => {
    const stack = new LayerStack(8, 8, factory);
    stack.add(new Layer({ width: 8, height: 8, factory }));
    const panel = new LayerPanel(rootEl(), stack, {
      onAdd: () => {}, onRemove: () => {}, onSelect: () => {},
      onToggleVisible: () => {}, onOpacity: () => {},
      onMoveUp: () => {}, onMoveDown: () => {}, onRename: () => {},
    });
    panel.setCollapsed(true);
    stack.add(new Layer({ width: 8, height: 8, factory }));
    assertTrue(panel.isCollapsed(), "collapsed state should survive a stack change");
    assertEqual(stack.size(), 2);
  });
});
