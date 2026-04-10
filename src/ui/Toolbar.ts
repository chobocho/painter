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
      btn.textContent = t.label;
      btn.title = t.shortcut ? `${t.label} (${t.shortcut})` : t.label;
      btn.dataset["toolId"] = t.id;
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
