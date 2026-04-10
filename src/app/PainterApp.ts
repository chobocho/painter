// Top-level orchestrator. Wires together canvas, layers, history, tools,
// storage, autosave, input, and UI panels into a working painter app.

import { LayerStack } from "../core/LayerStack.js";
import { Layer, CanvasFactory } from "../core/Layer.js";
import { DisplayCanvas } from "../core/Canvas.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { AddLayerCommand, RemoveLayerCommand, ReorderLayerCommand, SetLayerPropsCommand, PixelEditCommand } from "../history/Commands.js";
import { Tool, ToolContext, defaultSettings, ToolSettings } from "../tools/Tool.js";
import { buildDefaultRegistry, ToolRegistry } from "../tools/ToolRegistry.js";
import { InputAdapter } from "../input/InputAdapter.js";
import { matchShortcut } from "../input/Shortcuts.js";
import { IndexedDBStore } from "../storage/IndexedDBStore.js";
import { AutoSaver } from "../storage/AutoSaver.js";
import { ProjectCodec, ProjectState, PROJECT_VERSION } from "../io/ProjectCodec.js";
import { importPngFile } from "../io/PngImporter.js";
import { removeBackground } from "../io/BackgroundRemover.js";
import { Toolbar } from "../ui/Toolbar.js";
import { Palette } from "../ui/Palette.js";
import { LayerPanel } from "../ui/LayerPanel.js";
import { HistoryPanel } from "../ui/HistoryPanel.js";
import { ProjectPanel } from "../ui/ProjectPanel.js";
import { Uid } from "../util/Uid.js";
import { Rect } from "../util/Rect.js";
import { Color } from "../util/Color.js";

const realCanvasFactory: CanvasFactory = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c as unknown as ReturnType<CanvasFactory>;
};

export class PainterApp {
  private projectId: string = Uid.next();
  private projectName: string = "Untitled";
  private createdAt: number = Date.now();
  private projectWidth: number = 1920;
  private projectHeight: number = 1280;

  private stack!: LayerStack;
  private history!: CommandHistory;
  private settings: ToolSettings = defaultSettings();
  private registry: ToolRegistry = buildDefaultRegistry();
  private activeToolId: string = "pencil";
  private displayCanvas!: DisplayCanvas;
  private previewLayer!: Layer;
  private input!: InputAdapter;
  private store: IndexedDBStore = new IndexedDBStore();
  private autoSaver!: AutoSaver;
  private renderScheduled = false;

  private toolbar!: Toolbar;
  private palette!: Palette;
  private layerPanel!: LayerPanel;
  private historyPanel!: HistoryPanel;
  private projectPanel!: ProjectPanel;

