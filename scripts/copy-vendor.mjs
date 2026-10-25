// Copies the engine runtime files from node_modules into public/vendor/ so they
// are served as plain static files (they must NOT go through the bundler:
// they load their own .wasm files and spawn worker threads relative to their URL).
//
// Run automatically by `npm run dev` and `npm run build`.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const FILES = [
  // Stockfish 17 (NNUE) and classical Stockfish (no NNUE), from Lichess' builds.
  ['node_modules/lila-stockfish-web/sf17-79.js', 'public/vendor/stockfish/sf17-79.js'],
  ['node_modules/lila-stockfish-web/sf17-79.wasm', 'public/vendor/stockfish/sf17-79.wasm'],
  ['node_modules/lila-stockfish-web/sfhce.js', 'public/vendor/stockfish/sfhce.js'],
  ['node_modules/lila-stockfish-web/sfhce.wasm', 'public/vendor/stockfish/sfhce.wasm'],
  // onnxruntime-web WASM backend (runs the Maia model).
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'public/vendor/ort/ort-wasm-simd-threaded.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'public/vendor/ort/ort-wasm-simd-threaded.wasm'],
]

for (const [from, to] of FILES) {
  mkdirSync(dirname(join(root, to)), { recursive: true })
  cpSync(join(root, from), join(root, to))
}
console.log(`copy-vendor: ${FILES.length} files copied to public/vendor/`)
