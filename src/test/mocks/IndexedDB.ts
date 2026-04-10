// In-memory IndexedDB shim. Implements just enough of the API for IndexedDBStore tests.

interface MockStore {
  data: Map<IDBValidKey, unknown>;
  keyPath: string | null;
}

interface MockTransaction {
  store(name: string): MockObjectStore;
}

class MockObjectStore {
  constructor(private store: MockStore) {}
  put(value: unknown, key?: IDBValidKey): MockRequest<IDBValidKey> {
    const k = key ?? (this.store.keyPath ? (value as Record<string, IDBValidKey>)[this.store.keyPath] : undefined);
    if (k === undefined) throw new Error("MockObjectStore.put: missing key");
    this.store.data.set(k, value);
    return new MockRequest(k);
  }
  get(key: IDBValidKey): MockRequest<unknown> {
    return new MockRequest(this.store.data.get(key));
  }
  delete(key: IDBValidKey): MockRequest<undefined> {
    this.store.data.delete(key);
    return new MockRequest(undefined);
  }
  getAll(): MockRequest<unknown[]> {
    return new MockRequest(Array.from(this.store.data.values()));
  }
  clear(): MockRequest<undefined> {
    this.store.data.clear();
    return new MockRequest(undefined);
  }
}

class MockRequest<T> {
  result: T;
  onsuccess: ((this: MockRequest<T>, ev: Event) => void) | null = null;
  onerror: ((this: MockRequest<T>, ev: Event) => void) | null = null;
  constructor(result: T) {
    this.result = result;
    queueMicrotask(() => {
      if (this.onsuccess) this.onsuccess.call(this, {} as Event);
    });
  }
}

class MockIDBTransaction {
  oncomplete: ((this: MockIDBTransaction, ev: Event) => void) | null = null;
  onerror: ((this: MockIDBTransaction, ev: Event) => void) | null = null;
  onabort: ((this: MockIDBTransaction, ev: Event) => void) | null = null;
  constructor(private db: MockIDBDatabase, private storeNames: string[]) {
    // Fire oncomplete two microtasks later so that any request `onsuccess`
    // (one microtask) and the caller's `result` capture have already happened.
    Promise.resolve().then(() => Promise.resolve()).then(() => {
      if (this.oncomplete) this.oncomplete.call(this, {} as Event);
    });
  }
  objectStore(name: string): MockObjectStore {
    if (!this.storeNames.includes(name)) throw new Error("Store not in transaction: " + name);
    const store = this.db.stores.get(name);
    if (!store) throw new Error("Store not found: " + name);
    return new MockObjectStore(store);
  }
}

export class MockIDBDatabase {
  stores: Map<string, MockStore> = new Map();
  name: string;
  version: number;
  objectStoreNames: { contains(name: string): boolean; };
  constructor(name: string, version: number) {
    this.name = name;
    this.version = version;
    this.objectStoreNames = {
      contains: (n: string) => this.stores.has(n),
    };
  }
  createObjectStore(name: string, opts?: { keyPath?: string }): MockObjectStore {
    const store: MockStore = { data: new Map(), keyPath: opts?.keyPath ?? null };
    this.stores.set(name, store);
    return new MockObjectStore(store);
  }
  transaction(names: string | string[], _mode?: string): MockIDBTransaction {
    const arr = Array.isArray(names) ? names : [names];
    return new MockIDBTransaction(this, arr);
  }
  close(): void {}
}

class MockIDBOpenRequest {
  result: MockIDBDatabase;
  onsuccess: ((this: MockIDBOpenRequest, ev: Event) => void) | null = null;
  onerror: ((this: MockIDBOpenRequest, ev: Event) => void) | null = null;
  onupgradeneeded: ((this: MockIDBOpenRequest, ev: Event) => void) | null = null;
  constructor(name: string, version: number, isNew: boolean) {
    this.result = MockIndexedDB._dbs.get(name) ?? new MockIDBDatabase(name, version);
    if (isNew) {
      this.result.version = version;
      MockIndexedDB._dbs.set(name, this.result);
    }
    Promise.resolve().then(() => {
      if (isNew && this.onupgradeneeded) this.onupgradeneeded.call(this, {} as Event);
      if (this.onsuccess) this.onsuccess.call(this, {} as Event);
    });
  }
}

export const MockIndexedDB = {
  _dbs: new Map<string, MockIDBDatabase>(),
  open(name: string, version: number): MockIDBOpenRequest {
    const isNew = !this._dbs.has(name);
    return new MockIDBOpenRequest(name, version, isNew);
  },
  deleteDatabase(name: string): void {
    this._dbs.delete(name);
  },
  reset(): void {
    this._dbs.clear();
  },
};

export function installIDBGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g["indexedDB"] = MockIndexedDB;
}
