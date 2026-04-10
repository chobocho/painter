import { Command, CommandContext, SerializedCommand, deserializeCommand } from "./Command.js";
import { Emitter } from "../util/Events.js";

export interface HistoryEvents {
  change: { kind: "execute" | "undo" | "redo" | "clear" | "load" };
}

export interface HistoryDescriptor {
  id: string;
  kind: string;
  label: string;
  current: boolean;
}

export class CommandHistory extends Emitter<HistoryEvents> {
  private past: Command[] = [];
  private future: Command[] = [];
  private maxBytes: number;
  private currentBytes: number = 0;

  constructor(opts: { maxBytes?: number } = {}) {
    super();
    this.maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
  }

  execute(cmd: Command, ctx: CommandContext): void {
    cmd.do(ctx);
    this.past.push(cmd);
    this.currentBytes += cmd.estimateBytes();
    // Discard the redo branch.
    for (const c of this.future) this.currentBytes -= c.estimateBytes();
    this.future = [];
    this.evict();
    this.emit("change", { kind: "execute" });
  }

  undo(ctx: CommandContext): boolean {
    const cmd = this.past.pop();
    if (!cmd) return false;
    cmd.undo(ctx);
    this.future.push(cmd);
    this.emit("change", { kind: "undo" });
    return true;
  }

  redo(ctx: CommandContext): boolean {
    const cmd = this.future.pop();
    if (!cmd) return false;
    cmd.do(ctx);
    this.past.push(cmd);
    this.emit("change", { kind: "redo" });
    return true;
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  clear(): void {
    this.past = [];
    this.future = [];
    this.currentBytes = 0;
    this.emit("change", { kind: "clear" });
  }

  list(): HistoryDescriptor[] {
    const out: HistoryDescriptor[] = [];
    for (const c of this.past) out.push({ id: c.id, kind: c.kind, label: c.label, current: false });
    if (out.length > 0) out[out.length - 1]!.current = true;
    for (const c of this.future.slice().reverse()) out.push({ id: c.id, kind: c.kind, label: c.label + " (undone)", current: false });
    return out;
  }

  size(): { past: number; future: number; bytes: number } {
    return { past: this.past.length, future: this.future.length, bytes: this.currentBytes };
  }

  serialize(): { past: SerializedCommand[]; future: SerializedCommand[] } {
    return {
      past: this.past.map((c) => c.serialize()),
      future: this.future.map((c) => c.serialize()),
    };
  }

  static deserialize(payload: { past: SerializedCommand[]; future: SerializedCommand[] }): CommandHistory {
    const h = new CommandHistory();
    h.past = payload.past.map(deserializeCommand);
    h.future = payload.future.map(deserializeCommand);
    h.currentBytes = h.past.reduce((s, c) => s + c.estimateBytes(), 0)
      + h.future.reduce((s, c) => s + c.estimateBytes(), 0);
    h.emit("change", { kind: "load" });
    return h;
  }

  private evict(): void {
    while (this.currentBytes > this.maxBytes && this.past.length > 1) {
      const dropped = this.past.shift()!;
      this.currentBytes -= dropped.estimateBytes();
    }
  }
}
