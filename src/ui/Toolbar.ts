import { ToolRegistry } from "../tools/ToolRegistry.js";

export class Toolbar {
  constructor(
    private root: HTMLElement,
    private registry: ToolRegistry,
    private onSelect: (id: string) => void
  ) {}

  render(activeId: string): void {
    this.root.innerHTML = "";
    for (const t of this.registry.list()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tool-btn" + (t.id === activeId ? " active" : "");
      btn.title = t.shortcut ? `${t.label} (${t.shortcut})` : t.label;
      btn.dataset["toolId"] = t.id;
      const ico = document.createElement("span");
      ico.className = "tool-icon";
      ico.textContent = t.icon;
      const lbl = document.createElement("span");
      lbl.className = "tool-label";
      lbl.textContent = t.label;
      btn.appendChild(ico);
      btn.appendChild(lbl);
      btn.addEventListener("click", () => this.onSelect(t.id));
      this.root.appendChild(btn);
    }
  }

  setActive(id: string): void {
    for (const btn of Array.from(this.root.querySelectorAll<HTMLButtonElement>(".tool-btn"))) {
      btn.classList.toggle("active", btn.dataset["toolId"] === id);
    }
  }
}
