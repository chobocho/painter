import { Layer, CanvasFactory, Ctx2D, LayerSnapshot, SerializeOpts } from "./Layer.js";
import { Rect } from "../util/Rect.js";
import { Emitter } from "../util/Events.js";

export interface StackEvents {
  change: { reason: string };
  dirty: { rect: Rect };
}

export class LayerStack extends Emitter<StackEvents> {
  private layers: Layer[] = [];
  private activeId: string | null = null;
  readonly factory: CanvasFactory;
  width: number;
  height: number;

  constructor(width: number, height: number, factory: CanvasFactory) {
    super();
    this.width = width;
    this.height = height;
    this.factory = factory;
  }

  /**
   * Replace all layers + size from a list of snapshots without breaking
   * existing event subscribers. Used by `applyState` after loading a project
   * so the LayerPanel/AutoSaver/etc. listeners stay alive.
   */
  reset(snapshots: LayerSnapshot[], width: number, height: number, activeId: string | null): void {
    this.layers = snapshots.map((s) => Layer.deserialize(s, this.factory));
    this.width = width;
    this.height = height;
    this.activeId = activeId ?? (this.layers[0]?.id ?? null);
    this.emit("change", { reason: "reset" });
  }

  add(layer: Layer, index?: number): void {
    const i = index ?? this.layers.length;
    this.layers.splice(i, 0, layer);
    if (this.activeId === null) this.activeId = layer.id;
    this.markDirty(Rect.create(0, 0, this.width, this.height));
    this.emit("change", { reason: "add" });
  }

  remove(id: string): Layer | null {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return null;
    const [removed] = this.layers.splice(i, 1);
    if (this.activeId === id) {
      this.activeId = this.layers.length > 0 ? this.layers[Math.max(0, i - 1)]!.id : null;
    }
    this.markDirty(Rect.create(0, 0, this.width, this.height));
    this.emit("change", { reason: "remove" });
    return removed ?? null;
  }

  move(id: string, toIndex: number): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const [layer] = this.layers.splice(i, 1);
    this.layers.splice(Math.max(0, Math.min(this.layers.length, toIndex)), 0, layer!);
    this.markDirty(Rect.create(0, 0, this.width, this.height));
    this.emit("change", { reason: "move" });
  }

  setActive(id: string): void {
    if (this.layers.find((l) => l.id === id)) {
      this.activeId = id;
      this.emit("change", { reason: "active" });
    }
  }

  getActive(): Layer | null {
    if (!this.activeId) return null;
    return this.layers.find((l) => l.id === this.activeId) ?? null;
  }

  getActiveId(): string | null { return this.activeId; }

  get(id: string): Layer | null {
    return this.layers.find((l) => l.id === id) ?? null;
  }

  getAll(): Layer[] {
    return this.layers.slice();
  }

  size(): number { return this.layers.length; }

  setVisible(id: string, visible: boolean): void {
    const l = this.get(id);
    if (!l) return;
    l.visible = visible;
    this.markDirty(Rect.create(0, 0, this.width, this.height));
    this.emit("change", { reason: "visible" });
  }

  setOpacity(id: string, opacity: number): void {
    const l = this.get(id);
    if (!l) return;
    l.opacity = Math.max(0, Math.min(1, opacity));
    this.markDirty(Rect.create(0, 0, this.width, this.height));
    this.emit("change", { reason: "opacity" });
  }

  rename(id: string, name: string): void {
    const l = this.get(id);
    if (!l) return;
    l.name = name;
    this.emit("change", { reason: "rename" });
  }

  /**
   * 다시 그려야 할 영역을 알린다.
   * 합성은 항상 전체 프레임으로 한다 — 표시 캔버스는 프로젝트 크기에 배율을
   * 걸어 그리므로, 부분 갱신을 하면 배율 경계에서 지워지지 않은 픽셀이 남는다.
   * 그래서 dirty 영역을 누적해 두는 대신 이벤트로만 흘려보낸다.
   */
  markDirty(rect: Rect): void {
    this.emit("dirty", { rect: Rect.intersect(rect, Rect.create(0, 0, this.width, this.height)) });
  }

  /**
   * Composite all visible layers, bottom-to-top, into target ctx.
   * If `dirtyRect` is non-empty, only that region is redrawn (callers should
   * have cleared the destination region first).
   */
  compositeTo(target: Ctx2D, dirtyRect?: Rect): void {
    const r = dirtyRect && !Rect.isEmpty(dirtyRect)
      ? dirtyRect
      : Rect.create(0, 0, this.width, this.height);
    target.clearRect(r.x, r.y, r.w, r.h);
    for (const layer of this.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      target.globalAlpha = layer.opacity;
      target.globalCompositeOperation = layer.blendMode;
      target.drawImage(
        layer.getCanvas() as unknown,
        r.x, r.y, r.w, r.h,
        r.x, r.y, r.w, r.h
      );
    }
    target.globalAlpha = 1;
    target.globalCompositeOperation = "source-over";
  }

  serializeAll(opts: SerializeOpts = {}): LayerSnapshot[] {
    return this.layers.map((l) => l.serialize(opts));
  }

  static fromSnapshots(snaps: LayerSnapshot[], width: number, height: number, factory: CanvasFactory, activeId?: string | null): LayerStack {
    const stack = new LayerStack(width, height, factory);
    for (const s of snaps) stack.layers.push(Layer.deserialize(s, factory));
    stack.activeId = activeId ?? (stack.layers[0]?.id ?? null);
    return stack;
  }
}
