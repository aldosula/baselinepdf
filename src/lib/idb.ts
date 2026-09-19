/** 40 lines of IndexedDB, so the app keeps your work and your signatures
 *  between visits without shipping a database dependency. */
const DB = 'pdf-studio'
const STORE = 'kv'

let dbp: Promise<IDBDatabase> | null = null
const open = () =>
  (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open()
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined // private windows and blocked storage must not break editing
  }
}

export const idbGet = <T>(key: string) => tx<T>('readonly', s => s.get(key) as IDBRequest<T>)
export const idbSet = (key: string, value: unknown) => tx('readwrite', s => s.put(value, key) as IDBRequest<unknown>)
export const idbDel = (key: string) => tx('readwrite', s => s.delete(key) as IDBRequest<undefined>)
