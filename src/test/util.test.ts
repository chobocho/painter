import { describe, it, assertEqual, assertTrue, assertFalse, assertDeepEqual } from "./runner.js";
import { Rect } from "../util/Rect.js";
import { Color } from "../util/Color.js";
import { Emitter } from "../util/Events.js";

describe("Rect", () => {
  it("union of two overlapping rects", () => {
    const a = Rect.create(0, 0, 10, 10);
    const b = Rect.create(5, 5, 10, 10);
    const u = Rect.union(a, b);
    assertDeepEqual(u, { x: 0, y: 0, w: 15, h: 15 });
  });

  it("union with empty returns the other", () => {
    const a = Rect.empty();
    const b = Rect.create(2, 3, 4, 5);
    assertDeepEqual(Rect.union(a, b), b);
  });

  it("intersect of disjoint rects is empty", () => {
    const a = Rect.create(0, 0, 5, 5);
    const b = Rect.create(10, 10, 5, 5);
    assertTrue(Rect.isEmpty(Rect.intersect(a, b)));
  });

  it("intersect of overlapping rects", () => {
    const a = Rect.create(0, 0, 10, 10);
    const b = Rect.create(5, 5, 10, 10);
    assertDeepEqual(Rect.intersect(a, b), { x: 5, y: 5, w: 5, h: 5 });
  });

  it("fromPoints handles reversed coords", () => {
    const r = Rect.fromPoints(10, 20, 5, 5);
    assertDeepEqual(r, { x: 5, y: 5, w: 5, h: 15 });
  });

  it("expand grows by n on every side", () => {
    const r = Rect.expand(Rect.create(5, 5, 10, 10), 2);
    assertDeepEqual(r, { x: 3, y: 3, w: 14, h: 14 });
  });

  it("contains point check", () => {
    const r = Rect.create(0, 0, 10, 10);
    assertTrue(Rect.contains(r, 5, 5));
    assertFalse(Rect.contains(r, 10, 10));
    assertFalse(Rect.contains(r, -1, 0));
  });
});

describe("Color", () => {
  it("parses #rgb", () => {
    assertDeepEqual(Color.parse("#f00"), { r: 255, g: 0, b: 0, a: 255 });
  });
  it("parses #rrggbb", () => {
    assertDeepEqual(Color.parse("#00ff00"), { r: 0, g: 255, b: 0, a: 255 });
  });
  it("parses rgba()", () => {
    assertDeepEqual(Color.parse("rgba(10,20,30,0.5)"), { r: 10, g: 20, b: 30, a: 128 });
  });
  it("parses named colors", () => {
    assertDeepEqual(Color.parse("red"), { r: 255, g: 0, b: 0, a: 255 });
  });
  it("distanceSq is symmetric and zero for same color", () => {
    const a = { r: 100, g: 100, b: 100, a: 255 };
    const b = { r: 110, g: 100, b: 100, a: 255 };
    assertEqual(Color.distanceSq(a, a), 0);
    assertEqual(Color.distanceSq(a, b), Color.distanceSq(b, a));
    assertEqual(Color.distanceSq(a, b), 100);
  });
  it("toHex round-trips", () => {
    const c = { r: 18, g: 52, b: 86, a: 255 };
    assertEqual(Color.toHex(c), "#123456");
  });
  it("lerp interpolates", () => {
    const a = { r: 0, g: 0, b: 0, a: 255 };
    const b = { r: 100, g: 100, b: 100, a: 255 };
    assertDeepEqual(Color.lerp(a, b, 0.5), { r: 50, g: 50, b: 50, a: 255 });
  });
});

describe("Emitter", () => {
  it("emits to listeners", () => {
    const e = new Emitter<{ change: number }>();
    let got = -1;
    e.on("change", (v) => (got = v));
    e.emit("change", 42);
    assertEqual(got, 42);
  });
  it("off removes listener", () => {
    const e = new Emitter<{ change: number }>();
    let count = 0;
    const fn = () => count++;
    const stop = e.on("change", fn);
    e.emit("change", 1);
    stop();
    e.emit("change", 2);
    assertEqual(count, 1);
  });
});