  async boot(root: HTMLElement): Promise<void> {
    await this.store.open();

    // Layout: build the DOM skeleton.
    root.innerHTML = `
      <div id="painter-root">
        <header id="menu-bar">
          <button type="button" id="toggle-panel-btn" title="우측 패널 숨기기/보기">📑 패널</button>
          <div id="undo-redo-group">
            <button type="button" id="menu-undo-btn" title="실행 취소 (Ctrl+Z)">↶</button>
            <button type="button" id="menu-redo-btn" title="다시 실행 (Ctrl+Y)">↷</button>
          </div>
          <div id="palette-area"></div>
          <div id="brush-controls">
            <label>굵기 <input type="range" id="brush-size" min="1" max="64" value="${this.settings.brushSize}"></label>
            <label>허용 <input type="range" id="tolerance" min="0" max="128" value="${this.settings.tolerance}"></label>
            <label><input type="checkbox" id="mirror-x"> 좌우대칭</label>
            <label><input type="checkbox" id="mirror-y"> 상하대칭</label>
          </div>
        </header>
        <aside id="tool-area"></aside>
        <main id="canvas-area">
          <canvas id="display-canvas"></canvas>
        </main>
        <section id="right-panel">
          <div id="layer-panel"></div>
          <div id="history-panel"></div>
          <div id="project-panel"></div>
        </section>
        <footer id="status-bar"></footer>
        <button type="button" id="floating-panel-btn" title="우측 패널 숨기기/보기">📑</button>
      </div>
    `;

    this.newProjectInternal(this.projectWidth, this.projectHeight);

    const canvasEl = root.querySelector("#display-canvas") as HTMLCanvasElement;
    this.displayCanvas = new DisplayCanvas(
      canvasEl as unknown as ConstructorParameters<typeof DisplayCanvas>[0],
      this.projectWidth,
      this.projectHeight,
      window.devicePixelRatio || 1
    );

    const canvasArea = root.querySelector("#canvas-area") as HTMLElement;
    const fitCanvasToContainer = () => {
      const rect = canvasArea.getBoundingClientRect();
      const scale = Math.min(rect.width / this.projectWidth, rect.height / this.projectHeight);
      const cssW = Math.floor(this.projectWidth * scale);
      const cssH = Math.floor(this.projectHeight * scale);
      canvasEl.style.width = cssW + "px";
      canvasEl.style.height = cssH + "px";
      this.displayCanvas.resizeDisplay(cssW, cssH, window.devicePixelRatio || 1);
      this.scheduleRender();
    };
    fitCanvasToContainer();
    new ResizeObserver(() => fitCanvasToContainer()).observe(canvasArea);

    this.input = new InputAdapter(this.displayCanvas, canvasEl, {
      getActiveTool: () => this.getActiveTool(),
      getToolContext: () => this.toolContext(),
      onPointerStateChange: (down) => {
        this.autoSaver.setPointerDown(down);
        if (!down) this.scheduleRender();
      },
      onKey: (e) => this.handleShortcut(e),
    });
    this.input.bind();

    this.toolbar = new Toolbar(root.querySelector("#tool-area") as HTMLElement, this.registry, (id) => this.setActiveTool(id));
    this.toolbar.render(this.activeToolId);
    this.updateStatusBar();

    this.palette = new Palette(root.querySelector("#palette-area") as HTMLElement, (c) => { this.settings.color = c; });
    this.palette.render();

    // Menu-bar undo / redo buttons.
    const menuUndoBtn = root.querySelector("#menu-undo-btn") as HTMLButtonElement;
    const menuRedoBtn = root.querySelector("#menu-redo-btn") as HTMLButtonElement;
    const refreshUndoRedo = () => {
      menuUndoBtn.disabled = !this.history.canUndo();
      menuRedoBtn.disabled = !this.history.canRedo();
    };
    menuUndoBtn.addEventListener("click", () => {
      this.history.undo({ stack: this.stack });
      this.scheduleRender();
    });
    menuRedoBtn.addEventListener("click", () => {
      this.history.redo({ stack: this.stack });
      this.scheduleRender();
    });
    this.history.on("change", refreshUndoRedo);
    refreshUndoRedo();

    this.layerPanel = new LayerPanel(root.querySelector("#layer-panel") as HTMLElement, this.stack, {
      onAdd: () => this.addLayer(),
      onRemove: (id) => this.removeLayer(id),
      onSelect: (id) => { this.stack.setActive(id); this.scheduleRender(); },
      onToggleVisible: (id, v) => this.executeLayerProps(id, { visible: v }),
      onOpacity: (id, o) => this.executeLayerProps(id, { opacity: o }),
      onMoveUp: (id) => this.moveLayer(id, +1),
      onMoveDown: (id) => this.moveLayer(id, -1),
      onRename: (id, name) => this.executeLayerProps(id, { name }),
    });
    this.layerPanel.render();

    this.historyPanel = new HistoryPanel(
      root.querySelector("#history-panel") as HTMLElement,
      this.history,
      () => { this.history.undo({ stack: this.stack }); this.scheduleRender(); },
      () => { this.history.redo({ stack: this.stack }); this.scheduleRender(); }
    );
    this.historyPanel.render();

    this.projectPanel = new ProjectPanel(root.querySelector("#project-panel") as HTMLElement, this.store, {
      onNew: () => this.newProject(),
      onSave: () => this.saveProject(),
      onLoad: (id) => this.loadProject(id),
      onExportPng: () => this.exportPng(),
      onExportJson: () => this.exportJson(),
      onImportJson: (f) => this.importJson(f),
      onImportPng: (f) => this.importPng(f),
      onChromaKey: () => this.applyChromaKey(),
    });
    void this.projectPanel.render();

    // Right-panel toggle. Two buttons drive the same handler so it's
    // reachable from both the menu bar and a floating fallback (the menu
    // bar can be visually crowded on a Fold7 with the palette + brush
    // controls).
    const rightPanelEl = root.querySelector("#right-panel") as HTMLElement;
    const togglePanelBtn = root.querySelector("#toggle-panel-btn") as HTMLButtonElement;
    const floatingBtn = root.querySelector("#floating-panel-btn") as HTMLButtonElement;
    const rootEl = root.querySelector("#painter-root") as HTMLElement;
    let rightPanelHidden = false;
    const togglePanel = (e?: Event): void => {
      e?.stopPropagation();
      rightPanelHidden = !rightPanelHidden;
      rightPanelEl.style.display = rightPanelHidden ? "none" : "";
      rootEl.classList.toggle("right-hidden", rightPanelHidden);
      togglePanelBtn.textContent = rightPanelHidden ? "📑 패널 보기" : "📑 패널 숨기기";
      floatingBtn.textContent = rightPanelHidden ? "📑" : "✕";
      // Force the canvas to refit since its column just expanded/collapsed.
      requestAnimationFrame(() => fitCanvasToContainer());
    };
    togglePanelBtn.addEventListener("click", togglePanel);
    floatingBtn.addEventListener("click", togglePanel);
    togglePanelBtn.textContent = "📑 패널 숨기기";
    floatingBtn.textContent = "✕";

    // Brush size slider
    const brushSize = root.querySelector("#brush-size") as HTMLInputElement;
    brushSize.addEventListener("input", () => { this.settings.brushSize = parseInt(brushSize.value, 10); });
    const tol = root.querySelector("#tolerance") as HTMLInputElement;
    tol.addEventListener("input", () => { this.settings.tolerance = parseInt(tol.value, 10); });
    const mx = root.querySelector("#mirror-x") as HTMLInputElement;
    const my = root.querySelector("#mirror-y") as HTMLInputElement;
    const updateMirror = () => {
      const axes: ("x" | "y")[] = [];
      if (mx.checked) axes.push("x");
      if (my.checked) axes.push("y");
      this.settings.symmetry = { enabled: axes.length > 0, axes, radial: 0 };
    };
    mx.addEventListener("change", updateMirror);
    my.addEventListener("change", updateMirror);

    this.autoSaver = new AutoSaver(this.store, this.stack, this.history, {
      intervalMs: 5000,
      serialize: () => ProjectCodec.encode(this.buildState()),
    });
    this.autoSaver.start(this.projectId);

    // Restore last open project if present.
    try {
      const lastId = await this.store.getMeta("lastOpenProjectId") as string | undefined;
      if (lastId) {
        const auto = await this.store.getAutoSave(lastId);
        if (auto) {
          this.applyState(ProjectCodec.decode(auto.projectJson));
          void this.projectPanel.render();
        }
      }
    } catch (e) {
      console.warn("restore failed", e);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.autoSaver.flushNow();
    });
    window.addEventListener("beforeunload", () => { void this.autoSaver.flushNow(); });

