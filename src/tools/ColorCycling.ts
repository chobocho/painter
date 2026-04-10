// Deluxe Paint–style palette color cycling.
// Not a drawing tool: an animation toggle that rotates a list of colors
// in-place on the active layer's pixels at a fixed cadence.

import { LayerStack } from "../core/LayerStack.js";
import { RGBA, Color } from "../util/Color.js";
import { Rect } from "../util/Rect.js";

export interface CyclingGroup {
  id: string;
  colors: RGBA[];
  intervalMs: number;
  enabled: boolean;
}

export class ColorCyclingEngine {
  private groups: CyclingGroup[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private offsets: Map<string, number> = new Map();

  constructor(private stack: LayerStack) {}

  setGroups(groups: CyclingGroup[]): void {
    this.groups = groups;
    for (const g of groups) if (!this.offsets.has(g.id)) this.offsets.set(g.id, 0);
  }

  start(tickMs: number = 100): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Performs one cycling step. Public so tests can drive it deterministically. */
  tick(): void {
    const layer = this.stack.getActive();
    if (!layer) return;
    let any = false;
    for (const g of this.groups) {
      if (!g.enabled || g.colors.length < 2) continue;
      this.offsets.set(g.id, (this.offsets.get(g.id) ?? 0) + 1);
      this.applyCycle(layer, g);
      any = true;
    }
    if (any) this.stack.markDirty(Rect.create(0, 0, layer.width, layer.height));
  }

  private applyCycle(layer: { width: number; height: number; getPixels: (x: number, y: number, w: number, h: number) => { width: number; height: number; data: Uint8ClampedArray }; putPixels: (img: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number) => void }, group: CyclingGroup): void {
    const buf = layer.getPixels(0, 0, layer.width, layer.height);
    const len = group.colors.length;
    // One step forward through the palette per tick. The current pixel value
    // tells us where we are in the cycle; we advance by exactly 1 each call.
    for (let i = 0; i < buf.data.length; i += 4) {
      const px: RGBA = { r: buf.data[i]!, g: buf.data[i + 1]!, b: buf.data[i + 2]!, a: buf.data[i + 3]! };
      for (let k = 0; k < len; k++) {
        if (Color.equals(px, group.colors[k]!)) {
          const next = group.colors[(k + 1) % len]!;
          buf.data[i] = next.r;
          buf.data[i + 1] = next.g;
          buf.data[i + 2] = next.b;
          buf.data[i + 3] = next.a;
          break;
        }
      }
    }
    layer.putPixels(buf, 0, 0);
  }
}
