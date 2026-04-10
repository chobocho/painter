import { Command, CommandContext, SerializedCommand, registerCommand } from "./Command.js";
import { Layer, LayerSnapshot, encodeBase64, decodeBase64 } from "../core/Layer.js";
import { Rect } from "../util/Rect.js";
import { Uid } from "../util/Uid.js";

interface PixelDelta {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function encodePixels(d: PixelDelta): { w: number; h: number; b64: string } {
  return { w: d.width, h: d.height, b64: encodeBase64(d.data) };
}
function decodePixels(s: { w: number; h: number; b64: string }): PixelDelta {
  return { width: s.w, height: s.h, data: decodeBase64(s.b64) };
}

/**
 * Most pixel-level operations (pencil/spray/shape/fill/gradient/smudge/eraser
 * /chroma-key) reduce to "before/after pixels in a rect on a layer". One class
 * handles all of them, distinguished only by `kind` for the history panel.
 */
export class PixelEditCommand implements Command {
  id: string;
  kind: string;
  label: string;
  layerId: string;
  rect: Rect;
  before: PixelDelta;
  after: PixelDelta;

  constructor(opts: {
    id?: string;
    kind?: string;
    label?: string;
    layerId: string;
    rect: Rect;
    before: PixelDelta;
    after: PixelDelta;
  }) {
    this.id = opts.id ?? Uid.next();
    this.kind = opts.kind ?? "pixel-edit";
    this.label = opts.label ?? "Edit";
    this.layerId = opts.layerId;
    this.rect = opts.rect;
    this.before = opts.before;
    this.after = opts.after;
  }

  do(ctx: CommandContext): void {
    const layer = ctx.stack.get(this.layerId);
    if (!layer) return;
    layer.putPixels(this.after, this.rect.x, this.rect.y);
    ctx.stack.markDirty(this.rect);
  }

  undo(ctx: CommandContext): void {
    const layer = ctx.stack.get(this.layerId);
    if (!layer) return;
    layer.putPixels(this.before, this.rect.x, this.rect.y);
    ctx.stack.markDirty(this.rect);
  }

  estimateBytes(): number {
    return this.before.data.byteLength + this.after.data.byteLength + 128;
  }

  serialize(): SerializedCommand {
    return {
      kind: this.kind,
      data: {
        id: this.id,
        label: this.label,
        layerId: this.layerId,
        rect: this.rect,
        before: encodePixels(this.before),
        after: encodePixels(this.after),
      },
    };
  }
}

registerCommand("pixel-edit", (data) => {
  const d = data as { id: string; label: string; layerId: string; rect: Rect; before: { w: number; h: number; b64: string }; after: { w: number; h: number; b64: string } };
  return new PixelEditCommand({
    id: d.id,
    label: d.label,
    layerId: d.layerId,
    rect: d.rect,
    before: decodePixels(d.before),
    after: decodePixels(d.after),
  });
});

export class AddLayerCommand implements Command {
  id: string;
  kind = "add-layer";
  label: string;
  snapshot: LayerSnapshot;
  index: number;

