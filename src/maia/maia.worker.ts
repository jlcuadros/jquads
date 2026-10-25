/**
 * Maia-3 Web Worker: downloads/caches the ONNX model and runs inference off
 * the main thread, so the UI never freezes while the model thinks.
 *
 * Protocol (main thread ⇄ worker), every request carries an `id`:
 *   → { id, type: 'init', modelUrl, wasmPaths, numThreads }
 *   ← { id, type: 'progress', fraction }            (while downloading)
 *   ← { id, type: 'done', result: { fromCache, ms, threads } }
 *   → { id, type: 'predict', fen, elos }              (one batch item per Elo)
 *   ← { id, type: 'done', result: { predictions, ms } }
 *   ← { id, type: 'error', message }
 */
import * as ort from 'onnxruntime-web/wasm'
import { fetchCached } from '../lib/cache'
import { encodePosition, decodePrediction, NUM_MOVES, TOKENS_PER_BOARD } from './encoding'

let session: ort.InferenceSession | null = null

type Request =
  | { id: number; type: 'init'; modelUrl: string; wasmPaths: string; numThreads: number }
  | { id: number; type: 'predict'; fen: string; elos: number[] }

async function init(req: Extract<Request, { type: 'init' }>) {
  const t0 = performance.now()
  // Where onnxruntime finds its .wasm/.mjs (copied to public/ by copy-vendor).
  ort.env.wasm.wasmPaths = req.wasmPaths
  // Threads need cross-origin isolation (SharedArrayBuffer); otherwise 1.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? req.numThreads : 1

  const { data, fromCache } = await fetchCached(req.modelUrl, (fraction) =>
    postMessage({ id: req.id, type: 'progress', fraction }),
  )
  session = await ort.InferenceSession.create(new Uint8Array(data), {
    executionProviders: ['wasm'],
  })
  return { fromCache, ms: performance.now() - t0, threads: ort.env.wasm.numThreads }
}

/**
 * Runs the model for one position at several Elos in a single batch
 * (elo_self = elo_oppo = Elo, as maiachess does).
 */
async function predict(req: Extract<Request, { type: 'predict' }>) {
  if (!session) throw new Error('Maia is not loaded yet')
  const t0 = performance.now()
  const enc = encodePosition(req.fen)
  const batch = req.elos.length

  // Same board repeated once per Elo.
  const tokens = new Float32Array(batch * TOKENS_PER_BOARD)
  for (let i = 0; i < batch; i++) tokens.set(enc.tokens, i * TOKENS_PER_BOARD)
  const elos = Float32Array.from(req.elos)

  const out = await session.run({
    tokens: new ort.Tensor('float32', tokens, [batch, 64, 12]),
    elo_self: new ort.Tensor('float32', elos, [batch]),
    elo_oppo: new ort.Tensor('float32', elos.slice(), [batch]),
  })
  const moveLogits = out.logits_move.data as Float32Array
  const valueLogits = out.logits_value.data as Float32Array

  const predictions = req.elos.map((elo, i) => ({
    elo,
    ...decodePrediction(
      enc,
      moveLogits.subarray(i * NUM_MOVES, (i + 1) * NUM_MOVES),
      valueLogits.subarray(i * 3, i * 3 + 3),
    ),
  }))
  return { predictions, ms: performance.now() - t0 }
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data
  try {
    const result = req.type === 'init' ? await init(req) : await predict(req)
    postMessage({ id: req.id, type: 'done', result })
  } catch (e) {
    postMessage({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
