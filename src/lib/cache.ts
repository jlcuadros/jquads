/**
 * Download-once cache for big binary files (Maia model, Stockfish NNUE nets).
 *
 * Files are stored in IndexedDB keyed by their URL, so they are downloaded
 * only the first time. Used from both the main thread and the Maia worker
 * (IndexedDB is available in workers), which keeps a single implementation.
 */

const DB_NAME = 'maia-analysis-cache'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getCached(url: string): Promise<ArrayBuffer | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(url)
    req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function putCached(url: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(data, url)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Deletes every cached file (useful to measure a "first visit"). */
export async function clearCache(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Returns the file at `url`, from the cache if present, otherwise downloads
 * it (reporting progress 0..1 when the size is known) and caches it.
 * A failure to write the cache is not fatal: the data is still returned.
 */
export async function fetchCached(
  url: string,
  onProgress?: (fraction: number) => void,
): Promise<{ data: ArrayBuffer; fromCache: boolean }> {
  try {
    const cached = await getCached(url)
    if (cached) return { data: cached, fromCache: true }
  } catch (e) {
    console.warn('cache read failed', e)
  }

  const data = await downloadWithRetry(url, onProgress)
  try {
    await putCached(url, data.buffer as ArrayBuffer)
  } catch (e) {
    console.warn('cache write failed', e)
  }
  return { data: data.buffer as ArrayBuffer, fromCache: false }
}

/**
 * Pauses (ms) before each retry. Big downloads over mobile data / from GitHub
 * can drop, and short network outages can last several seconds (seen in
 * testing on 2026-10-25), so the waits grow: 4 attempts in total.
 */
const RETRY_DELAYS_MS = [2000, 5000, 10000]

/** Downloads `url`, retrying on network errors with a short pause between attempts. */
async function downloadWithRetry(url: string, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await download(url, onProgress)
    } catch (e) {
      if (attempt >= RETRY_DELAYS_MS.length) throw e
      console.warn(`download failed (attempt ${attempt + 1}), retrying in ${RETRY_DELAYS_MS[attempt]} ms`, url, e)
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    }
  }
}

/** One download attempt, reading the body in chunks to report progress. */
async function download(url: string, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} downloading ${url}`)
  const total = Number(res.headers.get('content-length')) || 0

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) onProgress?.(received / total)
  }
  const data = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    data.set(c, offset)
    offset += c.length
  }
  return data
}
