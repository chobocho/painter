import { IndexedDBStore, StoredAutoSave } from "./IndexedDBStore.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";

export interface AutoSaverOptions {
  intervalMs?: number;
  serialize: () => string;
}

export class AutoSaver {
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private projectId: string | null = null;
  private pointerDown = false;

  constructor(
    private store: IndexedDBStore,
    private stack: LayerStack,
    private history: CommandHistory,
    private opts: AutoSaverOptions
  ) {
    history.on("change", () => { this.dirty = true; });
    stack.on("change", () => { this.dirty = true; });
  }

  start(projectId: string): void {
    this.projectId = projectId;
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.opts.intervalMs ?? 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPointerDown(v: boolean): void { this.pointerDown = v; }

  async tick(): Promise<void> {
    if (!this.dirty || !this.projectId || this.pointerDown) return;
    await this.flushNow();
  }

  async flushNow(): Promise<void> {
    if (!this.projectId) return;
    const payload: StoredAutoSave = {
      id: this.projectId,
      savedAt: Date.now(),
      projectJson: this.opts.serialize(),
    };
    await this.store.putAutoSave(payload);
    this.dirty = false;
  }

  isDirty(): boolean { return this.dirty; }
}
