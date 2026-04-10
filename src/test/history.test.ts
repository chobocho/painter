import { describe, it, assertEqual, assertTrue, assertFalse } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { PixelEditCommand, AddLayerCommand, RemoveLayerCommand, SetLayerPropsCommand } from "../history/Commands.js";
import { Rect } from "../util/Rect.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;

function freshStack(): LayerStack {
  const stack = new LayerStack(8, 8, factory);
  const a = new Layer({ name: "L1", width: 8, height: 8, factory });
  stack.add(a);
  return stack;
}

describe("CommandHistory", () => {
  it("execute pushes onto past, clears future", () => {
    const stack = freshStack();
    const layer = stack.getActive()!;
    const ctx = { stack };
    const history = new CommandHistory();

    const before = layer.getPixels(0, 0, 4, 4);
    layer.getCtx().fillStyle = "red";
    layer.getCtx().fillRect(0, 0, 4, 4);
    const after = layer.getPixels(0, 0, 4, 4);

    const cmd = new PixelEditCommand({
      layerId: layer.id,
      rect: Rect.create(0, 0, 4, 4),
      before,
      after,
    });
    // Roll back, then re-execute through history.
    layer.putPixels(before, 0, 0);
    history.execute(cmd, ctx);

    assertEqual(layer.getPixels(0, 0, 1, 1).data[0], 255);
    assertTrue(history.canUndo());
    assertFalse(history.canRedo());
  });

  it("undo restores prior state, redo reapplies", () => {
    const stack = freshStack();
    const layer = stack.getActive()!;
    const ctx = { stack };
    const history = new CommandHistory();

    const before = layer.getPixels(0, 0, 2, 2);
    layer.getCtx().fillStyle = "rgba(10,20,30,1)";
    layer.getCtx().fillRect(0, 0, 2, 2);
    const after = layer.getPixels(0, 0, 2, 2);
    layer.putPixels(before, 0, 0);

    const cmd = new PixelEditCommand({
      layerId: layer.id,
      rect: Rect.create(0, 0, 2, 2),
      before,
      after,
    });
    history.execute(cmd, ctx);
    history.undo(ctx);
    assertEqual(layer.getPixels(0, 0, 1, 1).data[0], 0);
    history.redo(ctx);
    assertEqual(layer.getPixels(0, 0, 1, 1).data[0], 10);
  });

  it("new execute clears redo branch", () => {
    const stack = freshStack();
    const layer = stack.getActive()!;
    const ctx = { stack };
    const history = new CommandHistory();
    const empty = layer.getPixels(0, 0, 1, 1);

    history.execute(new PixelEditCommand({ layerId: layer.id, rect: Rect.create(0, 0, 1, 1), before: empty, after: empty }), ctx);
    history.undo(ctx);
    assertTrue(history.canRedo());
    history.execute(new PixelEditCommand({ layerId: layer.id, rect: Rect.create(0, 0, 1, 1), before: empty, after: empty }), ctx);
    assertFalse(history.canRedo());
  });

  it("AddLayerCommand and RemoveLayerCommand are reversible", () => {
    const stack = freshStack();
    const ctx = { stack };
    const history = new CommandHistory();

    const newLayer = new Layer({ name: "Added", width: 8, height: 8, factory });
    const snap = newLayer.serialize();
    history.execute(new AddLayerCommand({ snapshot: snap, index: 1 }), ctx);
    assertEqual(stack.size(), 2);
    history.undo(ctx);
    assertEqual(stack.size(), 1);
    history.redo(ctx);
    assertEqual(stack.size(), 2);
  });

  it("SetLayerPropsCommand round-trips", () => {
    const stack = freshStack();
    const ctx = { stack };
    const history = new CommandHistory();
    const id = stack.getActive()!.id;
    history.execute(
      new SetLayerPropsCommand({
        layerId: id,
        before: { opacity: 1, visible: true },
        after: { opacity: 0.3, visible: false },
      }),
      ctx
    );
    assertEqual(stack.get(id)!.opacity, 0.3);
    assertEqual(stack.get(id)!.visible, false);
    history.undo(ctx);
    assertEqual(stack.get(id)!.opacity, 1);
    assertEqual(stack.get(id)!.visible, true);
  });

  it("serialize/deserialize round trip", () => {
    const stack = freshStack();
    const layer = stack.getActive()!;
    const ctx = { stack };
    const history = new CommandHistory();

    const before = layer.getPixels(0, 0, 2, 2);
    layer.getCtx().fillStyle = "rgba(50,60,70,1)";
    layer.getCtx().fillRect(0, 0, 2, 2);
    const after = layer.getPixels(0, 0, 2, 2);
    layer.putPixels(before, 0, 0);

    history.execute(new PixelEditCommand({ layerId: layer.id, rect: Rect.create(0, 0, 2, 2), before, after }), ctx);
    const ser = history.serialize();
    const h2 = CommandHistory.deserialize(ser);
    assertEqual(h2.size().past, 1);
  });

  it("history list shows current pointer", () => {
    const stack = freshStack();
    const layer = stack.getActive()!;
    const ctx = { stack };
    const history = new CommandHistory();
    const empty = layer.getPixels(0, 0, 1, 1);
    history.execute(new PixelEditCommand({ layerId: layer.id, rect: Rect.create(0, 0, 1, 1), before: empty, after: empty, label: "A" }), ctx);
    history.execute(new PixelEditCommand({ layerId: layer.id, rect: Rect.create(0, 0, 1, 1), before: empty, after: empty, label: "B" }), ctx);
    const list = history.list();
    assertEqual(list.length, 2);
    assertEqual(list[1]!.current, true);
  });
});
