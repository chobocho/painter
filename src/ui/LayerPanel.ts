import { LayerStack } from "../core/LayerStack.js";

export interface LayerPanelHandlers {
  onAdd: () => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onOpacity: (id: string, opacity: number) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export class LayerPanel {
  constructor(
    private root: HTMLElement,
    private stack: LayerStack,
    private handlers: LayerPanelHandlers
  ) {
    stack.on("change", () => this.render());
  }

  render(): void {
    this.root.innerHTML = "";
    const header = document.createElement("div");
    header.className = "panel-header";
    header.textContent = "Layers";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+";
    addBtn.title = "New layer";
    addBtn.addEventListener("click", () => this.handlers.onAdd());
    header.appendChild(addBtn);
    this.root.appendChild(header);

    const list = document.createElement("div");
    list.className = "layer-list";
    const layers = this.stack.getAll().slice().reverse();
    const activeId = this.stack.getActiveId();
    for (const layer of layers) {
      const row = document.createElement("div");
      row.className = "layer-row" + (layer.id === activeId ? " active" : "");
      row.addEventListener("click", () => this.handlers.onSelect(layer.id));

      const eye = document.createElement("button");
      eye.type = "button";
      eye.textContent = layer.visible ? "👁" : "—";
      eye.title = "Toggle visibility";
      eye.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handlers.onToggleVisible(layer.id, !layer.visible);
      });
      row.appendChild(eye);

      const nameEl = document.createElement("input");
      nameEl.type = "text";
      nameEl.value = layer.name;
      nameEl.className = "layer-name";
      nameEl.addEventListener("change", () => this.handlers.onRename(layer.id, nameEl.value));
      nameEl.addEventListener("click", (e) => e.stopPropagation());
      row.appendChild(nameEl);

      const opacity = document.createElement("input");
      opacity.type = "range";
      opacity.min = "0";
      opacity.max = "1";
      opacity.step = "0.05";
      opacity.value = String(layer.opacity);
      opacity.title = "Opacity";
      opacity.addEventListener("input", (e) => {
        e.stopPropagation();
        this.handlers.onOpacity(layer.id, parseFloat(opacity.value));
      });
      row.appendChild(opacity);

      const up = document.createElement("button"); up.type = "button"; up.textContent = "↑";
      up.addEventListener("click", (e) => { e.stopPropagation(); this.handlers.onMoveUp(layer.id); });
      const dn = document.createElement("button"); dn.type = "button"; dn.textContent = "↓";
      dn.addEventListener("click", (e) => { e.stopPropagation(); this.handlers.onMoveDown(layer.id); });
      const rm = document.createElement("button"); rm.type = "button"; rm.textContent = "✕"; rm.title = "Delete";
      rm.addEventListener("click", (e) => { e.stopPropagation(); this.handlers.onRemove(layer.id); });
      row.appendChild(up);
      row.appendChild(dn);
      row.appendChild(rm);

      list.appendChild(row);
    }
    this.root.appendChild(list);
  }
}
