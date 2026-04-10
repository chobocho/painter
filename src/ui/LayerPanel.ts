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

export const LAYER_LIMIT = 5;

export class LayerPanel {
  private collapsed: boolean = false;

  constructor(
    private root: HTMLElement,
    private stack: LayerStack,
    private handlers: LayerPanelHandlers
  ) {
    stack.on("change", () => this.render());
  }

  isCollapsed(): boolean { return this.collapsed; }
  setCollapsed(v: boolean): void { this.collapsed = v; this.render(); }
  toggle(): void { this.setCollapsed(!this.collapsed); }

  render(): void {
    this.root.innerHTML = "";
    const header = document.createElement("div");
    header.className = "panel-header";

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "panel-collapse-btn";
    collapseBtn.textContent = this.collapsed ? "▶" : "▼";
    collapseBtn.title = this.collapsed ? "레이어 펼치기" : "레이어 접기";
    collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    header.appendChild(collapseBtn);

    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = `레이어 (${this.stack.size()}/${LAYER_LIMIT})`;
    header.appendChild(title);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "layer-add-btn";
    addBtn.textContent = "+ 새 레이어";
    addBtn.title = `새 레이어 추가 (최대 ${LAYER_LIMIT}개)`;
    addBtn.disabled = this.stack.size() >= LAYER_LIMIT;
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!addBtn.disabled) this.handlers.onAdd();
    });
    header.appendChild(addBtn);
    this.root.appendChild(header);

    if (this.collapsed) return;

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
      eye.className = "layer-eye";
      eye.textContent = layer.visible ? "👁" : "—";
      eye.title = layer.visible ? "숨기기" : "보이기";
      eye.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handlers.onToggleVisible(layer.id, !layer.visible);
      });
      row.appendChild(eye);

      // Round-7 fix: name input is read-only by default so a single click
      // bubbles up to the row and selects the layer. Double-click switches
      // to edit mode; blur or Enter restores read-only.
      const nameEl = document.createElement("input");
      nameEl.type = "text";
      nameEl.value = layer.name;
      nameEl.className = "layer-name";
      nameEl.readOnly = true;
      nameEl.title = "두 번 클릭하여 이름 변경";
      nameEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        nameEl.readOnly = false;
        // In a real DOM the focus/select calls help. They're noops on the
        // mock element but harmless.
        if (typeof (nameEl as unknown as { focus?: () => void }).focus === "function") {
          (nameEl as unknown as { focus: () => void }).focus();
        }
      });
      nameEl.addEventListener("blur", () => {
        nameEl.readOnly = true;
        if (nameEl.value !== layer.name) this.handlers.onRename(layer.id, nameEl.value);
      });
      nameEl.addEventListener("change", () => {
        if (nameEl.value !== layer.name) this.handlers.onRename(layer.id, nameEl.value);
      });
      // Note: NO click stopPropagation. The click bubbles to the row and
      // selects the layer; in read-only mode that's exactly what we want.
      row.appendChild(nameEl);

      const opacity = document.createElement("input");
      opacity.type = "range";
      opacity.min = "0";
      opacity.max = "1";
      opacity.step = "0.05";
      opacity.value = String(layer.opacity);
      opacity.className = "layer-opacity";
      opacity.title = "투명도";
      opacity.addEventListener("input", (e) => {
        e.stopPropagation();
        this.handlers.onOpacity(layer.id, parseFloat(opacity.value));
      });
      opacity.addEventListener("click", (e) => e.stopPropagation());
      row.appendChild(opacity);

      const up = document.createElement("button");
      up.type = "button";
      up.className = "layer-up";
      up.textContent = "↑";
      up.title = "위로";
      up.addEventListener("click", (e) => { e.stopPropagation(); this.handlers.onMoveUp(layer.id); });

      const dn = document.createElement("button");
      dn.type = "button";
      dn.className = "layer-down";
      dn.textContent = "↓";
      dn.title = "아래로";
      dn.addEventListener("click", (e) => { e.stopPropagation(); this.handlers.onMoveDown(layer.id); });

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "layer-remove";
      rm.textContent = "✕";
      rm.title = "삭제";
      rm.addEventListener("click", (e) => { e.stopPropagation(); this.handlers.onRemove(layer.id); });

      row.appendChild(up);
      row.appendChild(dn);
      row.appendChild(rm);

      list.appendChild(row);
    }
    this.root.appendChild(list);
  }
}
