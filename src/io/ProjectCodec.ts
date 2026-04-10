// Encode/decode the full project state (layers + history + metadata) as JSON.

import { LayerStack } from "../core/LayerStack.js";
import { Layer, LayerSnapshot, CanvasFactory } from "../core/Layer.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { SerializedCommand } from "../history/Command.js";
import { ToolSettings } from "../tools/Tool.js";

export interface ProjectState {
  version: string;
  meta: {
    id: string;
    name: string;
    width: number;
    height: number;
    createdAt: number;
    updatedAt: number;
  };
  layers: LayerSnapshot[];
  activeLayerId: string | null;
  history: { past: SerializedCommand[]; future: SerializedCommand[] };
  settings: ToolSettings;
}

export const PROJECT_VERSION = "1.0.0";

export const ProjectCodec = {
  encode(state: ProjectState): string {
    return JSON.stringify(state);
  },
  decode(json: string): ProjectState {
    const obj = JSON.parse(json) as ProjectState;
    if (!obj.version) throw new Error("ProjectCodec.decode: missing version");
    return obj;
  },
  buildState(opts: {
    id: string;
    name: string;
    stack: LayerStack;
    history: CommandHistory;
    settings: ToolSettings;
    createdAt: number;
    /**
     * When true (the default for the save/export path), the codec drops
     * blank layers' pixel data, RLE-compresses the rest, and persists an
     * empty history. Undo/redo stays alive in memory until reload. This
     * shrinks a white 1920x1280 project from ~22 MB down to < 200 KB —
     * the core fix for round 8's JSON bloat.
     */
    compact?: boolean;
  }): ProjectState {
    const compact = opts.compact ?? false;
    return {
      version: PROJECT_VERSION,
      meta: {
        id: opts.id,
        name: opts.name,
        width: opts.stack.width,
        height: opts.stack.height,
        createdAt: opts.createdAt,
        updatedAt: Date.now(),
      },
      layers: opts.stack.serializeAll({ compact }),
      activeLayerId: opts.stack.getActiveId(),
      history: compact ? { past: [], future: [] } : opts.history.serialize(),
      settings: opts.settings,
    };
  },
  applyState(state: ProjectState, factory: CanvasFactory): { stack: LayerStack; history: CommandHistory } {
    const stack = LayerStack.fromSnapshots(state.layers, state.meta.width, state.meta.height, factory, state.activeLayerId);
    const history = CommandHistory.deserialize(state.history);
    return { stack, history };
  },
};
