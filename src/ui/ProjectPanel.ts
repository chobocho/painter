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
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = "프로젝트";
    header.appendChild(title);
    this.root.appendChild(header);

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    const mk = (label: string, title: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", fn);
      return b;
    };
    btnRow.appendChild(mk("새 프로젝트", "새 프로젝트 시작", this.handlers.onNew));
    btnRow.appendChild(mk("저장", "현재 프로젝트를 IndexedDB에 저장", this.handlers.onSave));
    btnRow.appendChild(mk("PNG ↓", "PNG 이미지로 내보내기", this.handlers.onExportPng));
    btnRow.appendChild(mk("JSON ↓", "프로젝트 JSON으로 내보내기", this.handlers.onExportJson));
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
    // Accept any image MIME; the underlying decoder handles PNG/JPEG/WebP
    // and some Android browsers were rejecting the input when the accept
    // filter was set to "image/png" specifically.
    pngIn.accept = "image/*";
    pngIn.addEventListener("change", () => {
      const f = pngIn.files?.[0];
      if (f) this.handlers.onImportPng(f);
    });
    const lblJ = document.createElement("label");
    lblJ.textContent = "JSON 불러오기";
    lblJ.title = "이전에 내보낸 프로젝트 JSON을 불러옵니다";
    lblJ.appendChild(jsonIn);
    const lblP = document.createElement("label");
    lblP.textContent = "PNG 가져오기";
    lblP.title = "PNG 이미지를 새 레이어로 가져옵니다";
    lblP.appendChild(pngIn);
    importRow.appendChild(lblJ);
    importRow.appendChild(lblP);
    importRow.appendChild(mk("배경 제거", "현재 레이어에서 배경색을 chroma key로 제거", this.handlers.onChromaKey));
    this.root.appendChild(importRow);

    const list = document.createElement("div");
    list.className = "project-list";
    const projects: ProjectMeta[] = await this.store.listProjects();
    if (projects.length === 0) {
      const empty = document.createElement("div");
      empty.className = "project-empty";
      empty.textContent = "저장된 프로젝트가 없습니다";
      list.appendChild(empty);
    } else {
      for (const p of projects) {
        const row = document.createElement("div");
        row.className = "project-row";
        row.textContent = `${p.name} (${new Date(p.updatedAt).toLocaleString()})`;
        row.title = "클릭하여 불러오기";
        row.addEventListener("click", () => this.handlers.onLoad(p.id));
        list.appendChild(row);
      }
    }
    this.root.appendChild(list);
  }
}
