// Tiny promise wrapper around IndexedDB. No external dependencies. Safe to
// run with the test mock at src/test/mocks/IndexedDB.ts.

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  thumb?: string;
}

export interface StoredProject extends ProjectMeta {
  projectJson: string;
}

export interface StoredAutoSave {
  id: string;
  savedAt: number;
  projectJson: string;
}

const DB_NAME = "painter";
const DB_VERSION = 1;
const STORE_PROJECTS = "projects";
const STORE_AUTOSAVES = "autosaves";
const STORE_META = "meta";
/**
 * 프로젝트 목록용 메타 인덱스 키. 목록 조회가 projects 전체(각 수백 KB 의
 * projectJson 포함)를 읽지 않도록, 가벼운 메타만 이 한 레코드에 모아 둔다.
 */
const PROJECT_INDEX_KEY = "projectIndex";

function toMeta(p: StoredProject): ProjectMeta {
  const { id, name, createdAt, updatedAt, width, height, thumb } = p;
  return { id, name, createdAt, updatedAt, width, height, thumb };
}

interface IDBLike {
  open(name: string, version: number): unknown;
}

export class IndexedDBStore {
  private db: any = null;
  private readonly idb: IDBLike;

  constructor(idb?: IDBLike) {
    this.idb = idb ?? (globalThis as any).indexedDB;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.idb.open(DB_NAME, DB_VERSION) as any;
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_AUTOSAVES)) db.createObjectStore(STORE_AUTOSAVES, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  private withStore<T>(store: string, mode: "readonly" | "readwrite", fn: (s: any) => any): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const s = tx.objectStore(store);
      let result: T;
      const req = fn(s);
      if (req && typeof req === "object" && "onsuccess" in req) {
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
      } else {
        result = req;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async putProject(p: StoredProject): Promise<string> {
    const key = await this.withStore<string>(STORE_PROJECTS, "readwrite", (s) => s.put(p));
    await this.updateIndex((list) => [...list.filter((m) => m.id !== p.id), toMeta(p)]);
    return key;
  }
  getProject(id: string): Promise<StoredProject | undefined> {
    return this.withStore(STORE_PROJECTS, "readonly", (s) => s.get(id));
  }
  async deleteProject(id: string): Promise<void> {
    await this.withStore(STORE_PROJECTS, "readwrite", (s) => s.delete(id));
    // autosave 도 같이 지운다. 예전에는 지울 방법 자체가 없어 영구 누적됐다.
    await this.deleteAutoSave(id);
    await this.updateIndex((list) => list.filter((m) => m.id !== id));
  }

  async listProjects(): Promise<ProjectMeta[]> {
    const idx = await this.getMeta(PROJECT_INDEX_KEY) as ProjectMeta[] | undefined;
    if (Array.isArray(idx)) return [...idx].sort((a, b) => b.updatedAt - a.updatedAt);
    // 인덱스가 없는 옛 저장본은 이때 한 번만 전체를 읽어 인덱스를 만들어 둔다.
    const all = await this.withStore<StoredProject[]>(STORE_PROJECTS, "readonly", (s) => s.getAll());
    const metas = (all ?? []).map(toMeta);
    await this.putMeta(PROJECT_INDEX_KEY, metas);
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 목록 인덱스를 읽고-바꾸고-쓴다. 인덱스가 없으면 listProjects 가 복구한다. */
  private async updateIndex(fn: (list: ProjectMeta[]) => ProjectMeta[]): Promise<void> {
    const current = await this.getMeta(PROJECT_INDEX_KEY) as ProjectMeta[] | undefined;
    const base = Array.isArray(current) ? current : await this.listProjects();
    await this.putMeta(PROJECT_INDEX_KEY, fn(base));
  }

  putAutoSave(a: StoredAutoSave): Promise<string> {
    return this.withStore(STORE_AUTOSAVES, "readwrite", (s) => s.put(a));
  }
  getAutoSave(id: string): Promise<StoredAutoSave | undefined> {
    return this.withStore(STORE_AUTOSAVES, "readonly", (s) => s.get(id));
  }
  deleteAutoSave(id: string): Promise<void> {
    return this.withStore(STORE_AUTOSAVES, "readwrite", (s) => s.delete(id));
  }

  putMeta(key: string, value: unknown): Promise<unknown> {
    return this.withStore(STORE_META, "readwrite", (s) => s.put(value, key));
  }
  getMeta(key: string): Promise<unknown> {
    return this.withStore(STORE_META, "readonly", (s) => s.get(key));
  }

  close(): void {
    if (this.db) { this.db.close(); this.db = null; }
  }
}
