import { CommandHistory } from "../history/CommandHistory.js";

export class HistoryPanel {
  constructor(
    private root: HTMLElement,
    private history: CommandHistory,
    private onUndo: () => void,
    private onRedo: () => void
  ) {
    history.on("change", () => this.render());
  }

  render(): void {
    this.root.innerHTML = "";
    const header = document.createElement("div");
    header.className = "panel-header";
    header.textContent = "History";
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.textContent = "↶";
    undoBtn.title = "Undo";
    undoBtn.disabled = !this.history.canUndo();
    undoBtn.addEventListener("click", () => this.onUndo());
    const redoBtn = document.createElement("button");
    redoBtn.type = "button";
    redoBtn.textContent = "↷";
    redoBtn.title = "Redo";
    redoBtn.disabled = !this.history.canRedo();
    redoBtn.addEventListener("click", () => this.onRedo());
    header.appendChild(undoBtn);
    header.appendChild(redoBtn);
    this.root.appendChild(header);

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
