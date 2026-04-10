import { describe, it, assertEqual, assertTrue } from "./runner.js";
import { IndexedDBStore } from "../storage/IndexedDBStore.js";
import { AutoSaver } from "../storage/AutoSaver.js";
import { LayerStack } from "../core/LayerStack.js";
import { Layer } from "../core/Layer.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { ProjectCodec } from "../io/ProjectCodec.js";
import { defaultSettings } from "../tools/Tool.js";
import { removeBackground } from "../io/BackgroundRemover.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";
import { MockIndexedDB } from "./mocks/IndexedDB.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;

describe("IndexedDBStore", () => {
  it("put/get round trip", async () => {
    MockIndexedDB.reset();
    const store = new IndexedDBStore(MockIndexedDB as any);
    await store.open();
    await store.putProject({
      id: "p1", name: "Test", createdAt: 1, updatedAt: 2,
      width: 100, height: 100, projectJson: "{}",
    });
    const got = await store.getProject("p1");
    assertEqual(got?.name, "Test");
  });

  it("listProjects sorts by updatedAt desc", async () => {
    MockIndexedDB.reset();
    const store = new IndexedDBStore(MockIndexedDB as any);
    await store.open();
    await store.putProject({ id: "a", name: "A", createdAt: 1, updatedAt: 1, width: 1, height: 1, projectJson: "{}" });
    await store.putProject({ id: "b", name: "B", createdAt: 1, updatedAt: 5, width: 1, height: 1, projectJson: "{}" });
    await store.putProject({ id: "c", name: "C", createdAt: 1, updatedAt: 3, width: 1, height: 1, projectJson: "{}" });
    const list = await store.listProjects();
    assertEqual(list[0]!.id, "b");
    assertEqual(list[1]!.id, "c");
    assertEqual(list[2]!.id, "a");
  });

  it("autosave overwrites slot", async () => {
    MockIndexedDB.reset();
    const store = new IndexedDBStore(MockIndexedDB as any);
    await store.open();
    await store.putAutoSave({ id: "p1", savedAt: 1, projectJson: "v1" });
    await store.putAutoSave({ id: "p1", savedAt: 2, projectJson: "v2" });
    const got = await store.getAutoSave("p1");
    assertEqual(got?.projectJson, "v2");
  });
});

describe("AutoSaver", () => {
  it("dirty flag triggers save; pointer down blocks", async () => {
    MockIndexedDB.reset();
    const store = new IndexedDBStore(MockIndexedDB as any);
    await store.open();
    const stack = new LayerStack(8, 8, factory);
    const layer = new Layer({ width: 8, height: 8, factory });
    stack.add(layer);
    const history = new CommandHistory();
    const auto = new AutoSaver(store, stack, history, {
      intervalMs: 999999,
      serialize: () => '{"version":"1"}',
    });
    auto.start("p1");

    // No edits = nothing saved.
    await auto.tick();
    let saved = await store.getAutoSave("p1");
    assertEqual(saved, undefined);

    // Make stack dirty by adding a layer.
    stack.add(new Layer({ width: 8, height: 8, factory }));
    assertTrue(auto.isDirty());

    // Pointer down should block the save.
    auto.setPointerDown(true);
    await auto.tick();
    saved = await store.getAutoSave("p1");
    assertEqual(saved, undefined);

    // Pointer up → save proceeds.
    auto.setPointerDown(false);
    await auto.tick();
    saved = await store.getAutoSave("p1");
    assertTrue(saved !== undefined);

    auto.stop();
  });
});

describe("ProjectCodec", () => {
  it("encode/decode round trip", () => {
    const stack = new LayerStack(4, 4, factory);
    const a = new Layer({ name: "L", width: 4, height: 4, factory });
    a.getCtx().fillStyle = "rgba(50,60,70,1)";
    a.getCtx().fillRect(0, 0, 1, 1);
    stack.add(a);
    const history = new CommandHistory();
    const settings = defaultSettings();
    const state = ProjectCodec.buildState({ id: "p", name: "Project", stack, history, settings, createdAt: 1 });
    const json = ProjectCodec.encode(state);
    const decoded = ProjectCodec.decode(json);
    const { stack: stack2 } = ProjectCodec.applyState(decoded, factory);
    assertEqual(stack2.size(), 1);
    const px = stack2.getAll()[0]!.getPixels(0, 0, 1, 1);
    assertEqual(px.data[0], 50);
  });
});

describe("BackgroundRemover", () => {
  it("makes exact-match pixels transparent", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,   // red
      0, 255, 0, 255,   // green
      255, 0, 0, 255,   // red
    ]);
    const out = removeBackground({ width: 3, height: 1, data }, { r: 255, g: 0, b: 0, a: 255 }, 0, 0);
    assertEqual(out.data[3], 0);
    assertEqual(out.data[7], 255);
    assertEqual(out.data[11], 0);
  });

  it("feather attenuates near-match alpha", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      250, 5, 5, 255,
      0, 255, 0, 255,
    ]);
    const out = removeBackground({ width: 3, height: 1, data }, { r: 255, g: 0, b: 0, a: 255 }, 0, 50);
    assertEqual(out.data[3], 0);
    assertTrue((out.data[7] ?? -1) > 0 && (out.data[7] ?? 256) < 255);
    assertEqual(out.data[11], 255);
  });
});
