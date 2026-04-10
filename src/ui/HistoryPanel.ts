import { CommandHistory } from "../history/CommandHistory.js";

export class HistoryPanel {
  private collapsed: boolean = false;

  constructor(
    private root: HTMLElement,
    private history: CommandHistory,
    private onUndo: () => void,
    private onRedo: () => void
  ) {
    history.on("change", () => this.render());
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
    collapseBtn.title = this.collapsed ? "히스토리 펼치기" : "히스토리 접기";
    collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    header.appendChild(collapseBtn);

    const title = document.createElement("span");
    title.className = "panel-title";
    const sz = this.history.size();
    title.textContent = `히스토리 (${sz.past})`;
    header.appendChild(title);

    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "history-undo-btn";
    undoBtn.textContent = "↶";
    undoBtn.title = "실행 취소 (Ctrl+Z)";
    undoBtn.disabled = !this.history.canUndo();
    undoBtn.addEventListener("click", (e) => { e.stopPropagation(); this.onUndo(); });
    header.appendChild(undoBtn);

    const redoBtn = document.createElement("button");
    redoBtn.type = "button";
    redoBtn.className = "history-redo-btn";
    redoBtn.textContent = "↷";
    redoBtn.title = "다시 실행 (Ctrl+Y)";
    redoBtn.disabled = !this.history.canRedo();
    redoBtn.addEventListener("click", (e) => { e.stopPropagation(); this.onRedo(); });
    header.appendChild(redoBtn);

    this.root.appendChild(header);

    if (this.collapsed) return;

    const list = document.createElement("div");
    list.className = "history-list";
    for (const item of this.history.list()) {
      const row = document.createElement("div");
      row.className = "history-row" + (item.current ? " current" : "");
      row.textContent = item.label;
      list.appendChild(row);
    }
    this.root.appendChild(list);
  }
}
