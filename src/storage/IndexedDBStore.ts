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

  putProject(p: StoredProject): Promise<string> {
    return this.withStore(STORE_PROJECTS, "readwrite", (s) => s.put(p));
  }
  getProject(id: string): Promise<StoredProject | undefined> {
    return this.withStore(STORE_PROJECTS, "readonly", (s) => s.get(id));
  }
  deleteProject(id: string): Promise<void> {
    return this.withStore(STORE_PROJECTS, "readwrite", (s) => s.delete(id));
  }
  async listProjects(): Promise<ProjectMeta[]> {
    const all = await this.withStore<StoredProject[]>(STORE_PROJECTS, "readonly", (s) => s.getAll());
    return (all ?? [])
      .map(({ id, name, createdAt, updatedAt, width, height, thumb }) => ({ id, name, createdAt, updatedAt, width, height, thumb }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  putAutoSave(a: StoredAutoSave): Promise<string> {
    return this.withStore(STORE_AUTOSAVES, "readwrite", (s) => s.put(a));
  }
  getAutoSave(id: string): Promise<StoredAutoSave | undefined> {
    return this.withStore(STORE_AUTOSAVES, "readonly", (s) => s.get(id));
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