  constructor(opts: { id?: string; label?: string; snapshot: LayerSnapshot; index: number }) {
    this.id = opts.id ?? Uid.next();
    this.label = opts.label ?? `Add layer "${opts.snapshot.name}"`;
    this.snapshot = opts.snapshot;
    this.index = opts.index;
  }
  do(ctx: CommandContext): void {
    const layer = Layer.deserialize(this.snapshot, ctx.stack.factory);
    ctx.stack.add(layer, this.index);
  }
  undo(ctx: CommandContext): void {
    ctx.stack.remove(this.snapshot.id);
  }
  estimateBytes(): number {
    return (this.snapshot.rawRGBA?.length ?? 0) + 256;
  }
  serialize(): SerializedCommand {
    return { kind: this.kind, data: { id: this.id, label: this.label, snapshot: this.snapshot, index: this.index } };
  }
}
registerCommand("add-layer", (data) => new AddLayerCommand(data as ConstructorParameters<typeof AddLayerCommand>[0]));

export class RemoveLayerCommand implements Command {
  id: string;
  kind = "remove-layer";
  label: string;
  snapshot: LayerSnapshot;
  index: number;
  constructor(opts: { id?: string; label?: string; snapshot: LayerSnapshot; index: number }) {
    this.id = opts.id ?? Uid.next();
    this.label = opts.label ?? `Remove layer "${opts.snapshot.name}"`;
    this.snapshot = opts.snapshot;
    this.index = opts.index;
  }
  do(ctx: CommandContext): void { ctx.stack.remove(this.snapshot.id); }
  undo(ctx: CommandContext): void {
    const layer = Layer.deserialize(this.snapshot, ctx.stack.factory);
    ctx.stack.add(layer, this.index);
  }
  estimateBytes(): number { return (this.snapshot.rawRGBA?.length ?? 0) + 256; }
  serialize(): SerializedCommand {
    return { kind: this.kind, data: { id: this.id, label: this.label, snapshot: this.snapshot, index: this.index } };
  }
}
registerCommand("remove-layer", (data) => new RemoveLayerCommand(data as ConstructorParameters<typeof RemoveLayerCommand>[0]));

export class ReorderLayerCommand implements Command {
  id: string;
  kind = "reorder-layer";
  label = "Reorder layer";
  layerId: string;
  from: number;
  to: number;
  constructor(opts: { id?: string; layerId: string; from: number; to: number }) {
    this.id = opts.id ?? Uid.next();
    this.layerId = opts.layerId;
    this.from = opts.from;
    this.to = opts.to;
  }
  do(ctx: CommandContext): void { ctx.stack.move(this.layerId, this.to); }
  undo(ctx: CommandContext): void { ctx.stack.move(this.layerId, this.from); }
  estimateBytes(): number { return 64; }
  serialize(): SerializedCommand {
    return { kind: this.kind, data: { id: this.id, layerId: this.layerId, from: this.from, to: this.to } };
  }
}
registerCommand("reorder-layer", (data) => new ReorderLayerCommand(data as ConstructorParameters<typeof ReorderLayerCommand>[0]));

export interface LayerProps {
  name?: string;
  visible?: boolean;
  opacity?: number;
  locked?: boolean;
}

export class SetLayerPropsCommand implements Command {
  id: string;
  kind = "set-layer-props";
  label: string;
  layerId: string;
  before: LayerProps;
  after: LayerProps;
  constructor(opts: { id?: string; label?: string; layerId: string; before: LayerProps; after: LayerProps }) {
    this.id = opts.id ?? Uid.next();
    this.label = opts.label ?? "Layer properties";
    this.layerId = opts.layerId;
    this.before = opts.before;
    this.after = opts.after;
  }
  private apply(ctx: CommandContext, p: LayerProps): void {
    if (p.visible !== undefined) ctx.stack.setVisible(this.layerId, p.visible);
    if (p.opacity !== undefined) ctx.stack.setOpacity(this.layerId, p.opacity);
    if (p.name !== undefined) ctx.stack.rename(this.layerId, p.name);
    if (p.locked !== undefined) {
      const l = ctx.stack.get(this.layerId);
      if (l) l.locked = p.locked;
    }
  }
  do(ctx: CommandContext): void { this.apply(ctx, this.after); }
  undo(ctx: CommandContext): void { this.apply(ctx, this.before); }
  estimateBytes(): number { return 256; }
  serialize(): SerializedCommand {
    return { kind: this.kind, data: { id: this.id, label: this.label, layerId: this.layerId, before: this.before, after: this.after } };
  }
}
registerCommand("set-layer-props", (data) => new SetLayerPropsCommand(data as ConstructorParameters<typeof SetLayerPropsCommand>[0]));
