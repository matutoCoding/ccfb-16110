// IndexedDB 薄封装：版本化仓储，所有表共用一个库
const DB_NAME = 'cooling-yard-db';
const DB_VERSION = 1;

export const STORES = [
  'layouts',
  'forgings',
  'batches',
  'readings',
  'hardness',
  'records',
  'meta',
] as const;

export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name === 'forgings') store.createIndex('batchId', 'batchId');
          if (name === 'readings') store.createIndex('batchId', 'batchId');
          if (name === 'hardness') store.createIndex('batchId', 'batchId');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const repo = {
  async get<T>(store: StoreName, id: string): Promise<T | undefined> {
    return tx<T | undefined>(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
  },

  async all<T>(store: StoreName): Promise<T[]> {
    return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  },

  async byIndex<T>(store: StoreName, index: string, value: string): Promise<T[]> {
    return openDb().then(
      (db) =>
        new Promise<T[]>((resolve, reject) => {
          const t = db.transaction(store, 'readonly');
          const req = t.objectStore(store).index(index).getAll(value);
          req.onsuccess = () => resolve(req.result as T[]);
          req.onerror = () => reject(req.error);
        }),
    );
  },

  async put<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
    await tx(store, 'readwrite', (s) => s.put(value));
  },

  async putAll<T extends { id: string }>(store: StoreName, values: T[]): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      for (const v of values) s.put(v);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async remove(store: StoreName, id: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.delete(id));
  },

  async clear(store: StoreName): Promise<void> {
    await tx(store, 'readwrite', (s) => s.clear());
  },
};
