/**
 * Main-thread wrapper around maia.worker.ts: turns the message protocol into
 * promises (`await maia.init()`, `await maia.predict(fen, elos)`).
 */
import type { MaiaPrediction } from './encoding'

export interface MaiaInitResult {
  fromCache: boolean
  ms: number
  threads: number
}

export interface MaiaPredictResult {
  predictions: Array<MaiaPrediction & { elo: number }>
  ms: number
}

/** Model URL: pinned commit of the maiachess repo (CORS + CORP headers OK, 45.7 MB). */
export const MAIA_MODEL_URL =
  'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/a6e52f5c811ee18863cb2f0e81f2433a5b9905de/public/maia3/maia3_simplified.onnx'

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  onProgress?: (fraction: number) => void
}

export class MaiaClient {
  private worker = new Worker(new URL('./maia.worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor() {
    this.worker.onmessage = (ev) => {
      const msg = ev.data
      const p = this.pending.get(msg.id)
      if (!p) return
      if (msg.type === 'progress') return p.onProgress?.(msg.fraction)
      this.pending.delete(msg.id)
      if (msg.type === 'done') p.resolve(msg.result)
      else p.reject(new Error(msg.message))
    }
  }

  /** Sends one request and waits for its 'done' or 'error' reply. */
  private call<T>(payload: object, onProgress?: (f: number) => void): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
      this.worker.postMessage({ id, ...payload })
    })
  }

  init(numThreads: number, onProgress?: (f: number) => void): Promise<MaiaInitResult> {
    return this.call(
      { type: 'init', modelUrl: MAIA_MODEL_URL, wasmPaths: `${location.origin}/vendor/ort/`, numThreads },
      onProgress,
    )
  }

  /** One prediction per Elo, all computed in a single model run. */
  predict(fen: string, elos: number[]): Promise<MaiaPredictResult> {
    return this.call({ type: 'predict', fen, elos })
  }
}
