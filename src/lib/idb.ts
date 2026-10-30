/**
 * Minimal key-value store on IndexedDB: one object store per database, values
 * of any structured-cloneable type. Shared by the download cache (cache.ts,
 * also used from the Maia worker) and the 📁 Local databases
 * (games/localDbs.ts), which can be several MB: too big for localStorage.
 */

export interface KvStore<T> {
  get(key: string): Promise<T | undefined>
  put(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

export function kvStore<T>(dbName: string, store: string): KvStore<T> {
  let db: Promise<IDBDatabase> | undefined
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(store)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        db = undefined // let a later call try again
        reject(req.error)
      }
    }))
  /** Runs one request in its own transaction and resolves when it is done. */
  const run = async <R>(mode: IDBTransactionMode, request: (s: IDBObjectStore) => IDBRequest): Promise<R> => {
    const tx = (await open()).transaction(store, mode)
    const req = request(tx.objectStore(store))
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result as R)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
  return {
    get: (key) => run<T | undefined>('readonly', (s) => s.get(key)),
    put: (key, value) => run<void>('readwrite', (s) => s.put(value, key)).then(() => undefined),
    delete: (key) => run<void>('readwrite', (s) => s.delete(key)).then(() => undefined),
    clear: () => run<void>('readwrite', (s) => s.clear()).then(() => undefined),
  }
}
