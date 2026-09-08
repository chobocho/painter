// Top-level orchestrator. Wires together canvas, layers, history, tools,
// storage, autosave, input, and UI panels into a working painter app.

import { LayerStack } from "../core/LayerStack.js";
import { Layer, CanvasFactory, LayerSnapshot } from "../core/Layer.js";
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
import { LayerPanel, LAYER_LIMIT } from "../ui/LayerPanel.js";
import { PATTERN_IDS } from "../tools/PatternBrush.js";
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

/**
 * 복원할 프로젝트 JSON 을 고른다. 자동 저장본과 명시 저장본 중 더 최근 것을
 * 쓴다. 예전에는 자동 저장본만 봐서, Ctrl+S 로 저장한 최신 상태가 있어도
 * 그보다 오래된 자동 저장본이 올라오는 경우가 있었다.
 */
/**
 * 히스토리 커맨드에 넣을 레이어 스냅샷. 반드시 compact 로 만든다.
 * 옵션 없는 serialize() 는 비압축 base64(rawRGBA)를 만드는데, 1920×1280
 * 레이어 한 장이 약 13MB 문자열이고 브라우저 폴백 경로에서 인코딩·디코딩에
 * 각각 1.6초쯤 걸려 레이어 추가/삭제/PNG 가져오기가 그대로 멈춰 보였다.
 */
/**
 * 투명도 슬라이더 드래그 한 번을 히스토리 항목 하나로 묶는다.
 * preview() 는 화면만 바꾸고, commit() 이 드래그 시작 전 값을 before 로 삼아
 * 커맨드를 만든다. 값이 그대로면 아무것도 기록하지 않는다.
 */
/** 캔버스 한 변의 상한. 이보다 크면 브라우저가 캔버스 생성에 실패한다. */
export const MAX_PROJECT_SIZE = 8192;

/**
 * 새 프로젝트 크기 입력을 검증한다.
 * 취소(null)·숫자가 아님·0 이하는 모두 null 로 돌려 프로젝트를 만들지 않게 한다.
 * 빈 입력은 기존 크기를 그대로 쓰고, 지나치게 큰 값은 상한으로 자른다.
 */
export function parseProjectSize(input: string | null, fallback: number): number | null {
  if (input === null) return null;
  const trimmed = input.trim();
  if (trimmed === "") return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 1) return null;
  return Math.min(i, MAX_PROJECT_SIZE);
}

export class OpacityDrag {
  private start: { id: string; opacity: number } | null = null;

  preview(stack: LayerStack, id: string, opacity: number): void {
    const layer = stack.get(id);
    if (!layer) return;
    if (!this.start || this.start.id !== id) this.start = { id, opacity: layer.opacity };
    stack.setOpacity(id, opacity);
  }

  commit(stack: LayerStack, history: CommandHistory, id: string, opacity: number): void {
    const layer = stack.get(id);
    if (!layer) return;
    const beforeOpacity = this.start && this.start.id === id ? this.start.opacity : layer.opacity;
    this.start = null;
    if (beforeOpacity === opacity) {
      stack.setOpacity(id, opacity);
      return;
    }
    history.execute(
      new SetLayerPropsCommand({
        layerId: id,
        before: { visible: layer.visible, opacity: beforeOpacity, name: layer.name },
        after: { opacity },
      }),
      { stack }
    );
  }
}

export function historySnapshot(layer: Layer): LayerSnapshot {
  return layer.serialize({ compact: true });
}

export function pickRestoreJson(
  auto?: { savedAt: number; projectJson: string },
  project?: { updatedAt: number; projectJson: string }
): string | undefined {
  if (!auto) return project?.projectJson;
  if (!project) return auto.projectJson;
  return auto.savedAt >= project.updatedAt ? auto.projectJson : project.projectJson;
}

