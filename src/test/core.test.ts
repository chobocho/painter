import { describe, it, assertEqual, assertTrue, assertDeepEqual } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { DisplayCanvas } from "../core/Canvas.js";
import { Rect } from "../util/Rect.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";

const mockFactory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;

describe("Layer", () => {
  it("creates with given size", () => {
    const l = new Layer({ width: 32, height: 16, factory: mockFactory });
    assertEqual(l.width, 32);
    assertEqual(l.height, 16);
    assertTrue(l.id.length > 0);
  });

  it("clear wipes pixels in rect", () => {
    const l = new Layer({ width: 8, height: 8, factory: mockFactory });
    const ctx = l.getCtx();
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 8, 8);
    const before = l.getPixels(0, 0, 8, 8);
    assertEqual(before.data[0], 255); // R
    l.clear(0, 0, 4, 4);
    const after = l.getPixels(0, 0, 4, 4);
    assertEqual(after.data[3], 0); // A
    const right = l.getPixels(4, 4, 4, 4);
    assertEqual(right.data[0], 255);
  });

  it("serialize captures meta + pixels", () => {
    const l = new Layer({ width: 4, height: 4, name: "Test", factory: mockFactory });
    l.opacity = 0.5;
    const snap = l.serialize();
    assertEqual(snap.name, "Test");
    assertEqual(snap.opacity, 0.5);
    assertEqual(snap.width, 4);
    const hasPixels = (typeof snap.rawRGBA === "string" && snap.rawRGBA.length > 0)
      || (typeof snap.rleRGBA === "string" && snap.rleRGBA.length > 0);
    assertTrue(hasPixels, "default serialize() should still ship pixel data for full-fidelity in-memory undo");
  });

  it("deserialize round-trips", () => {
    const l = new Layer({ width: 4, height: 4, factory: mockFactory });
    const ctx = l.getCtx();
    ctx.fillStyle = "rgba(10,20,30,1)";
    ctx.fillRect(0, 0, 1, 1);
    const snap = l.serialize();
    const l2 = Layer.deserialize(snap, mockFactory);
    const px = l2.getPixels(0, 0, 1, 1);
    assertEqual(px.data[0], 10);
    assertEqual(px.data[1], 20);
    assertEqual(px.data[2], 30);
  });
});

describe("LayerStack", () => {
  it("add sets first layer active", () => {
    const stack = new LayerStack(16, 16, mockFactory);
    const a = new Layer({ width: 16, height: 16, factory: mockFactory });
    stack.add(a);
    assertEqual(stack.getActive(), a);
  });

  it("remove updates active correctly", () => {
    const stack = new LayerStack(16, 16, mockFactory);
    const a = new Layer({ width: 16, height: 16, factory: mockFactory });
    const b = new Layer({ width: 16, height: 16, factory: mockFactory });
    stack.add(a);
    stack.add(b);
    stack.setActive(b.id);
    stack.remove(b.id);
    assertEqual(stack.getActive(), a);
  });

  it("move reorders", () => {
    const stack = new LayerStack(16, 16, mockFactory);
    const a = new Layer({ width: 16, height: 16, factory: mockFactory });
    const b = new Layer({ width: 16, height: 16, factory: mockFactory });
    stack.add(a);
    stack.add(b);
    stack.move(a.id, 1);
    assertDeepEqual(stack.getAll().map(l => l.id), [b.id, a.id]);
  });

  it("setOpacity clamps", () => {
    const stack = new LayerStack(16, 16, mockFactory);
    const a = new Layer({ width: 16, height: 16, factory: mockFactory });
    stack.add(a);
    stack.setOpacity(a.id, 2);
    assertEqual(a.opacity, 1);
    stack.setOpacity(a.id, -1);
    assertEqual(a.opacity, 0);
  });

  it("dirty rect accumulates union", () => {
    const stack = new LayerStack(100, 100, mockFactory);
    stack.consumeDirty();
    stack.markDirty(Rect.create(10, 10, 5, 5));
    stack.markDirty(Rect.create(20, 20, 5, 5));
    const r = stack.consumeDirty();
    assertDeepEqual(r, { x: 10, y: 10, w: 15, h: 15 });
    assertTrue(Rect.isEmpty(stack.consumeDirty()));
  });

  it("compositeTo respects visibility", () => {
    const stack = new LayerStack(8, 8, mockFactory);
    const a = new Layer({ width: 8, height: 8, factory: mockFactory });
    a.getCtx().fillStyle = "red";
    a.getCtx().fillRect(0, 0, 8, 8);
    stack.add(a);

    const target = new MockHTMLCanvasElement(8, 8);
    const tctx = target.getContext("2d")!;
    stack.compositeTo(tctx as any);
    assertEqual(target.pixels[0], 255); // R from layer

    a.visible = false;
    target.pixels.fill(0);
    stack.compositeTo(tctx as any);
    assertEqual(target.pixels[0], 0); // hidden layer not drawn
  });

  it("serialize/deserialize round trip preserves layers", () => {
    const stack = new LayerStack(4, 4, mockFactory);
    const a = new Layer({ name: "L1", width: 4, height: 4, factory: mockFactory });
    a.getCtx().fillStyle = "rgba(50,60,70,1)";
    a.getCtx().fillRect(0, 0, 1, 1);
    stack.add(a);
    const snaps = stack.serializeAll();
    const stack2 = LayerStack.fromSnapshots(snaps, 4, 4, mockFactory);
    assertEqual(stack2.size(), 1);
    const px = stack2.getAll()[0]!.getPixels(0, 0, 1, 1);
    assertEqual(px.data[0], 50);
    assertEqual(px.data[1], 60);
  });
});

describe("DisplayCanvas", () => {
  it("resizeDisplay sets device pixel size by DPR", () => {
    const el = new MockHTMLCanvasElement(1, 1);
    const dc = new DisplayCanvas(el as any, 1000, 800, 2);
    dc.resizeDisplay(500, 400);
    assertEqual(el.width, 1000);
    assertEqual(el.height, 800);
  });

  it("cssToProject maps coordinates", () => {
    const el = new MockHTMLCanvasElement(1, 1);
    const dc = new DisplayCanvas(el as any, 1000, 1000, 1);
    dc.resizeDisplay(500, 500);
    const p = dc.cssToProject(250, 100);
    assertEqual(p.x, 500);
    assertEqual(p.y, 200);
  });
});
