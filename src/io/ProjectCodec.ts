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
  }): ProjectState {
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
      layers: opts.stack.serializeAll(),
      activeLayerId: opts.stack.getActiveId(),
      history: opts.history.serialize(),
      settings: opts.settings,
    };
  },
  applyState(state: ProjectState, factory: CanvasFactory): { stack: LayerStack; history: CommandHistory } {
    const stack = LayerStack.fromSnapshots(state.layers, state.meta.width, state.meta.height, factory, state.activeLayerId);
    const history = CommandHistory.deserialize(state.history);
    return { stack, history };
  },
};