export class PainterApp {
  private opacityDrag = new OpacityDrag();
  /** mount 에서 만든 캔버스 리핏 함수. 프로젝트 크기가 바뀌면 다시 불러야 한다. */
  private refitCanvas: (() => void) | null = null;
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
            <label id="brush-size-label">굵기 <input type="range" id="brush-size" min="1" max="64" value="${this.settings.brushSize}"></label>
            <label>허용 <input type="range" id="tolerance" min="0" max="128" value="${this.settings.tolerance}"></label>
            <label id="pattern-select-label" style="display:none;">패턴
              <select id="pattern-select"></select>
            </label>
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
    this.refitCanvas = fitCanvasToContainer;
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
    this.updateBrushControls();

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
      onOpacity: (id, o) => this.opacityDrag.commit(this.stack, this.history, id, o),
      onOpacityPreview: (id, o) => this.opacityDrag.preview(this.stack, id, o),
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

    // Pattern brush type selector — only visible when the pattern tool is active.
    const patternSelect = root.querySelector("#pattern-select") as HTMLSelectElement;
    for (const id of PATTERN_IDS) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      patternSelect.appendChild(opt);
    }
    if (PATTERN_IDS.length > 0) {
      this.settings.patternId = PATTERN_IDS[0]!;
      patternSelect.value = PATTERN_IDS[0]!;
    }
    patternSelect.addEventListener("change", () => {
      this.settings.patternId = patternSelect.value;
    });
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
        const [auto, project] = await Promise.all([
          this.store.getAutoSave(lastId),
          this.store.getProject(lastId),
        ]);
        const json = pickRestoreJson(auto, project);
        if (json) {
          this.applyState(ProjectCodec.decode(json));
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
    const base = new Layer({ name: "배경", width: w, height: h, factory: realCanvasFactory });
    base.getCtx().fillStyle = "#ffffff";
    base.getCtx().fillRect(0, 0, w, h);
    this.stack.add(base);
    const draw = new Layer({ name: "레이어 1", width: w, height: h, factory: realCanvasFactory });
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
    this.updateBrushControls();
  }

  /** Round-7: brush-size label adapts per tool category so the user can
   *  see what the slider actually controls. Also toggles the pattern
   *  picker visibility. */
  private updateBrushControls(): void {
    const labels: Record<string, string> = {
      pencil: "굵기",
      eraser: "굵기",
      line: "굵기",
      rect: "굵기", "rect-filled": "굵기",
      square: "굵기", "square-filled": "굵기",
      ellipse: "굵기", "ellipse-filled": "굵기",
      circle: "굵기", "circle-filled": "굵기",
      triangle: "굵기", "triangle-filled": "굵기",
      spray: "범위",
      pattern: "크기",
      smudge: "굵기",
    };
    const sliderLabel = document.getElementById("brush-size-label");
    if (sliderLabel) {
      const word = labels[this.activeToolId] ?? "굵기";
      const slider = sliderLabel.querySelector ? sliderLabel.querySelector("input") : null;
      sliderLabel.textContent = word + " ";
      if (slider) sliderLabel.appendChild(slider);
    }
    const patternLabel = document.getElementById("pattern-select-label");
    if (patternLabel) {
      patternLabel.style.display = this.activeToolId === "pattern" ? "" : "none";
    }
  }

  private flashStatus(msg: string, ms: number = 1500): void {
    const el = document.getElementById("status-bar");
    if (!el) return;
    el.textContent = msg;
    setTimeout(() => this.updateStatusBar(), ms);
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
    if (this.stack.size() >= LAYER_LIMIT) {
      this.flashStatus(`⚠️  최대 ${LAYER_LIMIT}개 레이어까지 만들 수 있습니다`, 2500);
      return;
    }
    try {
      const layer = new Layer({ name: `레이어 ${this.stack.size() + 1}`, width: this.projectWidth, height: this.projectHeight, factory: realCanvasFactory });
      this.history.execute(new AddLayerCommand({ snapshot: historySnapshot(layer), index: this.stack.size() }), { stack: this.stack });
      this.scheduleRender();
      this.flashStatus(`✓ 레이어 추가 (${this.stack.size()}/${LAYER_LIMIT})`, 1200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.flashStatus(`⚠️ 레이어 추가 실패: ${msg}`, 3000);
      console.error("addLayer failed", e);
    }
  }

  private removeLayer(id: string): void {
    const layer = this.stack.get(id);
    if (!layer) return;
    const index = this.stack.getAll().findIndex((l) => l.id === id);
    this.history.execute(new RemoveLayerCommand({ snapshot: historySnapshot(layer), index }), { stack: this.stack });
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
      compact: true,
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
    // Compact saves drop the history payload — reload with an empty history
    // so subsequent edits record cleanly into the (now listener-preserving)
    // CommandHistory and show up in the HistoryPanel.
    this.history.replace(state.history ?? { past: [], future: [] });
    Object.assign(this.settings, state.settings);
    this.previewLayer = new Layer({ name: "Preview", width: this.projectWidth, height: this.projectHeight, factory: realCanvasFactory });
    if (this.displayCanvas) this.displayCanvas.setProjectSize(this.projectWidth, this.projectHeight);
    // 크기만 바꾸고 리핏을 안 하면 화면이 늘어져 보이고 포인터 좌표가 어긋난다.
    this.refitCanvas?.();
    // Panels may have been created before this restore; force-refresh them so
    // the layer list and history list are immediately in sync with the loaded
    // state (the event-listener path is correct but fires asynchronously on
    // some browser builds, leaving a brief visual gap on Fold7).
    if (this.layerPanel) this.layerPanel.render();
    if (this.historyPanel) this.historyPanel.render();
    // 자동 저장 대상을 방금 불러온 프로젝트로 옮긴다. 빠뜨리면 부팅 때의
    // 임시 ID 아래에 저장이 쌓여 다음 실행에서 옛 상태가 복원된다.
    if (this.autoSaver) this.autoSaver.setProjectId(this.projectId);
    this.scheduleRender();
  }

  newProject(): void {
    const wIn = prompt("가로 크기?", String(this.projectWidth));
    if (wIn === null) return; // 취소하면 아무것도 만들지 않는다
    const hIn = prompt("세로 크기?", String(this.projectHeight));
    if (hIn === null) return;
    const w = parseProjectSize(wIn, this.projectWidth);
    const h = parseProjectSize(hIn, this.projectHeight);
    if (w === null || h === null) {
      this.flashStatus(`⚠️ 크기는 1~${MAX_PROJECT_SIZE} 사이의 숫자여야 합니다`, 3000);
      return;
    }
    this.projectId = Uid.next();
    this.projectName = "Untitled";
    this.createdAt = Date.now();
    if (this.autoSaver) this.autoSaver.setProjectId(this.projectId);
    this.newProjectInternal(w, h);
    // 표시 캔버스에도 새 크기를 알려주고 다시 맞춘다. 빠뜨리면 크기가 다른
    // 프로젝트에서 포인터 좌표가 그대로 어긋난다.
    this.displayCanvas?.setProjectSize(w, h);
    this.refitCanvas?.();
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
    try {
      const text = await file.text();
      const state = ProjectCodec.decode(text);
      this.applyState(state);
      void this.projectPanel.render();
      this.flashStatus(`✓ JSON 불러오기 완료: ${file.name}`, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.flashStatus(`⚠️ JSON 불러오기 실패: ${msg}`, 3500);
      console.error("importJson failed", e);
    }
  }

  async importPng(file: File): Promise<void> {
    try {
      const layer = await importPngFile(file, this.projectWidth, this.projectHeight, realCanvasFactory, file.name);
      this.history.execute(
        new AddLayerCommand({ snapshot: historySnapshot(layer), index: this.stack.size() }),
        { stack: this.stack }
      );
      // Ensure the canvas repaints even if the stack-change listener fires
      // asynchronously or is momentarily behind.
      this.scheduleRender();
      this.flashStatus(`✓ PNG 가져오기: ${file.name}`, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.flashStatus(`⚠️ PNG 가져오기 실패: ${msg}`, 3500);
      console.error("importPng failed", e);
    }
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
