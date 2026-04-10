import { LayerStack } from "../core/LayerStack.js";

export interface CommandContext {
  stack: LayerStack;
}

export interface SerializedCommand {
  kind: string;
  data: unknown;
}

export interface Command {
  id: string;
  kind: string;
  label: string;
  do(ctx: CommandContext): void;
  undo(ctx: CommandContext): void;
  estimateBytes(): number;
  serialize(): SerializedCommand;
}

export type CommandFactory = (data: unknown) => Command;
const registry: Record<string, CommandFactory> = {};

export function registerCommand(kind: string, factory: CommandFactory): void {
  registry[kind] = factory;
}

export function deserializeCommand(s: SerializedCommand): Command {
  const f = registry[s.kind];
  if (!f) throw new Error(`Unknown command kind: ${s.kind}`);
  return f(s.data);
}
