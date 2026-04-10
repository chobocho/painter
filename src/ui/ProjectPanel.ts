import { IndexedDBStore, ProjectMeta } from "../storage/IndexedDBStore.js";

export interface ProjectPanelHandlers {
  onNew: () => void;
  onSave: () => void;
  onLoad: (id: string) => void;
  onExportPng: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onImportPng: (file: File) => void;
  onChromaKey: () => void;
}

export class ProjectPanel {
  constructor(
    private root: HTMLElement,
    private store: IndexedDBStore,
    private handlers: ProjectPanelHandlers
  ) {}

  async render(): Promise<void> {
    this.root.innerHTML = "";
    const header = document.createElement("div");
    header.className = "panel-header";
    header.textContent = "Project";
    this.root.appendChild(header);

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    btnRow.appendChild(mk("New", this.handlers.onNew));
    btnRow.appendChild(mk("Save", this.handlers.onSave));
    btnRow.appendChild(mk("PNG↓", this.handlers.onExportPng));
    btnRow.appendChild(mk("JSON↓", this.handlers.onExportJson));
    this.root.appendChild(btnRow);

    const importRow = document.createElement("div");
    importRow.className = "btn-row";
    const jsonIn = document.createElement("input");
    jsonIn.type = "file";
    jsonIn.accept = ".json";
    jsonIn.addEventListener("change", () => {
      const f = jsonIn.files?.[0];
      if (f) this.handlers.onImportJson(f);
    });
    const pngIn = document.createElement("input");
    pngIn.type = "file";
    pngIn.accept = "image/png";
    pngIn.addEventListener("change", () => {
      const f = pngIn.files?.[0];
      if (f) this.handlers.onImportPng(f);
    });
    const lblJ = document.createElement("label");
    lblJ.textContent = "Load JSON";
    lblJ.appendChild(jsonIn);
    const lblP = document.createElement("label");
    lblP.textContent = "Import PNG";
    lblP.appendChild(pngIn);
    importRow.appendChild(lblJ);
    importRow.appendChild(lblP);
    importRow.appendChild(mk("Remove BG", this.handlers.onChromaKey));
    this.root.appendChild(importRow);

    const list = document.createElement("div");
    list.className = "project-list";
    const projects: ProjectMeta[] = await this.store.listProjects();
    for (const p of projects) {
      const row = document.createElement("div");
      row.className = "project-row";
      row.textContent = `${p.name} (${new Date(p.updatedAt).toLocaleString()})`;
      row.addEventListener("click", () => this.handlers.onLoad(p.id));
      list.appendChild(row);
    }
    this.root.appendChild(list);
  }
}
