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
    // 형태를 확인하고 나서 돌려준다. 예전에는 version 만 보고 통과시켜서,
    // meta 나 layers 가 깨진 저장본이 로드 도중에야 엉뚱한 곳에서 터졌다.
    if (!obj || typeof obj !== "object") throw new Error("ProjectCodec.decode: not an object");
    if (typeof obj.version !== "string" || obj.version.length === 0) {
      throw new Error("ProjectCodec.decode: missing version");
    }
    const meta = obj.meta as ProjectState["meta"] | undefined;
    if (!meta || typeof meta !== "object") throw new Error("ProjectCodec.decode: missing meta");
    if (!Number.isFinite(meta.width) || !Number.isFinite(meta.height) || meta.width < 1 || meta.height < 1) {
      throw new Error("ProjectCodec.decode: invalid project size");
    }
    if (!Array.isArray(obj.layers)) throw new Error("ProjectCodec.decode: layers is not an array");
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