    this.stack.on("dirty", () => this.scheduleRender());
    this.stack.on("change", () => this.scheduleRender());
    this.history.on("change", () => this.scheduleRender());

    this.scheduleRender();
  }

  private newProjectInternal(w: number, h: number): void {
    this.projectWidth = w;
    this.projectHeight = h;
    if (!this.stack) {
      this.stack = new LayerStack(w, h, realCanvasFactory);
    } else {
      this.stack.reset([], w, h, null);
    }
    const base = new Layer({ name: "Background", width: w, height: h, factory: realCanvasFactory });
    base.getCtx().fillStyle = "#ffffff";
    base.getCtx().fillRect(0, 0, w, h);
    this.stack.add(base);
    const draw = new Layer({ name: "Layer 1", width: w, height: h, factory: realCanvasFactory });
    this.stack.add(draw);
    this.stack.setActive(draw.id);
    if (!this.history) {
      this.history = new CommandHistory();
    } else {
      this.history.clear();
    }
    this.previewLayer = new Layer({ name: "Preview", width: w, height: h, factory: realCanvasFactory });
  }

  private getActiveTool(): Tool {
    return this.registry.get(this.activeToolId)!;
  }

  setActiveTool(id: string): void {
    if (!this.registry.get(id)) return;
    this.activeToolId = id;
    this.toolbar.setActive(id);
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const desc = this.registry.getDescriptor(this.activeToolId);
    const el = document.getElementById("status-bar");
    if (!el || !desc) return;
    const sc = desc.shortcut ? ` (${desc.shortcut})` : "";
    el.textContent = `${desc.icon}  ${desc.label}${sc} — ${desc.description}`;
  }

  private toolContext(): ToolContext {
    return {
      stack: this.stack,
      history: this.history,
      settings: this.settings,
      previewLayer: this.previewLayer,
      onColorPicked: (c) => {
        // The eyedropper (and any future color-changing tool) hits this so
        // the Palette UI updates immediately. settings.color is also set
        // by the tool itself; assigning here keeps the two in sync.
        this.settings.color = c;
        if (this.palette) this.palette.set(c);
      },
    };
  }

  private addLayer(): void {
    const layer = new Layer({ name: `Layer ${this.stack.size() + 1}`, width: this.projectWidth, height: this.projectHeight, factory: realCanvasFactory });
    this.history.execute(new AddLayerCommand({ snapshot: layer.serialize(), index: this.stack.size() }), { stack: this.stack });
  }

  private removeLayer(id: string): void {
    const layer = this.stack.get(id);
    if (!layer) return;
    const index = this.stack.getAll().findIndex((l) => l.id === id);
    this.history.execute(new RemoveLayerCommand({ snapshot: layer.serialize(), index }), { stack: this.stack });
  }

  private moveLayer(id: string, delta: number): void {
    const layers = this.stack.getAll();
    const idx = layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const to = Math.max(0, Math.min(layers.length - 1, idx + delta));
    if (to === idx) return;
    this.history.execute(new ReorderLayerCommand({ layerId: id, from: idx, to }), { stack: this.stack });
  }

  private executeLayerProps(id: string, after: { visible?: boolean; opacity?: number; name?: string }): void {
    const layer = this.stack.get(id);
    if (!layer) return;
    const before = { visible: layer.visible, opacity: layer.opacity, name: layer.name };
    this.history.execute(new SetLayerPropsCommand({ layerId: id, before, after }), { stack: this.stack });
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => this.render());
  }

  private render(): void {
    this.renderScheduled = false;
    const ctx = this.displayCanvas.getCtx();
    const w = this.displayCanvas.cssWidth;
    const h = this.displayCanvas.cssHeight;
    if (w === 0 || h === 0) return;
    const dpr = this.displayCanvas.getDpr();
    ctx.setTransform(dpr * (w / this.projectWidth), 0, 0, dpr * (h / this.projectHeight), 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.stack.compositeTo(ctx, Rect.create(0, 0, this.projectWidth, this.projectHeight));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private handleShortcut(e: KeyboardEvent): boolean {
    const m = matchShortcut(e);
    if (!m) return false;
    e.preventDefault();
    if (m.action.startsWith("tool:")) {
      const id = m.action.slice(5);
      if (id === "mirror-toggle") {
        const enabled = !this.settings.symmetry.enabled;
        this.settings.symmetry = { ...this.settings.symmetry, enabled, axes: enabled ? ["x"] : [] };
      } else {
        this.setActiveTool(id);
      }
    } else if (m.action === "history:undo") {
      this.history.undo({ stack: this.stack });
      this.scheduleRender();
    } else if (m.action === "history:redo") {
      this.history.redo({ stack: this.stack });
      this.scheduleRender();
    } else if (m.action === "brush:dec") {
      this.settings.brushSize = Math.max(1, this.settings.brushSize - 1);
    } else if (m.action === "brush:inc") {
      this.settings.brushSize = Math.min(64, this.settings.brushSize + 1);
    } else if (m.action === "color:swap") {
      const t = this.settings.color;
      this.settings.color = this.settings.secondaryColor;
      this.settings.secondaryColor = t;
    } else if (m.action === "project:save") {
      void this.saveProject();
    } else if (m.action === "layer:new") {
      this.addLayer();
    } else if (m.action === "layer:clear") {
      const layer = this.stack.getActive();
      if (layer) {
        const before = layer.getPixels(0, 0, layer.width, layer.height);
        layer.clear();
        const after = layer.getPixels(0, 0, layer.width, layer.height);
        this.history.execute(
          new PixelEditCommand({
            layerId: layer.id,
            rect: Rect.create(0, 0, layer.width, layer.height),
            before: { width: before.width, height: before.height, data: new Uint8ClampedArray(before.data) },
            after: { width: after.width, height: after.height, data: new Uint8ClampedArray(after.data) },
            label: "Clear layer",
          }),
          { stack: this.stack }
        );
      }
    }
    return true;
  }

  private buildState(): ProjectState {
    return ProjectCodec.buildState({
      id: this.projectId,
      name: this.projectName,
      stack: this.stack,
      history: this.history,
      settings: this.settings,
      createdAt: this.createdAt,
    });
  }

  private applyState(state: ProjectState): void {
    this.projectId = state.meta.id;
    this.projectName = state.meta.name;
    this.createdAt = state.meta.createdAt;
    this.projectWidth = state.meta.width;
    this.projectHeight = state.meta.height;
    // Mutate in place so existing listeners on stack/history stay alive.
    this.stack.reset(state.layers, state.meta.width, state.meta.height, state.activeLayerId);
    this.history.replace(state.history);
    Object.assign(this.settings, state.settings);
    this.previewLayer = new Layer({ name: "Preview", width: this.projectWidth, height: this.projectHeight, factory: realCanvasFactory });
    if (this.displayCanvas) this.displayCanvas.setProjectSize(this.projectWidth, this.projectHeight);
    this.scheduleRender();
  }

  newProject(): void {
    const w = parseInt(prompt("Width?", String(this.projectWidth)) ?? String(this.projectWidth), 10);
    const h = parseInt(prompt("Height?", String(this.projectHeight)) ?? String(this.projectHeight), 10);
    this.projectId = Uid.next();
    this.projectName = "Untitled";
    this.createdAt = Date.now();
    this.newProjectInternal(w, h);
    this.scheduleRender();
    void this.saveProject();
  }

  async saveProject(): Promise<void> {
    const state = this.buildState();
    const json = ProjectCodec.encode(state);
    await this.store.putProject({
      id: this.projectId,
      name: this.projectName,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      width: this.projectWidth,
      height: this.projectHeight,
      projectJson: json,
    });
    await this.store.putMeta("lastOpenProjectId", this.projectId);
    void this.projectPanel.render();
  }

  async loadProject(id: string): Promise<void> {
    const p = await this.store.getProject(id);
    if (!p) return;
    this.applyState(ProjectCodec.decode(p.projectJson));
    void this.projectPanel.render();
  }

  exportPng(): void {
    const c = document.createElement("canvas");
    c.width = this.projectWidth;
    c.height = this.projectHeight;
    const ctx = c.getContext("2d")!;
    this.stack.compositeTo(ctx as any, Rect.create(0, 0, this.projectWidth, this.projectHeight));
    const url = c.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.projectName}.png`;
    a.click();
  }

  exportJson(): void {
    const blob = new Blob([ProjectCodec.encode(this.buildState())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.projectName}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async importJson(file: File): Promise<void> {
    const text = await file.text();
    this.applyState(ProjectCodec.decode(text));
    void this.projectPanel.render();
  }

  async importPng(file: File): Promise<void> {
    const layer = await importPngFile(file, this.projectWidth, this.projectHeight, realCanvasFactory, file.name);
    this.history.execute(new AddLayerCommand({ snapshot: layer.serialize(), index: this.stack.size() }), { stack: this.stack });
  }

  applyChromaKey(): void {
    const layer = this.stack.getActive();
    if (!layer) return;
    const colorIn = prompt("Background color (hex)?", "#ffffff") ?? "#ffffff";
    const tolStr = prompt("Tolerance (0-200)?", "20") ?? "20";
    const featherStr = prompt("Feather (0-100)?", "10") ?? "10";
    const key = Color.parse(colorIn);
    const tol = parseInt(tolStr, 10);
    const feather = parseInt(featherStr, 10);
    const before = layer.getPixels(0, 0, layer.width, layer.height);
    const out = removeBackground(before, key, tol, feather);
    layer.putPixels(out, 0, 0);
    const after = layer.getPixels(0, 0, layer.width, layer.height);
    this.history.execute(
      new PixelEditCommand({
        layerId: layer.id,
        rect: Rect.create(0, 0, layer.width, layer.height),
        before: { width: before.width, height: before.height, data: new Uint8ClampedArray(before.data) },
        after: { width: after.width, height: after.height, data: new Uint8ClampedArray(after.data) },
        label: "Remove background",
      }),
      { stack: this.stack }
    );
  }
}

// Suppress unused-import warning for PROJECT_VERSION (kept for re-export).
export const _ver = PROJECT_VERSION;
